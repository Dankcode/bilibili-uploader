# Subtitle Studio — Integration Plan (plan only, no code yet)

Goal: merge the transcription/translation capabilities of
`~/Documents/GitHub/live-translation-app/dual-sub-video` (LingoLoop) into
bilibili-uploader as a new **Subtitle Studio** tab with a **Test Mode**:
upload a video → local Whisper transcription (timestamped `.md`) →
synchronized frame screenshots → Kimi vision correction → Kimi translation
(zh → en default) → editable `.ass`/`.srt` subtitles with save/load, an AI
refine chat (tone/style edits with timestamps preserved, reset history), and
in-browser preview / download. Plus an app-wide UI cleanup pass.

---

## 1. What each app already has (verified)

### bilibili-uploader (this repo)
| Capability | Where |
|---|---|
| Whisper via OpenAI-compatible API (`verbose_json`, segments) | `src/lib/translation/whisper.js` |
| Translation orchestrator, pluggable backends | `src/lib/translation/translator.js` |
| Kimi/OpenAI provider (translate + re-script, JSON-safe) | `src/lib/ai/getEnglish.js` (`KIMI_API_KEY`, `KIMI_BASE_URL`, `moonshot-v1-8k`) |
| SRT builder | `src/lib/translation/srt.js` |
| ffmpeg helpers (extract audio, probe, mix, burn subs) | `src/lib/media/ffmpeg.js` |
| Tabbed operator console + design tokens | `src/app/page.js`, `src/app/globals.css`, `docs/DESIGN_SYSTEM.md` |
| SQLite persistence | `src/lib/db/sqlite.js` (better-sqlite3) |
| Work dirs | `video-work/`, `videos/` |

### dual-sub-video (LingoLoop)
| Capability | Where |
|---|---|
| **Local** Whisper (no API key): `@xenova/transformers` + `ffmpeg-static`/`@ffprobe-installer`, model cache in `~/.lingoloop/models`, tiny/base/small quality tiers, NDJSON job logs | `src/lib/local-transcription.js` |
| Upload → transcribe route (multipart or desktop path, health check GET) | `src/app/api/transcribe/route.js` |
| ASS/SSA + SRT/VTT parse and build (`parseAss`, `makeAss`, `secondsToAss`, dual-style Original/Translation) | inside `src/app/page.js` (~lines 325–510) |
| Translation (google-translate / Gemini) | `src/lib/translator.js`, `src/lib/gemini.js` |

Decision: **port, don't runtime-link.** The `LIVE_TRANSLATION_PATH` adapter
(`src/lib/translation/backends/liveTranslation.js`) stays for the voiceover
pipeline, but Subtitle Studio gets the LingoLoop code copied into this repo —
LingoLoop is Next 16/React 19/Electron, this app is Next 14/React 18, so
importing it wholesale is not viable. Only two things are worth porting:
`local-transcription.js` and the subtitle parse/build functions.

---

## 2. New module layout (all new code under `src/lib/studio` + one component)

