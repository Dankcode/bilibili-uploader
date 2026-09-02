# Documentation index

Everything in this folder is one of three things. Check the label before you
treat a document as a description of the running app.

| Status | Meaning |
|---|---|
| **Reference** | Describes behaviour that exists in the code today. Keep it in sync with changes. |
| **Partly built** | A plan whose core landed, sometimes differently from what the document proposed. Read it for intent, verify details against the code. |
| **Planned** | A proposal. No corresponding code exists. Do not treat it as documentation. |

## Reference

| Document | What it covers |
|---|---|
| [design-philosophy.md](./design-philosophy.md) | The rules Subtitle Studio is built on: one shared timebase, evidence before rewriting, explicit remote boundaries. |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Color, type, spacing, and component tokens. All values live in `src/app/globals.css`; components read tokens and never hardcode hex. |
| [VIDEO_GENERATION.md](./VIDEO_GENERATION.md) | The `voiceover` processor end to end — extract audio, transcribe, translate, Kimi re-script, TTS, duck and overlay — and how it composes with any source and uploader. |
| [YOUTUBE_AUTHORIZATION_LINKAGE.md](./YOUTUBE_AUTHORIZATION_LINKAGE.md) | How a YouTube identity is registered and resolved per job. Implemented in `src/lib/youtube/authorizations.js` and the Connections view. Also records why the adjacent `gmail-account-creator` repo was rejected. |

## Partly built

| Document | Status |
|---|---|
| [SUBTITLE_STUDIO_PLAN.md](./SUBTITLE_STUDIO_PLAN.md) | The original integration plan for Subtitle Studio. The feature shipped — `src/lib/studio/` and the Editor view — so the README is the accurate description; this is kept for the design reasoning behind it. |
| [UPGRADE_PLAN.md](./UPGRADE_PLAN.md) | Local STT and real translation backends landed (`src/lib/stt/`, `src/lib/translation/backends/`, usage metering), but via Transformers.js rather than the whisper.cpp port this plan proposed. Treat the phase lists as historical. |

## Planned

| Document | Status |
|---|---|
| [AUTOMATION_CONTEXT_AND_PROCESS_VIEW_PLAN.md](./AUTOMATION_CONTEXT_AND_PROCESS_VIEW_PLAN.md) | Plan only. Would add `videoContext` and `ocrContext` processors to the automation chain and a per-video process page at `src/app/videos/[id]/page.js`. Neither exists yet. |
| [MAIL_INTEGRATION_PLAN.md](./MAIL_INTEGRATION_PLAN.md) | Proposal only. Would connect a Gmail account you already own as a tracking and notification service. No mail code exists in the repo. It explicitly rules out any form of automated account creation. |
| [PUBLISH_TARGET_PLAN.md](./PUBLISH_TARGET_PLAN.md) | Plan only. Would add a resolve-before-queue step and a channel picker, so a job selects which authorized YouTube channel it publishes to. The backend field exists and is enforced; no UI sets it yet. |

## Images

`design/` holds the current console screenshots used by the root README;
`images/` holds the Subtitle Studio screenshots. Update them when a view
changes shape rather than leaving a stale screenshot in the README.
