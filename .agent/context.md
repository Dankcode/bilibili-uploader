# Project Context

## Overview
Automated Youtube video uploader and management suite. Replaced Notion with a local SQLite engine and a LAN-accessible management dashboard.

## Tech Stack
- **Frontend**: Next.js (App Router), React, CSS Modules.
- **Database**: SQLite via `better-sqlite3`.
- **State Management**: React Hooks (`useState`, `useEffect`) and Server Actions.
- **Video Processing**: FFmpeg and Python core logic.
- **AI Integration**: Kimi 2.5 API for high-quality text translation and metadata generation.
- **Networking**: Configured for LAN access on port **4455**.

## Core Features
1. **Automated Workflow**:
    - **Scraping**: Fetches new video data from Bilibili space URLs.
    - **AI Metadata**: Translates Chinese titles and generates catchy English names and descriptions.
    - **Download/Merge**: Automated acquisition of video/audio streams and merging via FFmpeg.
    - **Uploading**: Integration with Python-based YouTube uploader.

2. **Studio Suite Dashboard**:
    - **Real-time Monitoring**: Table view of all video statuses (Not started, In progress, Done).
    - **Manual Modification**: Ability to edit titles and descriptions before upload.
    - **Remote Control**: LAN-optimized UI for management from mobile devices on the local network.

3. **Robust Lifecycle**:
    - Persistent local storage in `config/bilibili.db`.
    - Graceful database shutdown on application termination (SIGINT/SIGTERM).

## Core Goal
Streamline the creation and promotion of marketing-focused video content through high-automation and centralized local control.

---

# EXPANSION PLAN — Modular Pipeline, Douyin, AI voiceover/editing, Scene Intel (July 2026, scaffolded, NOT implemented)

> Legend: ✅ done · 🏗️ stub created (functions + contracts in comments, no logic) · 📋 planned only.
> All 🏗️ files created 2026-07-03. Nothing is wired into `page.js` yet — the existing app runs unchanged.

## Debug Report — July 3 2026 pass on the older code

