# Old laptop backend integration

## Current stage

Deployment preparation, 2026-09-29. The laptop is online in Tailscale, but this
Mac has no accepted SSH authentication yet. No remote files, services, database,
Serve mappings, or active Mac connection have been changed.

The app currently requires **SQLite through better-sqlite3**. PostgreSQL and
MySQL are not supported by the existing adapter. Confirm the laptop's intended
engine before migrating data. Keep SQLite on the backend's local disk; clients
use the authenticated backend API, never a network-mounted database file.

## Prepare the host

These steps are for a Linux host with systemd. First inspect the actual account,
existing application checkout, Node path, disk space, running services and
`tailscale serve status`. Preserve existing services and Serve mappings.

The service templates assume user `vops`, checkout `/srv/bilibili-uploader`, and
Node at `/usr/bin/node`. Adapt them to the discovered host before installing.
Use a supported Node release compatible with the lockfile (the Mac build uses
Node 22 or newer). Install dependencies on Linux with `npm ci`; do not copy Mac
`node_modules`, `.next`, Python venvs, credentials, or SQLite WAL files.

Transfer the current reviewed source, including uncommitted feature files. A
plain clone alone does not include the SQL upload work still in this checkout.

As the service account, from the application directory:

```sh
npm ci
node scripts/prepare_host.mjs /srv/bilibili-uploader/config
VIDEO_SQLITE_PATH=/tmp/video-ops-build.db npm run build
```

Preparation creates `runtime-settings.json` and `server.env` with mode 0600,
generates a backend token without printing it, and leaves the worker disabled.
It refuses to overwrite either existing configuration file and does not open
or create the database. Existing installations must be inspected and configured
individually, not overwritten with a template.

The user provisions the database and application credentials separately. Set
`sqlitePath` in the runtime JSON to the laptop's local SQLite file. Stop writers
before migration and use SQLite's backup API or `.backup`, not a raw live-file
copy. Check `PRAGMA integrity_check` on the copy. Media paths and config paths
from the Mac must be mapped to real laptop files before queue execution.

## Start the web backend

After reviewing paths and provisioning SQL, install
`deploy/systemd/video-ops-web.service` into `/etc/systemd/system/`, then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now video-ops-web
ss -ltnp | grep 4455
tailscale serve status
```

The listener must be `127.0.0.1:4455`. Configure Tailscale Serve for this loopback
listener on an unused HTTPS port after inspecting the existing mappings. Do not
use Funnel, replace another service's mapping, or expose a database port.
The application token protects operator/backend API access; tailnet membership
alone does not grant application operator access.

## Verify and connect the Mac

Put only the backend token in a protected local file using a secure transfer.
Do not paste it into chat, command arguments, docs, or logs. Run:

```sh
node scripts/connect_backend.mjs https://YOUR-LAPTOP.ts.net /private/path/backend-token
```

This verifies the authenticated gateway and SQL status without changing the Mac.
Only after success, repeat with `--save` to persist remote mode and pause the Mac
worker. The existing Connections UI also supports Test and Save. Keep the Mac
database as a rollback copy. Never run both workers against the same queue.

Verify login, metadata reads/writes, media previews, and operator mutations over
the actual HTTPS Serve URL before calling the deployment ready.

## Enable automation separately

Install `video-ops-worker.service` only after credentials, media references, and
the job queue have been reviewed. Set `workerEnabled` to true in runtime settings
and enable/start the worker service. Verify a fresh heartbeat in Connections and
run a bounded download/metadata job before unattended use. Existing jobs can
cause external actions when the worker is enabled.

YouTube uploads remain **GUI driven**. A headless systemd worker is not a working
Studio uploader. A logged-in graphical session, browser/channel authentication,
Python dependencies, and fresh laptop-specific button calibration are required.
The Mac screenshot templates must not be assumed valid on Linux. A remote Mac
GUI execution handoff is not implemented by these deployment files. Do not enable
GUI upload jobs on the laptop until its desktop execution path is verified.
Still screenshots are allowed; do not start continuous recording.

For host-local agent training, distribute the entire
`skills/youtube-gui-upload/` directory, including `references/host-training.md`.
Install it in the laptop agent's skill directory or ask that agent to read the
repository's `SKILL.md` directly. It discovers local desktop tools, calibrates a
separate Linux/browser profile and records verified capabilities. The skill does
not install a Wayland input backend or automatically enable unattended execution.

## Rollback

Stop/disable only the two `video-ops-*` units introduced here. Remove only this
app's Serve mapping, never reset all mappings. Restore the Mac's prior connection
settings and local database after ensuring the laptop worker is stopped. No
automatic database migration, live cutover, or reboot is performed by this kit.
