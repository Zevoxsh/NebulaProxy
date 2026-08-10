# NebulaProxyV4 — OS layer

Turns the NebulaProxy app (this repo, copied verbatim from v3) into a
pfSense/Proxmox-style appliance: install once from a USB stick, boot, read
the IP off the console, open it in a browser, run the setup wizard.

The app itself is untouched. Nothing here duplicates its logic — the
Postgres/Redis containers already auto-generate their own passwords
(`postgres/entrypoint.sh`, `redis/entrypoint.sh`), and `backend/setup-server.js`
already generates `JWT_SECRET`/`DB_PASSWORD`/`PROXY_CHECK_TOKEN` and walks
through initial configuration via the `/setup` web wizard the first time it
finds no config in Redis. This layer's only job is getting Debian + Docker +
that stack running unattended, and telling the admin where to go.

## Layout

```
os/
  preseed/preseed.cfg      Debian installer answers (unattended install)
  scripts/install-late.sh  Runs once, inside the chroot, at the end of install:
                            installs Docker, wires up the systemd units below
  scripts/update-issue.sh  Writes this host's IP(s) into /etc/issue so they
                            show up at the console login prompt automatically
                            (same trick pfSense/Proxmox use — no daemon needed)
  systemd/nebulaproxy.service        `docker compose up -d` at boot
  systemd/nebulaproxy-issue.service  runs update-issue.sh at boot
  build/build-iso.sh       Repacks the official Debian netinst ISO with the
                            preseed + a full copy of this repo baked in, so
                            the installer needs no network except to fetch
                            Docker itself
```

## Boot flow

1. Installer ISO boots, Debian installs itself unattended from
   `preseed.cfg` (guided partitioning, whole disk, no LVM — appliance,
   not a general-purpose box).
2. `late_command` copies the repo onto the fresh install at
   `/opt/nebulaproxy` and runs `install-late.sh` inside the chroot:
   installs Docker, drops in the two systemd units, enables them.
3. Machine reboots into the installed system.
4. `nebulaproxy-issue.service` writes the console banner with this host's
   IP(s) and the web UI URL.
5. `nebulaproxy.service` runs `docker compose up -d` — same stack as v3,
   unmodified.
6. Backend finds no config in Redis on this fresh install, serves
   `setup-server.js` instead of the normal app — the existing first-run
   wizard. Admin opens the URL from the console banner and completes it.
7. From here on it's just NebulaProxy, running exactly like v3, just on
   dedicated hardware instead of "docker compose on some Debian box I set
   up by hand."

## Building the ISO

```
sudo os/build/build-iso.sh [output.iso]
```

Needs root (loopback mount) and `xorriso`. Downloads and caches the
official Debian netinst ISO under `os/build/.cache/` on first run.

**Not yet test-built end-to-end.** The isolinux/grub boot-line patching in
`build-iso.sh` follows the standard documented Debian repack process, but
hasn't been run against a real downloaded trixie image in this environment.
Treat it as a solid first draft — verify the `sed` patterns actually match
`isolinux/txt.cfg` / `boot/grub/grub.cfg` in the ISO you download before
trusting a produced image untested on real hardware/VM.

## Known gaps / next steps

- `update-issue.sh` only runs once at boot. A DHCP lease renewal that
  changes the IP won't be reflected until reboot — fine for a static/VM
  deployment, worth a NetworkManager dispatcher hook later for real DHCP
  environments.
- No A/B update mechanism yet — updates would currently mean `git pull` +
  rebuild inside `/opt/nebulaproxy`, same as v3's watchdog does today. A
  proper appliance update story (atomic image swap, rollback) is a
  separate, bigger piece of work.
- `preseed.cfg`'s Debian user password is a fixed placeholder
  (`nebula`/`nebula`) — it only grants shell access, not app access (the
  app's own credentials come from the setup wizard), but change it after
  install regardless: `passwd nebula`.
- No Secure Boot / signed-image story. Not needed for a self-hosted
  appliance on hardware you control, would matter if this ever shipped to
  third parties.
