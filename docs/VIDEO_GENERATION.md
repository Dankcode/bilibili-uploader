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
2. **Transcribe** — `lib/stt/index.js` selects either OpenAI-compatible Whisper
   (`openaiWhisper`) or local Transformers.js Whisper (`localWhisper`, quality
   tiers `fast`/`balanced`/`best`). Both return timestamped segments. Existing
   scene transcripts and `{srtPath}` sidecars bypass STT.
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
6. **Assemble** — every generated clip is pitch-preservingly fitted to its cue
   window with chained `atempo`, then `mixVoiceover` ducks the original audio
   and overlays the fitted speech. English and dual-language SRT files are
   emitted; English subtitles can also be burned into the video.
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

## Translation backends

`translationBackend` supports four implementations:

- `aiProvider` - the existing Kimi/OpenAI JSON translation layer.
- `googleFree` - server-side Google Translate GET requests with retry and loud failure.
- `gemini` - batch translation with optional one-pass refinement.
- `liveTranslation` - the existing external adapter seam.

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

## Configuration (Settings ▸ voiceover connection)

| Key | Required | Default | Notes |
|---|---|---|---|
| `elevenApiKey` | yes | — | ElevenLabs API key |
| `voiceId` | yes | — | ElevenLabs voice (any cloned/preset voice) |
| `modelId` | no | `eleven_multilingual_v2` | `eleven_turbo_v2_5` for lower latency |
| `sttBackend` | no | `openaiWhisper` | `openaiWhisper` or `localWhisper` |
| `sttQuality` | no | `fast` | local tier: `fast`, `balanced`, or `best` |
| `transcribeApiKey` | API only | `OPENAI_API_KEY` | OpenAI-compatible Whisper key |
| `transcribeBaseUrl` | no | OpenAI | point at Groq or self-hosted whisper.cpp |
| `transcribeModel` | no | `whisper-1` | |
| `translationBackend` | no | `aiProvider` | `aiProvider` \| `googleFree` \| `gemini` \| `liveTranslation` |
| `maxDailySeconds` | no | `21600` | per-service quota cap tracked in SQLite |

Per-job `options.voiceover`: `sourceLang`, `targetLang` (default English),
`style`, `burnSubtitles`, `showTransliteration`, `keepOriginalAudioLevel`
(0–1, default 0.15), `existingTranscript`.

`testConnection` verifies the selected STT, translation, and TTS dependencies
before the service can be enabled.

## Dependencies

- System **ffmpeg/ffprobe** on PATH (already used elsewhere in the app).
- npm `openai`, maintained `@huggingface/transformers`, and bundled ffmpeg/ffprobe binaries.
  Optional `pinyin-pro` for romanization
  (`npm i pinyin-pro`) — degrades to null if absent, non-fatal.
- ElevenLabs account + API key; an OpenAI-compatible Whisper key.

## Known limitations / next steps

- **Sequential TTS.** Segments are synthesized one at a time for clear progress
  and rate-limit safety. Batch with a small concurrency pool if throughput matters.
- **No auto-publish of unreviewed dubs.** Keep uploads private-first (house rule)
  until a human approves, especially for the scene-generated content.
