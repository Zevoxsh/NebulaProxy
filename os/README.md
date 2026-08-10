# NebulaProxyV4 — OS layer

Turns the NebulaProxy app (this repo, copied verbatim from v3) into a
pfSense/Proxmox-style appliance: install once from a USB stick/ISO, boot,
read the IP off the console, open it in a browser, run the setup wizard.

The app itself is untouched. Nothing here duplicates its logic — the
Postgres/Redis containers already auto-generate their own passwords
(`postgres/entrypoint.sh`, `redis/entrypoint.sh`), and `backend/setup-server.js`
already generates `JWT_SECRET`/`DB_PASSWORD`/`PROXY_CHECK_TOKEN` and walks
through initial configuration via the `/setup` web wizard the first time it
finds no config in Redis. This layer's only job is getting Debian + Docker +
that stack running unattended, branded, and fast — and telling the admin
where to go.

**Status: tested end-to-end on Proxmox VE (BIOS boot) — unattended install,
Docker, systemd units, GRUB/MOTD rebranding, and first-boot app startup all
confirmed working.**

## Layout

```
os/
  preseed/preseed.cfg      Debian installer answers (unattended install)
  branding/splash.png      Installer boot-menu background (isolinux + GRUB)
  scripts/install-late.sh  Runs once, inside the chroot, at the end of install:
                            rebrands the target's own GRUB/MOTD, installs
                            Docker, wires up the systemd units below
  scripts/start-stack.sh   ExecStart for nebulaproxy.service — loads
                            pre-built images, runs docker compose up -d,
                            retries in the background until it sticks
  scripts/update-issue.sh  Writes this host's IP(s) into /etc/issue so they
                            show up at the console login prompt automatically
                            (same trick pfSense/Proxmox use — no daemon needed)
  systemd/nebulaproxy.service        runs start-stack.sh at boot
  systemd/nebulaproxy-issue.service  runs update-issue.sh at boot
  build/build-iso.sh       Repacks the official Debian netinst ISO with the
                            preseed, a full copy of this repo, AND pre-built
                            Docker images baked in
```

## Boot flow

1. Installer ISO boots (BIOS or UEFI), Debian installs itself unattended
   from `preseed.cfg` (guided partitioning, whole disk, no LVM — appliance,
   not a general-purpose box). Boot menu is branded and auto-boots after
   5s, no keypress needed.
2. `late_command` copies the repo onto the fresh install at
   `/opt/nebulaproxy` and runs `install-late.sh` inside the chroot:
   rebrands `/etc/os-release` + `/etc/default/grub` + `/etc/motd` and
   re-runs `update-grub` (grub-installer already generated the target's
   *own* boot menu using stock Debian branding before late_command ever
   ran — this is a separate fix from the installer-media branding above),
   installs Docker (get.docker.com, with an apt/docker.io fallback),
   drops in the systemd units, enables them.
3. Machine reboots into the installed system — GRUB now says
   "NebulaProxyV4", not Debian.
4. `nebulaproxy-issue.service` writes the console banner with this host's
   IP(s) and the web UI URL (retries for ~30s if DHCP hasn't handed out a
   lease yet by the time it first runs).
5. `nebulaproxy.service` (via `start-stack.sh`) loads the pre-built image
   tarball baked into the ISO, then runs `docker compose up -d` — same
   stack as v3, unmodified. Because the images are already built, this
   takes seconds instead of the several minutes a from-scratch build
   would (npm ci + vite build + multi-stage Dockerfiles) — that wait, with
   zero feedback on-screen, was the single biggest "is this even working"
   complaint during testing.
6. Backend finds no config in Redis on this fresh install, serves
   `setup-server.js` instead of the normal app — the existing first-run
   wizard. Admin opens the URL from the console banner and completes it.
7. Setup completion makes the backend container exit and restart
   (Docker's `restart: unless-stopped` policy); on that second start it
   finds config in Redis and boots the real app. Because backend was
   unhealthy (setup mode) during step 5's `docker compose up -d`, compose
   had already given up waiting and left frontend in "Created" — the
   background retry loop in `start-stack.sh` (every 30s for 20 minutes)
   is what actually gets frontend started once backend clears its
   healthcheck.
8. From here on it's just NebulaProxy, running exactly like v3, just on
   dedicated hardware instead of "docker compose on some Debian box I set
   up by hand."

## Building the ISO

```
sudo os/build/build-iso.sh [output.iso]
```

Needs root (loopback mount), `xorriso`, and a working `docker compose`
(images are built and embedded at ISO-build time — see below). Downloads
and caches the official Debian netinst ISO under `os/build/.cache/` on
first run. Takes about a minute with a warm Docker build cache; current
output is ~1.3GB (base Debian ISO ~700MB + ~300MB compressed pre-built
images + repo source).

Images are built under an isolated compose project name
(`nebulaproxyv4img`) specifically so the resulting image tags can't
collide with any other "nebulaproxy"-named stack's images on the machine
running the build script (e.g. an actual v3 production install, which
would otherwise generate identically-named images on the same Docker
daemon). They're re-tagged to what the *target's* compose file expects
only after `docker load` runs on the freshly installed appliance itself.

## Known gaps / next steps

- `update-issue.sh`'s retry only covers the boot-time DHCP race. A later
  lease renewal that changes the IP won't be reflected until reboot —
  fine for a static/VM deployment, worth a NetworkManager dispatcher hook
  later for real DHCP environments.
- `start-stack.sh`'s background retry window is 20 minutes. If setup
  takes longer than that, frontend stays un-started until someone runs
  `docker compose up -d` manually — acceptable edge case, not worth
  engineering around further right now.
- No A/B update mechanism yet — updates would currently mean `git pull` +
  rebuild inside `/opt/nebulaproxy`, same as v3's watchdog does today. A
  proper appliance update story (atomic image swap, rollback) is a
  separate, bigger piece of work. The pre-built image tarball is a
  one-time first-boot speedup, not an ongoing update channel.
- `preseed.cfg`'s Debian user password is a fixed placeholder
  (`nebula`/`nebula`) — it only grants shell access, not app access (the
  app's own credentials come from the setup wizard), but change it after
  install regardless: `passwd nebula`.
- No Secure Boot / signed-image story. Not needed for a self-hosted
  appliance on hardware you control, would matter if this ever shipped to
  third parties.
