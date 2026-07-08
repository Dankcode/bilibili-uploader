# Automated Video Generation — Translation & Voiceover

This documents the video-generation stage of the pipeline: taking a
source-language video (Chinese or otherwise) and producing an English-dubbed
video, fully automated. It slots into the existing modular pipeline as the
`voiceover` **processor**, so it composes with any source (bilibili, douyin) and
any uploader (youtube) with no special-casing.

```
SOURCE ─► download ─► ┌──────────────── voiceover processor ────────────────┐ ─► [faceFusion] ─► UPLOADER
 bilibili/douyin      │ extract audio → transcribe → translate(+translit)    │   targeted face   youtube
                      │ → Kimi RE-SCRIPT → TTS/segment (ElevenLabs|CosyVoice) │   swap (auto)
                      │ → ffmpeg duck+overlay (+optional burned subs)         │
                      └──────────────────────────────────────────────────────┘
```

The chain is data-driven: a job lists `processorIds` in order, so you can run
`voiceover` then `faceFusion` (dub, then swap faces), or either alone.

## Data flow

1. **Extract audio** — `lib/media/ffmpeg.js#extractAudio` → mono 16 kHz WAV.
2. **Transcribe** — `lib/translation/whisper.js` (OpenAI-compatible Whisper,
   `verbose_json`, segment timestamps) → `{ language, segments[{index,start,end,text}] }`.
   Reuses `options.existingTranscript` when the scene pipeline already produced one.
3. **Translate (+ transliterate)** — `lib/translation/translator.js` runs the
   chosen backend, then adds romanization. Output segments carry
   `{ text (source), textEn, translit, start, end }`.
4. **Re-script (Kimi)** — `lib/ai/getEnglish.js#rescriptSegments` rewrites the
   literal translation into fluent, broadcast-style narration **without** changing
   segment count/order/timing. Prefers the Kimi provider; non-fatal (falls back
   to the literal translation if it fails). Toggle with `rescript`.
5. **Synthesize** — `lib/tts/index.js` dispatches to the selected engine:
   **ElevenLabs** (`eleven_multilingual_v2`, cloud) or **CosyVoice** (Alibaba,
   self-hosted local voice clone). Each engine is one file behind a shared
   `synthesizeToFile` contract.
6. **Assemble** — `lib/media/ffmpeg.js#mixVoiceover` ducks the original audio to
   ~15% and overlays each TTS clip at its segment start (`adelay` + `amix`).
   Optional burned English subtitles (`burnSubtitles`).
7. **Persist** — returns `{ outputPath, artifacts }`; the pipeline writes the
   transcript, translated text, re-scripted narration, SRT, backends, and
   duration as `video_assets` so re-runs and the scene engine reuse them.

### Choosing the narration voice (TTS)

Set `ttsBackend` on the voiceover connection:

- `elevenlabs` (default) — cloud, best quality. Needs `elevenApiKey` + `voiceId`.
- `cosyvoice` — Alibaba's open-source **CosyVoice**, run locally (no per-use
  cost, full voice-clone control). Run the model's FastAPI server and set
  `cosyEndpoint` (+ `cosyMode`, and either `cosySpeakerId` for a preset speaker
  or `cosyPromptWav`/`cosyPromptText` for zero-shot cloning). Client lives in
  `lib/tts/cosyvoice.js`. Start it with, e.g.:
  `python3 server.py --port 50000 --model_dir iic/CosyVoice-300M`
  (from `CosyVoice/runtime/python/fastapi`).
- `qwen3` — Alibaba Qwen team's **Qwen3-TTS** (10 languages + dialects, voice
  design/cloning). Two paths behind `lib/tts/qwen3.js`:
  **cloud** via DashScope — set `qwenApiKey` (+ optional `qwenVoice`,
  `qwenModel` default `qwen3-tts-flash`, `qwenBaseUrl` = the `-intl` host for
  international accounts); or **local** — set `qwenLocalEndpoint` to a
  self-hosted Qwen3-TTS server (OpenAI-compatible `/v1/audio/speech`), which
  overrides the cloud path.

All keys/options are saved to the DB when you press **Save** in Settings.

## FaceFusion — automated targeted face swap

