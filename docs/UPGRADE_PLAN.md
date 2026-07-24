# Upgrade Plan — Whisper.cpp + LingoLoop integration (July 9, 2026)

**PLAN ONLY — no code in this pass.** Every item lists the exact functions to add and files to delete.

> Assumption: "whispr" = the whisper.cpp local-transcription pipeline that lives in
> `~/Documents/GitHub/live-translation-app` (LingoLoop) — `src/lib/whisper-cpp.js`,
> `asr-engines.js`, `translator.js` + `api/translate`, `gemini.js`, `usage-tracker.js`.
> If a separate "whispr" repo exists, mount it and this plan's Phase A swaps sources, not shape.

The big win: `docs/VIDEO_GENERATION.md` was written when live-translation wasn't available and
left a probing loader (`backends/liveTranslation.js`) waiting for it. The repo now exists — so we
replace the speculative seam with **real ports**: local whisper.cpp STT (free, offline, GPU),
free Google-translate fallback, Gemini translate+refine, quality tiers, quota tracking, and
segment time-fitting.

---

## 1. Debug report (current state)

### Fixed since the July 3 pass ✅
B1 (JSON fence/validate), B2 (`tags` column persisted), B3 (`auto_upload_time` ISO-validated),
B6 (field-preserving updates), B7 (uploader timeout). Pipeline routes are implemented (no 501s);
GenerateStudio and all tabs are wired into `page.js`.

### Still open
| # | Bug | Where | Fix |
|---|---|---|---|
| B5 | Dead demo route: hardcoded `2024-09-08` paths, whole-file `readFileSync` | `src/app/api/bilibili/route.js` + `merge.js` | **Delete both** (also removes the only `@ffmpeg/ffmpeg` usage) |
| B8 | Both puppeteer + playwright shipped (~600 MB) | `lib/video/scraper.js`, `pipeline/registry.js` | Port scraper to Playwright, drop puppeteer dep |
| B9 | `runWithRetry(4, 600000)` sleeps 10 min in-process | `WorkflowService.js` L52 | Move retry to pipeline job-level retry state; migrate `processSpecificVideo` to `createJob()` presets, then delete the duplicated flow |
| N1 | Orphaned legacy Postgres layer — zero imports anywhere | `lib/db/getAllData.js`, `getDataArray.js`, `getCurrentStatus.js`, `updateData.js`, `getUsernames.js` | **Delete all five** + `@vercel/postgres` dep |
| N2 | Dead deps in `package.json` | `pinia` (a Vue store!), `mongoose`, `next-connect`, `node-fetch`, `@notionhq/client`, `cors`, `zustand`, `react-hook-form`, `fs-extra`, `nanoid`, `lodash`, `ffmpeg@0.0.4`, `os`, `path`, `readline`, `@ffmpeg/ffmpeg`, `@ffmpeg/util` | Remove (verify `pg` too — grep found no use) |
| N3 | LingoLoop's translator silently returns input on failure | (applies to the port, §3) | Port with loud failure — house rule: never silent fallback |

### Prevention
Add a `scripts/js/check_dead_code.mjs` (knip or a depcheck run) to CI habit; house rules at the
bottom of `.agent/context.md` already cover the rest.

---

## 2. Design-system audit (delta only)

`docs/DESIGN_SYSTEM.md` + `globals.css` tokens are in good shape. Findings:

- **2 hardcoded hexes**: `#7db0ff` gradient endpoint at `page.module.css` L47 + L882.
  → add token `--accent-2` in `globals.css`, replace both. Score after fix: tokens 100%.