```
src/lib/studio/
  localWhisper.js      ← port of dual-sub-video local-transcription.js
                          (strip Electron paths; cache under ~/.bilibili-uploader/models;
                           keep quality tiers fast=tiny / balanced=base / best=small)
  frames.js            ← ffmpeg frame extraction: one jpg per segment midpoint
                          (ffmpeg -ss <t> -frames:v 1 -q:v 3), plus scene-change
                          extra frames (select='gt(scene,0.4)') capped at N total
  markdown.js          ← transcript ⇄ .md serializer (format in §4)
  subtitles.js         ← port of parseAss/makeAss/secondsToAss + reuse srt.js;
                          parse+build .ass, .srt, .vtt; round-trip safe
  kimi.js              ← Kimi client wrapper on top of getEnglish.js config:
                          - translateSubtitles(assText, {from:'zh', to:'en'})
                          - refine(assText, instruction, history)
                          all calls: strict system prompt "this is a subtitle
                          file; return the SAME timestamps/line structure",
                          response validated by re-parsing before accepting
  vision/index.js      ← DELIBERATELY AMBIGUOUS vision-correction seam
                          (provider TBD: codex image, local model, or Kimi
                          vision — wired later). One contract:
                            correctSegments(batch) where batch =
                              [{ segIndex, timeMs, imagePath, text }]
                            -> [{ segIndex, text }]
                          Registry pattern like translation/translator.js;
                          backend chosen by env VISION_BACKEND (unset =
                          stage 3 is skipped with a clear "no vision backend
                          configured" notice, pipeline still completes).
                          Adapter stubs only, no implementations yet:
                          vision/backends/{codex,local,kimiVision}.js
  store.js             ← project persistence (SQLite table `studio_projects`:
                          id, name, videoPath, transcriptMd, subtitleText,
                          format, chatHistory JSON, createdAt, updatedAt)

src/app/api/studio/
  transcribe/route.js  ← POST multipart video (or local path) → save under
                          video-work/studio/<projectId>/ → localWhisper →
                          segments + transcript.md ; GET → model/ffmpeg health
  frames/route.js      ← POST projectId → frames.js → frames/<idx>_<ms>.jpg,
                          returns manifest [{segIndex, timeMs, file}]
  correct/route.js     ← POST projectId → vision/index.js correctSegments
                          (screenshots + transcript.md) → corrected
                          transcript.md (v2); 501-style notice if no
                          VISION_BACKEND configured
  translate/route.js   ← POST projectId {from='zh', to='en', format='ass'} →
                          kimi.translateSubtitles → .ass (+ .srt) files
  refine/route.js      ← POST projectId {instruction} → kimi.refine with stored
                          chatHistory; DELETE → reset chat history
  project/[id]/route.js← GET load / PUT save (Save button) / GET ?download=ass|srt|md
  media/[id]/route.js  ← range-request video streaming for the preview player

src/components/SubtitleStudio.js   ← the Test Mode tab (§5)
```

Registered in `src/app/page.js` `NAV_ITEMS` as `['studio', 'Subtitle Studio']`.

New dependencies: `@xenova/transformers`, `ffmpeg-static`,
`@ffprobe-installer/ffprobe` (all already proven in LingoLoop; keeps
transcription fully local — no Whisper API key needed for test mode; the
existing API-based `translation/whisper.js` remains as a selectable engine).

---

## 3. Pipeline (Test Mode flow)

```
[Upload video]
   └─ POST /api/studio/transcribe        (multipart; quality fast/balanced/best;
      │                                   source lang default zh, target en)
      ▼
[1. Transcribe]  localWhisper → segments [{index,start,end,text}]
      │           → transcript.md written (timestamps embedded, §4)
      ▼
[2. Screenshots] frames.js → one frame per segment midpoint + scene-change
      │           frames; filenames carry ms so frame↔segment sync is explicit
      ▼
[3. Vision correction]  pluggable backend (TBD) gets batches of
      │           {screenshot, matching md lines} → fixes OCR-able text
      │           (PowerPoint slides, TikTok captions, on-screen text) →
      │           corrected transcript.md; timestamps must round-trip.
      │           SKIPPED gracefully when no backend is configured.
      ▼
[4. Translate]   Kimi text model: corrected md → English .ass (dual-style
      │           Original/Translation like LingoLoop makeAss) + .srt
      ▼
[5. Edit]        UI editor; Save button persists via PUT /api/studio/project/:id
      ▼
[6. Refine chat] instruction box → Kimi rewrites subtitle text only,
      │           timestamps validated; Reset-history button
      ▼
[7. Preview / Download]  video player with subtitle overlay; download md/ass/srt
```

Each stage is a separate button + API call (not one monolith) so any stage can
be re-run after manual edits. Stage state shown as a simple step tracker.

### Kimi specifics (stages 4 and 6 — text only)
- Text calls reuse the provider config in `getEnglish.js` (`KIMI_API_KEY`,
  `KIMI_BASE_URL=https://api.moonshot.cn/v1`).

### Vision backend (stage 3) — intentionally left open
- Provider undecided: codex image, a local model, or Kimi vision will be
  wired in later by the operator. The plan only fixes the seam: the
  `correctSegments(batch)` contract in `src/lib/studio/vision/index.js`,
  env selection via `VISION_BACKEND` (+ backend-specific env like endpoint/
  key/model read inside each adapter), and graceful skip when unset. Frame
  extraction, the frame⇄segment manifest, and md round-trip validation are
  built regardless, so plugging in any backend is a one-file adapter.
- **Timestamp safety rule (applies to correct/translate/refine):** the model
  is instructed to return the full subtitle document unchanged except text
  lines; the server re-parses the reply with `subtitles.js` and rejects the
  response (one retry, then error) if segment count or any timestamp differs.
  Never trust model output blindly into the project file.