| # | Bug | Where | Impact | Fix plan |
|---|---|---|---|---|
| B1 | AI metadata parsed with bare `JSON.parse(aiResponse)` — no fence stripping, no shape check | `WorkflowService.processSpecificVideo` (~L126) | Models often wrap JSON in ```json fences or return prose → whole workflow throws mid-run; malformed `Title`/`Tags` pass through silently | Strip fences, validate `{Title, Description, Tags[]}` shape, retry once on parse failure, loud fallback otherwise |
| B2 | **Tags are never persisted** — no `tags` column; `updateVideoMetadata` doesn't save them | `WorkflowService` + `lib/db/sqlite.js` | Any re-run after metadata exists (`english_name` set) takes the `tags = []` path → video uploads with EMPTY tags | Add `tags` column (JSON text), save on generation, read on re-run |
| B3 | `getDueUploads` compares `auto_upload_time` (may be `HH:mm` per its own comment) to a full ISO string lexically | `lib/db/sqlite.js` (~L157) | `'14:30' <= '2026-07-03T…'` is string comparison → `HH:mm` values are ALWAYS "due" (fires immediately) or never, depending on first char | Normalize to ISO on write (`manualEdit`/`updateVideoMetadata`); reject non-ISO input |
| B4 | Download output named `Videos/<date>.mp4` — date-only key | `WorkflowService` (~L148) + `processBilibiliUrl` | Two videos processed the same day overwrite each other; cleanup in `finally` (`removeVideos`) can delete a concurrent run's files | Per-job folders `VIDEO_WORK_DIR/<jobId>/` (pipeline design §F does this); scope cleanup to the job folder |
| B5 | `api/bilibili/route.js` is dead demo code: hardcoded `2024-09-08` paths, unused top-level `ffmpeg()` command, `fs.readFileSync` of a whole video into memory | `src/app/api/bilibili/route.js` | Route 500s on every call (files don't exist); if they did, buffering GB files in memory | Delete or rewrite as a streaming response with request-provided paths (validated) |
| B6 | `manualEdit`/`updateVideoMetadata` bind possibly-`undefined` values | `lib/db/sqlite.js` | better-sqlite3 THROWS on `undefined` bindings → dashboard edits with partial payloads crash the action | Coalesce every field to `?? existingRow.value ?? null` (field-preserving update) |
| B7 | No timeout on spawned python uploaders; result = last stdout line | `lib/video/uploader.js` | A hung uploader blocks the workflow forever; any trailing python print corrupts the returned URL | 30-min kill timer on the child; make scripts print ONLY the URL last; parse defensively |
| B8 | Both `puppeteer` AND `playwright` are dependencies | `package.json` | Two headless-Chromium stacks (~600MB) for one job | Standardize on Playwright (scenes engine needs it anyway); port `lib/video/scraper.js` 📋 |
| B9 | `runWithRetry` sleeps 10 min in-process between attempts | `WorkflowService` | If triggered from a server action/route, holds the request open up to 40 min | Move retries into the pipeline worker (job-level retry state), not request lifetime |

## F. Modular Pipeline (design system)

**Problem:** the flow is hardcoded bilibili → YouTube inside `WorkflowService`. **Design:** adapters behind
one registry; a job is pure data executed by a worker:

```
SOURCE (import)          PROCESSOR chain (0..n, ordered)        UPLOADER (publish)
bilibili ─┐                voiceover (whisper clone EN VO)        youtube ─┐
douyin  ──┼──► download ──►aiEditor  (HF LAN vid2vid, "cats") ──► upload ──┼──► videos table
future  ──┘                sceneCut  (ffmpeg snippet cutter)      future ──┘
```

Job = `{ sourceId, sourceInput, processorIds[], uploaderId, options }` in SQL. Adding a platform = one
registry entry + one adapter file. The existing bilibili→youtube flow becomes a preset;
`WorkflowService.processSpecificVideo` migrates to `createJob(...)` and the duplicated logic is deleted
once the pipeline runs green 📋.

**Files (all in the EXISTING `config/bilibili.db` via better-sqlite3, `initDB` pattern):**
- 🏗️ `src/lib/pipeline/registry.js` — `SOURCES`/`PROCESSORS`/`UPLOADERS`, getters, `listServiceChecklist()`; adapter contracts in header
- 🏗️ `src/lib/pipeline/pipeline.js` — job worker + full DDL (`video_jobs`, `video_job_steps`, `video_assets`);
  per-job folders under `VIDEO_WORK_DIR` (fixes B4); one job at a time v1; retry resumes from failed step
- 🏗️ `src/lib/pipeline/connections.js` — `service_connections` table = the settings CRM store (DDL in header); secrets server-side only
- 🏗️ `src/lib/pipeline/sources/bilibili.js` — WRAPS existing `lib/video/scraper.js` + `processBilibiliUrl` (no duplication)
- 🏗️ `src/lib/pipeline/sources/douyin.js` — HTTP client for the vendored sidecar (§F1)
- 🏗️ `src/lib/pipeline/uploaders/youtube.js` — WRAPS existing `lib/video/uploader.js`, adds timeout (B7) + testConnection + privacyStatus
- 🏗️ `src/lib/pipeline/processors/voiceover.js` / `aiEditor.js` (§G) · 📋 `processors/sceneCut.js` (fluent-ffmpeg beats cutter)
- 🏗️ routes: `api/pipeline/jobs` (create|retry|cancel), `api/pipeline/diagnostics`, `api/settings/connections` (save|test|enable) — all 501, action whitelists
- 📋 `/api/pipeline/assets/:id` preview-stream route (no raw paths to the client)

### F1. Douyin integration (vendored ✅)

`vendor/douyin-downloader/` = clone of `jiji262/douyin-downloader` (2026-07-03, git history stripped).
**Run as a Python sidecar, don't port it**: FastAPI server (`server/app.py`: `GET /health`, `POST /jobs {url}`,
`GET /jobs/{id}`), URL parser for video/profile/mix/music links, SQLite dedupe, retries, and
`cli/whisper_transcribe.py` (reuse its transcript in the voiceover processor).
Setup: `cd vendor/douyin-downloader && pip install -r requirements.txt && cp config.example.yml config.yml
&& python run.py --server --port 8756`. Sidecar URL + cookie live in settings (`douyin` connection).
📋 optional docker-compose from its Dockerfile.

## G. Voiceover + AI Editor + settings CRM

- 🏗️ `processors/voiceover.js` — whisper-clone EN VO: transcribe → translate (reuse `lib/ai/getEnglish.js`
  provider layer — add a generic `completeJson()` helper 📋) → per-segment TTS (`voiceId`) → fluent-ffmpeg
  duck+overlay (+optional burned subs). Artifacts (transcripts, srt) persist on `video_assets` for reuse.
- 🏗️ `processors/aiEditor.js` — HuggingFace LAN vid2vid ("turn the video into cats"): Gradio
  (`@gradio/client` 📋) or REST; model candidates in header (AnimateDiff+ControlNet / RAVE / TokenFlow;
  LTX-Video / CogVideoX); ~4s chunking for VRAM.
- **Settings CRM**: 🏗️ `src/components/ServiceConnections.js` renders every service + scraper site as
  checklist rows (configured → tested → enabled; credential forms from registry `credentialFields`;
  Test button → adapter `testConnection`). Backed by `service_connections` + `api/settings/connections`.
  Over time env-var creds (KIMI_API_KEY etc.) migrate here 📋.

## H. Dashboard + Troubleshooting

- 🏗️ `src/components/PipelineDashboard.js` — polls `api/pipeline/jobs` (3s): per-step SQL progress bars,
  filters, loading skeletons, Retry/Cancel, "Why?" → troubleshooter deep-link.
- 🏗️ `src/lib/pipeline/diagnostics.js` — `runDiagnostics()` → `[{id,label,status,detail,fixHint}]`;
  13 checks (db, ffmpeg, python, disk, sidecar, cookies, LAN services, youtube OAuth, ai key, scraper
  logins) + `classifyError()` job-error → check mapping.
- 🏗️ `src/components/Troubleshooter.js` — dumb renderer of checks + fix hints.

## I. Scene Intelligence (Weibo/XHS scraper → Kimi → auto-produce)

Flow: `scrapeShow()` → `scene_mentions` → `clusterScenes()` (Kimi) → `scene_candidates` (+heat score) →
human approve → `draftSceneScript()` (EN VO SceneScript) → human approve → `generateSceneVideo()` =
one pipeline job (`sceneCut` + `voiceover` → youtube **private-first**).

- 🏗️ `src/lib/scenes/store.js` — DDL: `shows` (+`source_hint` for where episodes come from),
  `scene_mentions` (site+post_id dedupe), `scene_candidates` (status ladder), `scene_scripts` (approved
  gate); heat formula (log-scaled engagement, multi-site boost, 72h half-life) as a pure function.
- 🏗️ `src/lib/scenes/scraper.js` — `SCRAPER_SITES` (weibo=API+playwright fallback, **xiaohongshu=playwright**,
  douban/tieba=cheerio 📋), normalized mention shape, politeness rules, `scrapeShow()`, `testFetch()`.
- 🏗️ `src/lib/scenes/browserScraper.js` — **Playwright engine** (playwright already a dep ✅ — just
  `npx playwright install chromium`). **INTERACTIVE login**: `startInteractiveLogin(siteId)` opens a
  VISIBLE browser window; the USER logs in themselves (**email preferred**, SMS/QR fine — it's the site's
  real page); app never touches credentials, `pollLogin()` waits for the logged-in marker (15-min cap),
  persists profile + storageState backup. `importCookies()` paste fallback. Scraping harvests the page's
  own API responses via interception. Selectors live only in this file. NOTE: window opens on the SERVER's
  display (app is LAN-exposed on 4455) — log in at the machine, or add CDP-screencast mode 📋.
- 🏗️ `src/lib/scenes/analyzer.js` — `clusterScenes()` + `draftSceneScript()` prompt specs + **SceneScript
  shape** (hook/beats[tStart,tEnd,voiceoverEn]/outro/titleEn/descriptionEn/tags); `validateSceneScript()`
  gate — loud failure, never silent (don't repeat B1).
- 🏗️ `src/lib/scenes/generator.js` — `generateSceneVideo()` composes `pipeline.createJob`; preconditions
  listed; needs `onJobDone` hook in pipeline.js 📋.
- 🏗️ routes: `api/scenes` (add-show|scrape|analyze|draft-script|approve|produce), `api/scenes/login`
  (start|poll|import-cookie|status). 🏗️ UI: `SceneRepository.js`, `ScraperLogin.js`.

## J. UI wiring + implementation order

New components (🏗️ in `src/components/`, NOT yet wired): DouyinImporter, PipelineDashboard,
Troubleshooter, SceneRepository, ServiceConnections, ScraperLogin. Wire them as top-level tabs in
`src/app/page.js` alongside the existing space tabs (page.js already has the tab pattern) 📋.

**Suggested PRs:**
1. **Bug fixes B1–B3, B6, B7** (small, independent, protect the current app)
2. Pipeline tables + `createJob/listJobs` + worker skeleton + PipelineDashboard read path (F)
3. Douyin sidecar adapter + DouyinImporter tab (F1) — first Douyin import works, download-only
4. `service_connections` + ServiceConnections settings tab + `api/settings/connections` (G)
5. Diagnostics + Troubleshooter (H) — before the LAN services so their setup is debuggable
6. youtube adapter wrap (+timeout) and migrate WorkflowService onto `createJob` presets (F); delete B5 dead route
7. Voiceover processor (G) → 8. aiEditor processor (G) → 9. sceneCut processor
10. Scene store + weibo scraper → 11. browserScraper interactive login + XHS playwright (I)
12. Kimi analyzer + SceneRepository (I) → 13. `generateSceneVideo` + onJobDone hook — full loop

**Deps at impl time:** `npx playwright install chromium`; npm `@gradio/client`, `cheerio`; system `ffmpeg`,
Python 3.10+ (sidecar). **House rules going forward:** validate every AI/browser/third-party payload before
persistence; every external call gets a timeout; no `undefined` into SQL bindings; secrets server-side only;
never auto-publish unreviewed AI output (private-first uploads).
