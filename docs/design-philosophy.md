# Subtitle Studio design philosophy

Subtitle Studio is an evidence-oriented media workbench, not a one-click AI
generator. Its interface and data model should make it obvious what came from
the video, what was inferred by a provider, and what a user has approved.

## 1. Time is the shared key

Audio cues, screenshots, context, translations, and preview state all use the
same media timebase. A screenshot owns a bounded window, and only cues that
overlap that window may consume its vocabulary. Context must never be attached
to a whole video merely because it appears somewhere in the video.

## 2. Evidence before rewriting

Kimi extracts visible evidence; it does not author dialogue. Local Whisper gets
a second listen with that vocabulary, and Studio accepts only small changes
that introduce matched evidence while passing conservative drift checks.
Source timing and cue identity remain canonical.

Visual context is most valuable for proper nouns, gene and protein symbols,
drug names, equations, acronyms, model numbers, captions, and slide headings.
It is not permission to turn every visible word into speech.

## 3. Local work, explicit remote boundaries

Video handling, audio extraction, and Whisper run locally. Any remote boundary
is named at the point of use. Before Kimi context runs, the interface states
that screenshots and matched transcript excerpts leave the machine.

Settings are bounded so the user can predict both disclosure and cost:

- an explicit screenshot interval;
- a hard frame-count safety limit;
- a named provider and model;
- an exact source language for the second Whisper pass.

## 4. Per-video, inspectable artifacts

Each video is a project with its own transcript, frame manifest, context
Markdown, corrections, subtitles, and revision history. `context.md` is both
human-readable and machine-parseable: frame identity and timing are explicit,
while extracted vocabulary remains easy to inspect and edit.

Upstream changes invalidate downstream artifacts. A newer transcript must not
silently reuse context built from an older draft, and a regenerated screenshot
set must not accept an in-flight response for previous pixels.

## 5. Modular progress, conservative failure

The five stages are separate, rerunnable operations:

1. Transcribe
2. Timed screenshots
3. Kimi context
4. Context Whisper
5. Translate

A stage either produces a validated artifact or reports why it did not. Missing
providers, stale revisions, excessive frame counts, unsupported languages, and
complete second-pass failure are visible states—not silent fallbacks.

Several per-video projects may coexist and process independently, with one
active job per project. Background completion must not replace the project
being watched or discard its editor draft; the operator explicitly switches or
selects **Reload latest**. Stages stay sequential inside each project.

The current queue is client-side and in memory. The interface must not imply
restart recovery or durable scheduling until those capabilities exist.

## 6. An operator console, not an AI aesthetic

The visual language follows [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md): solid dark
surfaces, near-square borders, one action accent, status colors used only for
status, and monospace for machine-owned data. The video, transcript, and
evidence should dominate; provider controls remain secondary.

Operational copy should name concrete actions—“Timed screenshots,” “Kimi
context,” and “Context Whisper”—instead of vague promises such as “Enhance with
AI.” A successful state reports counts and artifacts, not intelligence claims.

## 7. Accuracy claims stay narrow

The product can claim that screenshot evidence helps local Whisper reconsider
timestamp-matched terminology. It should not claim guaranteed correction,
recovery of inaudible words, calibrated confidence, full offline operation, or
durable background-job recovery.

The guiding sentence is:

> Use what is visible to reconsider what was heard—without changing when it was
> said.