- Chat history for refine is stored per project (so "make it more casual"
  then "undo that tone for lines 10–20" works); Reset clears it. Also expose
  model + temperature as advanced fields on the refine panel.

---

## 4. Transcript `.md` format

```md
# Transcript — <video name>
- source: zh   target: en   duration: 00:04:12
- generated: <iso date>   engine: whisper-local/<model>

## Segments
### [00:00:01.240 --> 00:00:04.980] #1
原文 line…
### [00:00:05.100 --> 00:00:08.400] #2
原文 line…
```

- Human-readable, diff-able, and machine-parseable (`markdown.js` round-trips
  it to segments).
- After stage 3, corrected text simply replaces the segment body; a
  `corrected: true` flag is added to the header.
- Frame manifest is written next to it (`frames.json`) so screenshots and md
  stay synchronized by segment index + ms.

---

## 5. Subtitle Studio UI (single component, three columns)

- **Left — Source & Pipeline:** file drop/upload, quality + language selects
  (defaults zh → en), step tracker with per-stage Run buttons and status,
  health check line (ffmpeg / model cache), project list (load previous).
- **Center — Editor:** plain monospace textarea showing the md transcript or
  the .ass/.srt text (toggle), Save button, format select for download,
  unsaved-changes indicator. No rich editor — text with visible timestamps is
  the point.
- **Right — Preview & Refine:** HTML5 `<video>` streaming from
  `/api/studio/media/:id` with subtitle overlay rendered from parsed cues
  (click a segment in the editor → seek); refine instruction input + Send,
  compact chat history, Reset history button; Download buttons (md / srt /
  ass / video).

---

## 6. UI cleanup pass (whole app)

The design system (`docs/DESIGN_SYSTEM.md`, tokens in `globals.css`) already
targets a dense professional console — keep it, tighten it:

1. Set radius tokens to square/near-square (`--radius: 2px` or 0) — removes
   rounded corners everywhere at once since components read tokens.
2. Audit `page.module.css` for hardcoded radii/shadows/gradients; replace
   with tokens; delete decorative effects.
3. Buttons: keep full text labels on primary actions (no icon-only for
   destructive/primary), consistent height, accent only on the single
   primary action per panel.
4. Normalize spacing + table density across tabs (Generate, Content Queue,
   Douyin, Pipeline, Scene Intel, Connections, Diagnostics, new Studio).
5. Update `DESIGN_SYSTEM.md` to record the square-corner rule.

---

## 7. Automation: Studio → Voiceover → Metadata → Upload

The existing pipeline is already the right chassis — jobs are pure data
(`{sourceId, sourceInput, processorIds[], uploaderId, options}` in
`src/lib/pipeline/pipeline.js`, adapters in `registry.js`) and the
`voiceover` processor already accepts `options.existingTranscript`
(`{srtPath}` or segments — `normalizeExistingTranscript`). The plan wires
Studio output into that chassis instead of building a second pipeline.

### 7.1 Feed Studio results into voiceover (no double work)

- Extend `processors/voiceover.js` options with `existingTranslation`:
  segments that already carry `textEn` (or a dual-language studio `.srt`/
  `.ass`) cause the processor to **skip transcription AND translation** and
  go straight to Kimi re-script (optional) → TTS → ffmpeg mix/burn.
  Today `existingTranscript` only skips Whisper; this adds the second skip.
- `src/lib/studio/publish.js` — builds that payload from a studio project:
  video path + translated segments (from the saved `.ass`/`.srt`, parsed by
  `studio/subtitles.js`) + language metadata.

### 7.2 One-click publish from Studio

- `POST /api/studio/publish` → creates a normal pipeline job:
  `source: localFile` (studio output video) →
  `processors: [voiceover(existingTranslation), metadata]` →
  `uploader: youtube`. Job then appears in the existing Pipeline tab with
  its step tracker, retry, and logs — no new job UI needed.
- Studio right column gains a **Publish** panel: checkboxes for
  [voiceover dub] [burn subtitles] [auto metadata] [auto upload], channel
  select, and one button: **Send to pipeline**. Unchecked stages are simply
  omitted from `processorIds`/`uploaderId` (e.g. stop after dub to review).

### 7.3 Metadata processor (description + tag generator)

