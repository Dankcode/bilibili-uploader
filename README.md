# VIDEOPS — video automation console

`bilibili-uploader` manages source imports, automation schedules, publishing
metadata, YouTube delivery, and receipts. Video creation and editing run in the
separate `Documents/GitHub/video-automation` app through its Video Editor MCP.
The uploader streams source media to the editor, tracks its jobs, downloads the
finished MP4, validates it, and continues publishing.

Jobs and delivery history live in a local SQLite database. Configure editing
models and rendering providers in video-automation; configure source accounts,
publishing metadata, and destination accounts here.

![Operations overview: KPI row, seven-day pipeline throughput, automation health checks, and the video operations table](./docs/design/operations-overview-final.png)

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [How to use the console](#how-to-use-the-console)
- [Batch automation](#batch-automation)
- [Configuration](#configuration)
- [Runtime topology](#runtime-topology)
- [Where files live](#where-files-live)
- [Privacy and remote boundaries](#privacy-and-remote-boundaries)
- [Development](#development)
- [Limitations](#limitations)
- [Documentation](#documentation)

## What it does

| Area | Capability |
|---|---|
| Sources | Local file upload or server path, Bilibili video/space URLs, Douyin video, profile, mix, or music pages (via a FastAPI sidecar) |
| Processors | `videoEditor` (external MCP localization/rendering), `metadata` (publishing title/description/tags) |
| Uploaders | YouTube, via the Data API or a guided desktop uploader; per-job OAuth identity chosen from registered authorizations |
| Batching | Presets, priority, scheduled start, spacing between uploads, and a durable job queue processed by a background worker |
| Editing | Provided by the separate video-automation app |
| Tracking | Video catalog with search and bulk actions, per-publication analytics snapshots, API quota metering, and a diagnostics panel |

## Requirements

- **Node.js 22.12+** — required by the Puppeteer cookie-capture integration; a current LTS release is recommended.
- **Python 3.10+** — for YouTube publishing and the helper scripts in
  `scripts/python/`. Install with `pip install -r requirements.txt`.
- **FFmpeg / FFprobe** — bundled binaries handle source audio/video merging
  and publishing validation. `FFMPEG_PATH` / `FFPROBE_PATH` override them.
- **Video Editor MCP** — start video-automation separately on port 4560 for
  video creation. Upload-only jobs do not need it.
- **Disk** — the diagnostics panel warns below 5 GB free in the work directory.
- Optional: the Douyin downloader sidecar and an AI text provider for metadata.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:4455>.

`npm run dev` starts two processes: the **web control plane** (Next.js) and the
**pipeline worker** that drains the job queue. Set `PORT` to change the port.
For production, build first:

```bash
npm run build
npm start
```

Both commands bind `127.0.0.1` by default. There is no app sign-in screen,
operator token, operator cookie, or MCP token requirement in any mode. Existing
token files are left untouched but do not gate access. The same environment
files are loaded for frontend and worker.

For private **Tailscale Serve → localhost** access, persist these values in
the backend's environment file:

```dotenv
VIDEO_ACCESS_MODE=tailscale
VIDEO_BIND_HOST=127.0.0.1
PORT=4455
```

Start the validated production build with
`node scripts/run_server.mjs start --web-only`. Keep the worker disabled during
validation. Point private Tailscale Serve at `http://127.0.0.1:4455` and open
its HTTPS URL from your tailnet. Do not append `--shared` or `--tailscale`:
those are different listener modes. No SSH or app sign-in is needed to use
the dashboard over Tailscale.

For **direct Tailscale-IP binding** instead of Serve, use `npm run dev:tailscale`, or
build and run `npm run start:tailscale`. These discover the backend's address
with `tailscale ip -4` and bind to that Tailscale IP, not every LAN interface.
Set `TAILSCALE_BIN` if needed, or set `VIDEO_ACCESS_MODE=tailscale` and
`VIDEO_BIND_HOST` to the backend's Tailscale IP yourself. Open that address or
its MagicDNS name on port 4455. No token setup or browser pairing is needed.

Anyone who can reach the app has full workspace authority. Restrict access
using Tailscale permissions; do not expose the app publicly or through Funnel.
The legacy `shared` listener also needs no token but binds all interfaces by
default, so prefer the Tailscale command. `start:local` / `dev:local` force
loopback-only operation. Add `-- --web-only` to any start script to leave the
upload worker stopped while checking the UI.

MCP upload requests execute without a second human metadata/correction approval.
`queue_saved_uploads` and `queue_batch` enqueue ready-to-run jobs; metadata edits
or retries can resume an existing review hold. Media validation, target account
binding, versions, quotas and duplicate-delivery receipts remain intact. Provider
sign-in is still required where YouTube or another platform requires it. See
[MCP setup and workflow](docs/MCP_AGENT_BRIDGE.md).

`npm run build` checks publishable source for credentials/private runtime files
before compiling, then checks deployment trace manifests for private inputs.
Local config, cookies, OAuth files and downloaded media are excluded from those
traces and must be provisioned separately on the runtime host. Use
`scripts/validate_release.mjs` for a clean revision-pinned checkout, per-process
test isolation, disposable build data, and recorded test/build exit codes;
do not export production database paths or encryption keys into validation.
See [deployment validation](docs/OLD_LAPTOP_DEPLOYMENT.md).
Never publish a working-directory archive or
the Next build cache; neither is a sanitized public release artifact. Removing
files from current Git tracking does not remove older copies from Git history.

There is no Bilibili credential requirement at startup. Paste a creator or
video URL in **Create New Automations** and use it immediately. Public access
is attempted first. If Bilibili requires a session, Video Ops verifies a saved
cookie or gathers Bilibili cookies from Chrome on the backend computer, saves
them privately in `config/storage.json`, and retries automatically.
The app cannot create a signed-in session from a public profile URL; a source
restricted by Bilibili still needs an existing browser sign-in.

For browser-free public scraping, run `npm run setup:bilibili-cli` (requires
`uv`; installs Python 3.12 and the pinned
[public-clis/bilibili-cli](https://github.com/public-clis/bilibili-cli) revision
into `.venv-bilibili-cli`). The app then tries the CLI's maintained SDK first
for metadata, paginated creator uploads, and DASH download URLs. The bridge
always passes `credential=None` and never reads the CLI's saved login or browser
cookies. `BILIBILI_CLI_PYTHON` can select an existing environment's absolute
Python path. If the optional adapter is absent or fails, the existing public
API/browser path and automatic session fallback remain available.

The CLI itself exposes video metadata and audio extraction, but does not export
full video stream data, so the bridge uses its underlying `bilibili-api-python`
SDK for that operation. Public previews fetch metadata only. Anonymous stream
quality is limited by Bilibili (480p in the live verification); higher quality,
restricted videos, and subtitles may still require login. Test a video without
reading any saved login using
`node --import ./scripts/register_loader.mjs scripts/probe_bilibili_anonymous.mjs BV1xx411c7mD`.

**Connections → Bilibili source** has an optional profile URL check, such as
`https://space.bilibili.com/123456`, with **Connect saved cookie**.
Run `npm run setup:bilibili-cookies` once to install the optional Chrome cookie
reader into a project-local Python environment. The OS may request keychain
access. Only Bilibili-domain cookies are imported; the values are never shown.
The profile URL selects the creator to scrape; it does not contain anyone’s
login cookie. When explicitly connecting a profile with no valid session,
the profile opens in the app’s
persistent Puppeteer-controlled Chrome browser for a one-time sign-in. The app
opens the supplied profile or video URL, captures SESSDATA from that browser's
signed-in session, and reuses it on later runs. It cannot obtain another
creator's login cookie from their public URL. The private Chrome profile lives
in `config/bilibili-puppeteer/`; only Bilibili-domain cookies are exported to
`config/storage.json`. Puppeteer Core uses installed Chrome, or the executable
specified by `BILIBILI_CHROME_PATH`; it does not download a browser. This browser belongs to the backend
machine and needs a desktop session when first connecting.

## How to use the console

The sidebar separates source/publishing work from system settings.

### Overview

Live counts for the catalog, active queue, items needing review, published
videos, and success rate; a seven-day completed-vs-failed throughput chart;
automation health checks; recent catalog activity; and the next queued items.
Use it as the landing page — the health panel links straight to whatever is
not ready yet.

### Library

The full video catalog backed by SQLite, paginated at 50 rows. Search by title,
filter by stage (`draft` through `published`, `failed`, `canceled`), edit a
video's catalog record, open its publication on the destination platform, and
select rows for bulk retry or cancel.

### Automation

![Automation batch planner: video sources, the ordered run list of five steps, and batch dispatch settings](./docs/design/automation-planner-final.png)

Three tabs:

- **Batch planner** — the main entry point. Pick a source, a preset, and a
  source language; drop files or paste one absolute server path per line;
  check the steps to run; name the batch, set priority, spacing, and an
  optional start time; then **Queue and run**.
- **Runs** — the pipeline dashboard: live job and step status, logs, retry,
  and cancel.
- **Source tools** — single-video generation, and the Douyin importer.

### Analytics

Views, watch time, engagement rate, click-through rate, and conversions per
published video. Metrics are dated snapshots recorded per publication — entered
in the UI or posted to `/api/operations/analytics` — so the trend line reflects
the snapshots you have recorded. Nothing is pulled from platform APIs
automatically yet.

### Connections

Two halves. **Runtime connection** chooses where the database and worker live
(see [Runtime topology](#runtime-topology)). **Service connections** is the
credential checklist for every source, processor, and uploader: fill the fields
an adapter needs, test the connection, and enable it. Registered
**Authorized YouTube accounts** are listed here too — the app stores a local
credential reference, never a password, cookie, or OAuth token.

### Diagnostics

Re-runnable checks, each failure carrying a fix hint: SQLite tables and
integrity, jobs stuck running for over two hours, free disk in the work
directory, `ffmpeg` and `python3` on `PATH`, daily API quota, AI provider keys, the Douyin sidecar, the YouTube uploader,
and the Video Editor MCP connection.

The single-video tool under **Automation → Source tools** reuses these checks as
a per-job preflight: **Check steps** marks every step of the chain ready or not
before you automate it.

## Batch automation

Every job is data: a source, an ordered list of processors, an optional
uploader, and per-stage options — persisted in `config/bilibili.db` and picked
up by the worker. Adding a platform means adding one registry entry and one
adapter file (`src/lib/pipeline/registry.js`).

```text
SOURCE → videoEditor (MCP) → metadata → UPLOADER
localFile / bilibili / douyin          youtube
```

Creation presets use `videoEditor` before publishing metadata. The upload-only
preset skips creation. Built-in presets are updated automatically; custom
presets and historical jobs keep their saved data. Replace removed local
processor IDs with `videoEditor` before running an older custom workflow.

## Video Editor MCP configuration

Start `Documents/GitHub/video-automation` separately. The default endpoint is
`http://127.0.0.1:4560/mcp`. In **Connections → Video creation (Video Editor MCP)**,
set an alternate endpoint and bearer token if needed, then **Test** and enable it.
Environment alternatives:

```dotenv
VIDEO_EDITOR_MCP_URL=http://127.0.0.1:4560/mcp
VIDEO_EDITOR_MCP_TOKEN=
```

For LAN or Tailscale, use the editor host's address and its `VA_AGENT_TOKEN`.
The token is server-side; saved connection tokens use the uploader's existing
encrypted secret store. Editing tools use MCP; media bytes use the same
editor's streaming upload/download API, so the apps need no shared filesystem.

`options.videoEditor.mode` is `localize` (translate and render) or `render`
(render source media). Automatic localization requires a configured vision/text
provider in video-automation. This integration does not recreate the removed
local voiceover or FaceFusion engines. See [video creation setup and retry
behavior](docs/VIDEO_GENERATION.md).

Publishing and source settings remain in Connections. See
[.env.example](./.env.example) for runtime and publishing options.

## Runtime topology

**Connections → Runtime connection** writes `config/runtime-settings.json` and
supports three modes:

| Mode | Meaning |
|---|---|
| Server SQLite | Database beside the backend; the local worker processes jobs |
| This machine | A custom SQLite path on this machine |
| Tailscale / LAN | This UI is a thin client for another backend; the local worker pauses |

In remote mode the browser talks to `/api/control/*`, which forwards to the
configured backend's `/api/server/*` surface without an app access token.
The worker's poll interval
and the upload scheduler's interval are set in the same panel.

To run the two processes separately:

```bash
npm run dev:web   # Next.js only
npm run worker    # pipeline worker only
```

## Where files live

```text
config/bilibili.db            # jobs, video catalog, connections, publishing history
config/runtime-settings.json  # database/backend and worker settings
video-work/                   # source downloads and returned publishing assets
video-work/inbox/             # source files imported through the console
```

Each processing job has a `video-editor.json` checkpoint with its external
project/job IDs. Editing projects, models, and working renders live in
video-automation. Old Studio/proof files and database records are preserved on
disk; this refactor does not delete user media.

## Privacy and remote boundaries

The configured Video Editor host receives the full source video. Its configured
models and providers control further processing. Publishing metadata goes to
the selected text provider; publishing and scraping use their platform APIs.
Credentials stay in backend configuration. Deleting a local catalog record does
not delete the editor project or provider-side records.

## Development

```bash
npm test                 # node --test over test/*.test.mjs
npm run lint
```

Layout: `src/app` (App Router pages and API routes), `src/components` (one file
per view), `src/lib` (`pipeline`, `videoEditor`, `video`, `media`, `youtube`, `operations`, `runtime`, `db`), and
`scripts/` (server entry points plus the Python uploaders and helpers).

The browser calls `/api/control/*`, which either serves the request locally or
forwards it to a remote backend, so no component needs to know which runtime
mode is active.

## Limitations

- Video creation requires the external editor to be running and configured.
- Localization translates slides/subtitles using the editor's current tools;
  it does not promise a replacement dub or targeted face swap.
- Unknown submission outcomes stop for inspection in the editor. Saved known
  jobs resume on retry; the uploader does not blindly create replacements.
- Console access needs no app token or browser sign-in. Network reachability
  controls access; every reachable client has full workspace authority.

## Documentation

Start at the [documentation index](./docs/README.md), which marks each document
as shipped, partially implemented, or planned. The most useful ones:

- [Design philosophy](./docs/design-philosophy.md)
- [Interface design system](./docs/DESIGN_SYSTEM.md)
- [Automated video generation](./docs/VIDEO_GENERATION.md)
- [YouTube authorization linkage](./docs/YOUTUBE_AUTHORIZATION_LINKAGE.md)
