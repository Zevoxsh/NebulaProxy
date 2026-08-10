#!/bin/bash
# Builds a fully unattended NebulaProxy installer ISO by repacking the
# official Debian netinst ISO with os/preseed/preseed.cfg plus a copy of
# this whole repo baked in under /nebulaproxy-src (so install-late.sh has
# no network dependency at install time — only Docker's own install script
# needs internet, at first boot). Boot the resulting ISO on a blank disk
# and NebulaProxy is installed and running with no further input.
#
# Requires: root (loopback mount), xorriso, curl.
# Test-built successfully against debian-13.6.0-amd64-netinst.iso (valid
# hybrid BIOS+UEFI boot record, preseed.cfg + nebulaproxy-src present, no
# secrets baked in). Not yet boot-tested on real hardware/a VM.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Must run as root (needs loopback mount)." >&2
  exit 1
fi

for bin in xorriso curl docker; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing dependency: $bin" >&2; exit 1; }
done

ARCH="${ARCH:-amd64}"
# Resolve the current netinst filename dynamically instead of hardcoding a
# point release — cdimage.debian.org/debian-cd/current/ always points at
# the latest, but the filename itself embeds the version (e.g. 13.6.0) and
# that changes with every point release.
if [ -z "${ISO_NAME:-}" ]; then
  ISO_NAME=$(curl -fsL "https://cdimage.debian.org/debian-cd/current/${ARCH}/iso-cd/" \
    | grep -oE "debian-[0-9.]+-${ARCH}-netinst\.iso" | sort -u | tail -1)
  [ -n "$ISO_NAME" ] || { echo "Could not resolve current netinst ISO name" >&2; exit 1; }
fi
ISO_URL="https://cdimage.debian.org/debian-cd/current/${ARCH}/iso-cd/${ISO_NAME}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(dirname "$OS_DIR")"
WORK_DIR="$(mktemp -d)"
OUT_ISO="${1:-$SCRIPT_DIR/nebulaproxyv4-installer.iso}"

