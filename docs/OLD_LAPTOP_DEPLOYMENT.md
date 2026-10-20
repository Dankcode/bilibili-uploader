# Revision-pinned deployment behind private Tailscale Serve

The consolidated application at `cad55d9` already removes operator sign-in.
An old running checkout or compiled `.next` is a deployment problem, not a
reason to rewrite authentication. Never merge old local auth patches into main.

## 1. Inspect and preserve the existing host

Identify the actual host, service account, checkout, Node/Python environments,
web and worker processes, private Serve URL and existing Serve mappings first.
The systemd templates are examples: adapt their user and paths to the host.

Before cutover, stop/disable the identified upload worker and any other queue
writers. Keep it disabled throughout deployment and acceptance. Preserve:

- SQLite and its required encryption key; use SQLite's backup API or `.backup`
  for a consistent backup, then check `PRAGMA integrity_check` on that backup.
  Do not copy a live database/WAL pair as independent files.
- Media, video-work outputs and delivery receipts.
- Existing environment/runtime files and platform OAuth/cookie files.
- Browser profiles, Python environments, GUI calibration/templates and training.

Record private file inventories/checksums locally before and after cutover.
Save the old source SHA, local patch diff, service units/environment, launch
command and old compiled build for rollback. Do not include those patches or
compiled files in the new release. Never rotate or replace the existing
`STUDIO_SECRET_KEY`: retained encrypted data needs its original key.
Do not run `prepare_host.mjs` on an existing installation.

## 2. Validate clean, intended source

Use a clean host-local clone of `Dankcode/bilibili-uploader` main. Fetch/verify
the intended commit explicitly; for this consolidation it is `cad55d9`.
Do not transfer uncommitted patches, Mac dependencies, old `.next` output,
host credentials, browser profiles or database files into the validation clone.

Run the new validation harness from a checkout containing that script:

```sh
node /path/to/current/scripts/validate_release.mjs \
  --source /path/to/clean-main-clone \
  --revision cad55d9 \
  --output-root /path/to/releases
```

The source clone's local `main` must match the selected revision. The harness:

1. Creates a new detached checkout of that commit, excluding ignored local
   files and compiled output.
2. Runs `npm ci` there. For validation on the same OS/architecture only,
   `--dependencies /path/to/installed/node_modules` can reuse existing packages.
3. Runs `npm test` without inherited `VIDEO_SQLITE_PATH`,
   `VIDEO_RUNTIME_SETTINGS_PATH`, `STUDIO_SECRET_KEY`, provider credentials,
   or preload hooks. `test/setup.mjs` supplies each test process's database;
   fixture tests retain their own keys. No production encryption key is used.
4. Runs `npm run build` only after tests exit zero. Only the build gets
   disposable database/runtime overrides and a fresh throwaway encryption key.
5. Records real subprocess exit codes/signals in private `validation.json`
   with separate logs. It records the source SHA and fresh Next build ID,
   checks source cleanliness, and never starts the web server or a worker.

Deploy only when `eligibleForDeployment` is true and both test and build
exit codes are zero. A shell pipeline ending in `tee` or `tail` is not proof
of the test/build exit status. A failed test never qualifies a release.

For a manual test-only invocation, clear inherited overrides rather than
exporting one shared test database:

```sh
env -u VIDEO_SQLITE_PATH -u VIDEO_RUNTIME_SETTINGS_PATH \
  -u STUDIO_SECRET_KEY npm test
```

Do not set a suite-wide fixture encryption key, serialize away the race, remove
assertions, or weaken encryption to make the incorrect harness pass.

## 3. Cut over with the worker disabled

Use the freshly built release directory recorded in the validation report.
Provision the retained private state only after validation. Map existing SQL,
media, browser-profile and calibration paths to the same preserved host files;
do not move/delete them or copy the disposable build runtime into production.
Keep the existing production encryption key and retain the old deployment.

In the production service's persistent environment file, set:

```dotenv
VIDEO_ACCESS_MODE=tailscale
VIDEO_BIND_HOST=127.0.0.1
PORT=4455
```

Replace obsolete listener settings rather than appending contradictory entries.
The launcher must be exactly:

```sh
node scripts/run_server.mjs start --web-only
```

Do not retain `--shared`, use `--tailscale`, or run `npm start` here:
Serve proxies to loopback, and the web-only command must not launch a worker.
The sample web unit persists this topology. Update the actual unit's
WorkingDirectory/ExecStart to the validated source directory, preserve its
production EnvironmentFile, and remove old ExecStart overrides before restart.
Keep the worker unit stopped/disabled and runtime `workerEnabled: false`.

Inspect `tailscale serve status` and preserve the existing private Serve mapping
to `http://127.0.0.1:4455`. Never enable Funnel, reset all Serve mappings,
or bind this unauthenticated app publicly.

## 4. Acceptance on the actual host

Record these results; local validation alone is not remote deployment proof:

- Active process cwd/source SHA matches the intended release commit.
- That directory's `.next/BUILD_ID` matches the validation report.
- Launch arguments are web-only, without `--shared` or `--tailscale`.
- `ss -ltnp` shows `127.0.0.1:4455`, not all interfaces or a tailnet listener.
- Both loopback and the private Serve URL return HTTP 200 for
  `/api/auth/session`, with `required:false` and `authenticated:true`.
- Dashboard, `/api/runtime/settings`, and `/api/pipeline/jobs` work without an
  operator token. Confirm the dashboard in a fresh browser session.
- Worker is stopped/disabled; no queued upload is executed as a deployment test.
- Retained SQL integrity, media/profile/calibration inventories and key identity
  match the pre-cutover record. Do not print secret values or decrypt credentials
  into logs.

Any tailnet device permitted to reach this service has full app authority.
Use private Tailscale permissions; Tailscale reachability is not SSH access.
Supply an SSH login/connected host terminal for remote installation and restart.

## Rollback

If acceptance fails, stop the new web process and keep every worker disabled.
Restore the saved service definition, persistent environment and old release
pointer/build. Restore a SQL backup only with all writers stopped, if needed.
Keep the same production key, media, profiles and GUI training. Recheck loopback
binding and the existing private Serve mapping. Do not reset Tailscale or delete
the old checkout/private state during rollback.