`faceFusion` is a separate processor (`lib/pipeline/processors/faceFusion.js`)
that wraps the [FaceFusion](https://github.com/facefusion/facefusion) headless
CLI. Add it to a job's `processorIds` (typically after `voiceover`) and it swaps
faces in the video automatically.

**One-time setup:** `bash scripts/install_facefusion.sh ~/facefusion cuda`
(use `cpu` if no NVIDIA GPU), then set `facefusionDir` in Settings ▸ faceFusion.
The processor also auto-clones the repo on first Test if the folder is empty.

**Targeting specific faces automatically** (no manual step per video):

- `faceSelectorMode = reference` + `referenceFacePosition` / `referenceFrameNumber`
  / `referenceFaceDistance` → only swaps the chosen person's face.
- `faceSelectorGender = male|female` → swap only that gender.
- `one` (most prominent face) or `many` (every face).

`sourcePaths` = the replacement face image(s) (`;`-separated). Optional
`faceEnhancer = on` adds GFPGAN enhancement. Runs headless with a 1-hour cap;
progress is parsed from CLI output. Needs a GPU for reasonable speed.

## Where `live-translation` plugs in

Translation is the one stage designed to be swapped for your
`~/Documents/GitHub/live-translation` project. The seam is
`lib/translation/backends/liveTranslation.js`.

**To wire in the real code:**

1. Vendor it: copy or symlink the repo to `vendor/live-translation/`, **or** set
   `LIVE_TRANSLATION_PATH=/absolute/path` in `.env`.
2. Ensure it exposes one of these shapes (the adapter probes in order, so you
   usually don't have to modify live-translation at all):
   - `translateSegments(segments, { sourceLang, targetLang }) -> [{ index, textEn, translit? }]` (preferred, timing-aware), or
   - `translate(text, opts) -> string` and optional `transliterate(text) -> string` (per-line).
3. In **Settings ▸ Connections ▸ voiceover**, set `translationBackend =
   liveTranslation`.

Until then the default `aiProvider` backend (`lib/ai/getEnglish.js`, your
existing Kimi/OpenAI layer) handles translation and `pinyin-pro` (optional)
handles romanization — so the full pipeline already runs end-to-end today.

> Note: the folder wasn't present at `~/Documents/GitHub/live-translation` when
> this was built. Once it's available, porting is the swap above — no changes to
> the processor or pipeline.

## Configuration (Settings ▸ voiceover connection)

| Key | Required | Default | Notes |
|---|---|---|---|
| `elevenApiKey` | yes | — | ElevenLabs API key |
| `voiceId` | yes | — | ElevenLabs voice (any cloned/preset voice) |
| `modelId` | no | `eleven_multilingual_v2` | `eleven_turbo_v2_5` for lower latency |
| `transcribeApiKey` | yes | `OPENAI_API_KEY` | OpenAI-compatible Whisper key |
| `transcribeBaseUrl` | no | OpenAI | point at Groq or self-hosted whisper.cpp |
| `transcribeModel` | no | `whisper-1` | |
| `translationBackend` | no | `aiProvider` | `aiProvider` \| `liveTranslation` |

Per-job `options.voiceover`: `sourceLang`, `targetLang` (default English),
`style`, `burnSubtitles`, `showTransliteration`, `keepOriginalAudioLevel`
(0–1, default 0.15), `existingTranscript`.

`testConnection` verifies **both** dependencies (Whisper key present +
ElevenLabs reachable and voice valid) before the service can be enabled.

## Dependencies

- System **ffmpeg/ffprobe** on PATH (already used elsewhere in the app).
- npm `openai` (present). Optional `pinyin-pro` for romanization
  (`npm i pinyin-pro`) — degrades to null if absent, non-fatal.
- ElevenLabs account + API key; an OpenAI-compatible Whisper key.

## Known limitations / next steps

- **Segment fit.** English clips are placed at each segment start; the translator
  is prompted to match spoken length, but no time-stretch is applied yet. If a
  clip overruns its window, add an `atempo` fit pass in `mixVoiceover`
  (measure with `probeDuration`, stretch to `end-start`).
- **Sequential TTS.** Segments are synthesized one at a time for clear progress
  and rate-limit safety. Batch with a small concurrency pool if throughput matters.
- **No auto-publish of unreviewed dubs.** Keep uploads private-first (house rule)
  until a human approves, especially for the scene-generated content.