- **New UI needed by this plan reuses existing components — no new CSS families:**
  - STT engine + quality picker → existing segmented control (`viewTabs`) pattern; quality
    tiers are `fast / balanced / best` (LingoLoop's naming — keep it).
  - whisper.cpp readiness → existing diagnostic rows (`check_ok/warn/fail`).
  - API usage meter → existing `progressTrack`/`progressFill` + mono metrics line.
  - New credential fields render automatically from registry `credentialFields` in the
    ServiceConnections rows — zero new form CSS.
- Keep the rules: tokens only, color is meaning, mono for machine data, one primary action.

---

## 3. Whisper.cpp local STT (port from LingoLoop) — Phase A

Today transcription is **API-only** (`lib/translation/whisper.js`, OpenAI-compatible). Make STT
pluggable exactly like TTS already is (`lib/tts/index.js` registry pattern), and add a local
whisper.cpp backend so dubbing costs $0 in transcription and works offline.

**New: `src/lib/stt/index.js`** (mirror of `lib/tts/index.js`)
- `getSttBackend(id)` → backend module; default `'openaiWhisper'`
- `listSttBackends()` → `[{id, label}]` for settings UI
- Contract every backend implements:
  `transcribe(audioPath, opts) -> { language, fullText, segments:[{index,start,end,text}] }`
  and `test(creds) -> { ok, error? }`

**New: `src/lib/stt/openaiWhisper.js`**
- Move `transcribe()` + private `normalizeSegments()` from `lib/translation/whisper.js` verbatim; add `test(creds)` (key presence + 1-token models ping).

**New: `src/lib/stt/whisperCpp.js`** — port of live-translation-app `src/lib/whisper-cpp.js`:
- `resolveToolPaths()` — adapt `lingoloopPaths()`: env `WHISPER_CPP_BIN`, `WHISPER_MODEL_DIR`,
  `FFMPEG_PATH` overrides; probe `bin/`, homebrew, `/usr/local/bin`. Drop `LINGOLOOP_HOME`;
  models default to `~/.bilibili-uploader/models`.
- `modelPathForQuality(quality)` — keep the tier map `fast→ggml-base / balanced→ggml-small / best→ggml-large-v3`.
- `getWhisperStatus(quality)` — `{ready, checks:{ffmpeg,ffprobe,whisper,model}, paths}`; reused by `test()` **and** diagnostics.
- `buildJobPlan({mediaPath, language, quality, workDir})` — port of `buildWhisperJobPlan` with one change: output goes to the **pipeline's per-job folder** (`VIDEO_WORK_DIR/<jobId>/stt/`), replacing LingoLoop's `ensureInsideWritableTemp` temp-dir jail (consistent with the B4 fix).
- `whisperJsonToSegments(payload)` — port of `whisperJsonToCues`, reshaped to the voiceover segment contract (`{index,start,end,text}`, seconds, ms-offset handling kept).
- `runCommand({bin,args}, stage)` — port as-is (spawn, no shell, stderr-tail errors) **plus a timeout arg** (house rule: every external call gets one; default 30 min).
- `transcribe(audioPath, opts)` — orchestrates plan→run→parse. Skips the ffmpeg extract step when input is already 16 kHz mono WAV (the voiceover processor extracts audio first via `media/ffmpeg.js#extractAudio` — don't do it twice).
- `test(creds)` — wraps `getWhisperStatus`, returns the missing-pieces message.

**New: `scripts/setup_whisper.sh`** — port LingoLoop's `scripts/setup-whisper.sh` (build/download whisper-cli + models into the paths above).

**Changed:**
- `processors/voiceover.js` — `resolveCreds()` gains `sttBackend` (`'openaiWhisper'|'whisperCpp'`) and `sttQuality`; `process()` calls `getSttBackend(creds.sttBackend).transcribe(...)`; `testConnection()` tests the **selected** STT backend, not just key presence.
- `pipeline/registry.js` — voiceover `credentialFields` += `sttBackend`, `sttQuality`, `whisperBin`, `whisperModelDir`.
- `pipeline/diagnostics.js` — new check `whispercpp` (runs `getWhisperStatus`; `warn` if backend not selected, `fail` if selected and missing); add to `classifyError()` mapping for "binary is not installed" errors.
- `components/GenerateStudio.js` — engine + quality segmented controls (defaults from the voiceover connection).

**Delete after migration:**
- `src/lib/translation/whisper.js` (moved into `lib/stt/openaiWhisper.js`; update the one import in `voiceover.js`).

---

## 4. Real translation backends (port from LingoLoop) — Phase B

Replaces the speculative dynamic-import loader with the code it was waiting for.

**New: `src/lib/translation/backends/googleFree.js`** — port of `googleTranslateGET`
(server-side now, so no Electron GET constraint, but the endpoint is fine):
- `translate(segments, {sourceLang, targetLang})` — per-segment GET to the `gtx` endpoint with
  small throttle + retry-once; maps to `{...seg, textEn}`.
- Fix N3 while porting: on failure **throw** (orchestrator already handles all-empty loudly);
  never return source text as "translation".
- `id='googleFree'`, `label='Google Translate (free, no key)'`.

**New: `src/lib/translation/backends/gemini.js`** — port of `gemini.js`:
- `translate(segments, {sourceLang, targetLang, refine})` — **batch** prompt (numbered lines in,
  numbered lines out — same shape-validation discipline as B1's fix) instead of LingoLoop's
  per-line calls; optional second `refinePass()` (port of `geminiRefine`).
- `test(creds)` — key check + 1-token generate.
- Credential: `geminiApiKey`, `geminiModel` (default `gemini-1.5-flash`) on the voiceover connection.
- Note: `refinePass` overlaps with the existing Kimi `rescriptSegments` polish stage — rule:
  **one polish pass max**. If `rescript=on`, skip Gemini refine (rescript wins).

**Changed:**
- `translation/translator.js` — register both in `BACKENDS`; `translationBackend` enum becomes
  `aiProvider | googleFree | gemini`.
- `docs/VIDEO_GENERATION.md` — rewrite the "Where live-translation plugs in" section: it's
  ported now, not vendored.

**Delete:**
- `src/lib/translation/backends/liveTranslation.js` — the vendor-probing loader is superseded
  (the real code is ported; nothing else imports it).

---

## 5. Quota + segment-fit + dual subs (port from LingoLoop) — Phases C/D

**New: `src/lib/pipeline/usage.js`** — port of `usage-tracker.js`, moved off `~/.scribe-center`
JSON into the existing sqlite db:
- DDL: `api_usage(day, service, key_hash, seconds)` via the `initDB`/`addColumnIfMissing` pattern.
- `checkAndIncrementUsage(service, apiKey, seconds)` — throws 403-style error over the cap
  (per-service `maxDailySeconds`, settable on each connection; default 21600 like LingoLoop).
- `getUsageSummary()` → rows for the dashboard; `maskKey(key)` ported as-is.
- Wire: voiceover charges media duration to `stt:<backend>` and `tts:<backend>`;
  `diagnostics.js` gains a `quota` check (warn ≥80%).

**New in `src/lib/media/ffmpeg.js`:**
- `fitClipToWindow(clipPath, windowSeconds, outPath)` — `probeDuration` + chained `atempo`
  (clamped 0.75–2.0; chain filters for >2×; skip if within 5%). Closes the documented
  "Segment fit" limitation in VIDEO_GENERATION.md; called in `voiceover.js` between TTS and
  `mixVoiceover` for every overrunning clip.

**New in `src/lib/translation/srt.js`** (LingoLoop dual-sub concept):
- `parseSrt(text)` → segments — lets `options.existingTranscript` accept `{srtPath}` sidecar
  files (extend `normalizeExistingTranscript` in `voiceover.js` to read it).
- `writeDualSrt(segments, path, {showTranslit})` — original + EN (+ translit line) cues; saved
  as an extra `video_assets` artifact next to the existing EN srt.
- Stretch 📋: `writeAss(segments, path, style)` for LingoLoop's cinema/boxed styles on burned subs.

**Deliberately NOT ported** (out of scope for a server pipeline): in-browser
`@xenova/transformers` fallback engine, FSRS study cards, Electron satellite/overlay, mac
SpeechHost, live-mic STT routes. The pipeline always has server-side ffmpeg — the API backend
(`openaiWhisper`) is already the fallback when whisper.cpp isn't installed.

---

## 6. Deletion summary (single checklist)

| Delete | Reason |
|---|---|
| `src/app/api/bilibili/route.js` + `merge.js` | B5 dead demo, hardcoded 2024 paths |
| `src/lib/db/getAllData.js`, `getDataArray.js`, `getCurrentStatus.js`, `updateData.js`, `getUsernames.js` | orphaned Postgres layer, zero imports |
| `src/lib/translation/whisper.js` | moved to `lib/stt/openaiWhisper.js` |
| `src/lib/translation/backends/liveTranslation.js` | superseded by real ports (§4) |
| `WorkflowService.processSpecificVideo` + `runWithRetry` | after migration to `createJob()` presets (B9) |
| deps: `pinia`, `mongoose`, `@vercel/postgres`, `next-connect`, `node-fetch`, `@notionhq/client`, `cors`, `zustand`, `react-hook-form`, `fs-extra`, `nanoid`, `lodash`, `ffmpeg`, `os`, `path`, `readline`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`; `pg` (zero imports, confirmed); `puppeteer` after B8 | dead weight (~700 MB installed) |
| `__pycache__/`, stray `.DS_Store` | add to `.gitignore` |

New deps: `@google/generative-ai` (Gemini backend only). whisper.cpp is a **binary**, not an npm dep.

---

## 7. Implementation order

1. **Deletions + dep prune** (§6 rows 1–2, 6–7) — zero-risk, shrinks the repo first.
2. **`lib/stt/` registry + `openaiWhisper` move** — pure refactor, app behavior unchanged.
3. **`whisperCpp` backend + setup script + diagnostics check + settings fields** — the headline
   feature; test on one douyin job end-to-end.
4. **`fitClipToWindow`** — small, immediately audible quality win.
5. **Translation backends `googleFree` + `gemini`** (+ doc rewrite, delete loader).
6. **`usage.js` quota + dashboard meter.**
7. **Dual-SRT + `parseSrt` sidecar input.**
8. **B8 scraper→Playwright, then B9 WorkflowService migration** — last; touches the legacy flow.

Verification per step: `npm run build` + one real job through GenerateStudio (private-first
upload, per house rules); for step 3 also `getWhisperStatus` all-green in Troubleshooter.