cleanup() {
  mountpoint -q "$WORK_DIR/mnt" 2>/dev/null && umount "$WORK_DIR/mnt"
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "==> Fetching base Debian ISO (cached under os/build/.cache/)"
CACHE_DIR="$SCRIPT_DIR/.cache"
mkdir -p "$CACHE_DIR"
if [ ! -f "$CACHE_DIR/$ISO_NAME" ]; then
  curl -fL --progress-bar -o "$CACHE_DIR/$ISO_NAME" "$ISO_URL"
fi

echo "==> Extracting ISO"
MOUNT_DIR="$WORK_DIR/mnt"
EXTRACT_DIR="$WORK_DIR/extract"
mkdir -p "$MOUNT_DIR" "$EXTRACT_DIR"
mount -o loop,ro "$CACHE_DIR/$ISO_NAME" "$MOUNT_DIR"
cp -rT "$MOUNT_DIR" "$EXTRACT_DIR"
umount "$MOUNT_DIR"
chmod -R u+w "$EXTRACT_DIR"

echo "==> Injecting preseed + NebulaProxy source"
cp "$OS_DIR/preseed/preseed.cfg" "$EXTRACT_DIR/preseed.cfg"
mkdir -p "$EXTRACT_DIR/nebulaproxy-src"
tar --exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='build' \
    -C "$REPO_DIR" -cf - . | tar -C "$EXTRACT_DIR/nebulaproxy-src" -xf -

echo "==> Pre-building app images (avoids a multi-minute silent wait on first boot)"
# The slow part of first boot was never Debian/Docker install — it's
# `docker compose up -d` building 6 images from scratch (npm ci, vite
# build, ...), which leaves the console banner's URL unreachable for
# several minutes with zero feedback (confusing enough in testing that a
# real end user would likely give up on it). Building here instead, once,
# at ISO-build time — where waiting is already the expectation — and
# embedding the result means the target's first `docker compose up -d`
# just loads already-built images. Built under an isolated project name
# (nebulaproxyv4img) so the resulting image tags can't collide with any
# other "nebulaproxy" stack's images on THIS build machine's Docker daemon
# (e.g. the actual v3 production install this was forked from, which
# would otherwise share the exact same auto-generated image names); only
# re-tagged to what the target's own compose file expects after
# `docker load` runs there — see start-stack.sh, must use the same
# BUILD_SERVICES list and project name.
IMAGE_BUILD_PROJECT=nebulaproxyv4img
BUILD_SERVICES="backend frontend postgres redis watchdog autoheal"
if docker compose -p "$IMAGE_BUILD_PROJECT" --project-directory "$REPO_DIR" build; then
  IMAGE_REFS=""
  for svc in $BUILD_SERVICES; do IMAGE_REFS="$IMAGE_REFS ${IMAGE_BUILD_PROJECT}-${svc}:latest"; done
  IMAGES_TAR="$WORK_DIR/nebulaproxy-images.tar"
  docker save -o "$IMAGES_TAR" $IMAGE_REFS
  gzip -f "$IMAGES_TAR"
  cp "$IMAGES_TAR.gz" "$EXTRACT_DIR/nebulaproxy-src/.docker-images.tar.gz"
  docker rmi $IMAGE_REFS >/dev/null 2>&1 || true
  echo "==> Pre-built images embedded ($(du -h "$EXTRACT_DIR/nebulaproxy-src/.docker-images.tar.gz" | cut -f1))"
else
  echo "!! Image pre-build failed — first boot will build from scratch instead (slower, not fatal)"
fi

echo "==> Setting automatic-install boot parameters"
# BIOS boot (isolinux) — appends the preseed args to the default entry.
if [ -f "$EXTRACT_DIR/isolinux/txt.cfg" ]; then
  sed -i 's#\(append .*\)#\1 auto=true priority=critical file=/cdrom/preseed.cfg#' \
    "$EXTRACT_DIR/isolinux/txt.cfg"
fi
# UEFI boot (grub)
if [ -f "$EXTRACT_DIR/boot/grub/grub.cfg" ]; then
  sed -i 's#\(linux.*/install\.amd/vmlinuz[^\n]*\)#\1 auto=true priority=critical file=/cdrom/preseed.cfg#' \
    "$EXTRACT_DIR/boot/grub/grub.cfg"
fi

echo "==> Branding installer UI"
cp "$OS_DIR/branding/splash.png" "$EXTRACT_DIR/isolinux/splash.png"

# Stock stdmenu.cfg starts the menu list at row 8 (~row*16px), which lands
# on top of our splash's title text ("NebulaProxy" sits around row 12-13,
# subtitle/divider around row 15-16 — see os/branding/splash.png). Push the
# whole menu block down to clear it, and shift the help/timeout rows below
# down with it so they don't end up overlapping the (now lower) menu entry.
if [ -f "$EXTRACT_DIR/isolinux/stdmenu.cfg" ]; then
  sed -i \
    -e 's/^menu vshift .*/menu vshift 19/' \
    -e 's/^menu helpmsgrow .*/menu helpmsgrow 24/' \
    -e 's/^menu cmdlinerow .*/menu cmdlinerow 26/' \
    -e 's/^menu timeoutrow .*/menu timeoutrow 26/' \
    -e 's/^menu tabmsgrow .*/menu tabmsgrow 28/' \
    "$EXTRACT_DIR/isolinux/stdmenu.cfg"
  # Stock selection highlight is light blue (#76a1d0) — the app's actual
  # theme is monochrome (near-black bg, white/gray text — see
  # frontend/tailwind.config.js's "admin" palette), so match that instead
  # of introducing a color that isn't actually the brand.
  sed -i \
    -e 's/^\(menu color sel[[:space:]]*\* #ffffffff \)#76a1d0ff/\1#27272aff/' \
    -e 's/^\(menu color hotsel[[:space:]]*[^ ]* #ffffffff \)#76a1d0ff/\1#27272aff/' \
    "$EXTRACT_DIR/isolinux/stdmenu.cfg"
fi

# Collapse the boot menu to a single "Install NebulaProxy" entry. Stock
# Debian offers Advanced/Accessible-dark-contrast/speech-synthesis submenus
# on top of graphical vs text install — none of that is meaningful for an
# appliance that installs itself unattended, so drop it instead of leaving
# it to clutter a screen nobody needs to interact with.
if [ -f "$EXTRACT_DIR/isolinux/menu.cfg" ]; then
  cat > "$EXTRACT_DIR/isolinux/menu.cfg" <<'EOF'
menu hshift 4
menu width 70

menu title NebulaProxy Installer
include stdmenu.cfg
include txt.cfg
EOF
fi
# Auto-boot with no keypress ("insert USB, walk away"): isolinux's stock
# `timeout 0` means wait forever for input, not skip the wait. Give it a
# real timeout (tenths of a second) and mark our automated label as the
# default so it's what actually boots when that timeout fires.
if [ -f "$EXTRACT_DIR/isolinux/isolinux.cfg" ]; then
  sed -i 's#^timeout .*#timeout 50#' "$EXTRACT_DIR/isolinux/isolinux.cfg"
fi
if [ -f "$EXTRACT_DIR/isolinux/txt.cfg" ]; then
  awk '{print} /menu label \^Install/{print "\tmenu default"}' \
    "$EXTRACT_DIR/isolinux/txt.cfg" > "$EXTRACT_DIR/isolinux/txt.cfg.new"
  mv "$EXTRACT_DIR/isolinux/txt.cfg.new" "$EXTRACT_DIR/isolinux/txt.cfg"
fi

# UEFI graphical menu (GRUB theme) — same "Debian GNU/Linux ..." strings
# hardcoded across all 10 resolution/contrast theme variants; the
# background image is already ours (theme files point at
# /isolinux/splash.png, which we just overwrote above).
if [ -d "$EXTRACT_DIR/boot/grub/theme" ]; then
  find "$EXTRACT_DIR/boot/grub/theme" -maxdepth 1 -type f -print0 | xargs -0 -r sed -i \
    -e 's#Debian GNU/Linux UEFI Installer menu#NebulaProxy Installer#' \
    -e 's#Debian GNU/Linux [0-9][0-9.]*#NebulaProxy#'
fi
# Same idea for the UEFI/grub path — prepend rather than pattern-match
# existing content, since grub.cfg's generated boilerplate shifts between
# Debian releases and a prepend can't be broken by that drift.
if [ -f "$EXTRACT_DIR/boot/grub/grub.cfg" ]; then
  { printf 'set timeout=5\nset default=0\n'; cat "$EXTRACT_DIR/boot/grub/grub.cfg"; } \
    > "$EXTRACT_DIR/boot/grub/grub.cfg.new"
  mv "$EXTRACT_DIR/boot/grub/grub.cfg.new" "$EXTRACT_DIR/boot/grub/grub.cfg"
fi

echo "==> Rebuilding md5sums"
# No -follow: current netinst images ship a self-referential "debian -> ."
# symlink at the root, which sends `find -follow` into an infinite loop.
# Regular files don't need it followed anyway — everything's reachable by
# its real path.
( cd "$EXTRACT_DIR" && find . -type f ! -name md5sum.txt -exec md5sum {} \; > md5sum.txt )

echo "==> Repacking as hybrid bootable ISO"
# isohdpfx.bin (the isohybrid MBR template) isn't shipped inside the ISO
# itself — it comes from the `isolinux` package on whatever system built
# it. Rather than depending on that package being installed here, pull the
# MBR bytes straight out of the original ISO via a raw interval read
# (`xorriso -indev original.iso -report_el_torito as_mkisofs` is what
# revealed this exact boot-parameter set, including the partition/APM
# flags below — reproduced verbatim so the repacked ISO boots identically
# on BIOS and UEFI).
xorriso -as mkisofs \
  -o "$OUT_ISO" \
  -isohybrid-mbr --interval:local_fs:0s-15s:zero_mbrpt,zero_gpt,zero_apm:"$CACHE_DIR/$ISO_NAME" \
  -partition_cyl_align on \
  -partition_offset 0 \
  -partition_hd_cyl 64 \
  -partition_sec_hd 32 \
  --mbr-force-bootable \
  -apm-block-size 2048 \
  -iso_mbr_part_type 0x00 \
  -c isolinux/boot.cat \
  -b isolinux/isolinux.bin -no-emul-boot -boot-load-size 4 -boot-info-table \
  -eltorito-alt-boot \
  -e boot/grub/efi.img -no-emul-boot -boot-load-size 7360 -isohybrid-gpt-basdat \
  -isohybrid-apm-hfsplus \
  -V "NebulaProxy" \
  "$EXTRACT_DIR"

echo "==> Done: $OUT_ISO"