- New `src/lib/pipeline/processors/metadata.js` + registry entry.
  Generalizes `getEnglishData()` (currently hardcoded to an ASMR persona in
  `src/lib/ai/getEnglish.js`) into a processor:
  input = translated transcript (+ optionally 2–3 studio frames via the
  vision seam) → output `{ titleEn, descriptionEn, tags[] }` written into
  job meta — exactly the fields `uploaders/youtube.js` already reads
  (`meta.title/description/tags`).
  - Prompt style becomes a connection setting (`metadataStyle`), with the
    current ASMR prompt as one preset; WorkflowService keeps working via the
    same function.
  - Manual override: job pauses only if `reviewMetadata: true`; default is
    fully automatic.

### 7.4 Pipeline usability pass

- **Presets** (stored, one click): "Studio Full Auto" (localFile → voiceover
  w/ studio subs → metadata → youtube), "Dub only", "Upload only".
  Implemented as saved job templates; the Generate tab gets a single
  "Automate" button + preset dropdown instead of manual adapter picking.
- Chain trigger: when a Studio project reaches "translated" state with
  auto-mode on, publish fires automatically (setting: `studioAutoPublish`).

## 8. Gemini provider — image tasks + Kimi fallback

- `GEMINI_API_KEY` lives in `.env` (gitignored) — never in docs or code.
  `.env.example` gets the placeholder. The key you provided is stored there;
  rotate it if it was ever shared anywhere non-private.
- **Image tasks:** `studio/vision/backends/gemini.js` becomes the first
  implemented vision adapter (port of LingoLoop `src/lib/gemini.js`,
  `@google/generative-ai`), default when `VISION_BACKEND` is unset but
  `GEMINI_API_KEY` is present. Codex/local/Kimi-vision adapters remain
  stubs to be wired later (§2 seam unchanged — still swappable).
- **Text fallback:** provider layer (`getEnglish.js` config) gains a
  fallback chain: primary Kimi → on auth/quota/network failure, retry once
  via Gemini (`GEMINI_MODEL`, default `gemini-2.0-flash`) with the same
  prompt + the same re-parse timestamp validation. Applies to translate,
  refine, re-script, and metadata calls. Job logs record which provider
  answered.

## 9. Implementation order (each step ends runnable)

1. **Port foundation** — `studio/localWhisper.js`, `studio/subtitles.js`,
   `studio/markdown.js` + deps install; unit-test round-trips (md⇄segments,
   ass⇄cues) with a fixture file.
2. **Transcribe path** — upload route + storage layout + health GET; verify
   with a short zh sample video end-to-end to `.md`.
3. **Frames** — `frames.js` + route + manifest; eyeball sync on the sample.
4. **Kimi layer** — `studio/kimi.js` (translate, then refine+history+reset)
   with the re-parse validation gate; `studio/vision/` seam + stub adapters
   only (real backend wired later by operator).
5. **Studio UI** — component, editor save/load, preview player, downloads.
6. **Gemini provider** — vision adapter + text fallback chain (§8).
7. **Voiceover handoff** — `existingTranslation` skip logic in
   `processors/voiceover.js` + `studio/publish.js` + publish route/panel
   (§7.1–7.2); verify a studio project dubs without re-transcribing.
8. **Metadata processor + presets** — §7.3–7.4; end-to-end "Studio Full
   Auto" run on a sample video through to a (private) YouTube upload.
9. **UI cleanup pass** (§6) across the app.
10. **Review** — run `/engineering:code-review` on the diff; use
    `/engineering:debug` for any stage that misbehaves with real videos.

## 10. Risks / notes

- `@xenova/transformers` on Node 18/Next 14: LingoLoop runs it under Next 16;
  needs `runtime='nodejs'` + `maxDuration` on the route (as LingoLoop does)
  and `serverComponentsExternalPackages` entry in `next.config.mjs`.
- Long videos: frame count cap (default ~60); translate chunked by ~50
  segments with overlap context. Vision batch size is a per-adapter concern
  (decided when a backend is wired in).
- `moonshot-v1-8k` is small for full-file translation — default translate/
  refine to a larger context model via `KIMI_MODEL` (e.g. `moonshot-v1-32k`
  or `kimi-latest`) when subtitle text exceeds ~6k tokens; chunk otherwise.
- Uploads up to 2 GB (LingoLoop's cap); stream to disk, never buffer in the
  React state.
- Everything stays local except Kimi calls; screenshots/audio are temp files
  under `video-work/studio/` and cleaned by a project delete action.
