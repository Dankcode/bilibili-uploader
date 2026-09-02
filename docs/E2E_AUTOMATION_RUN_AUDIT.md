# E2E automation run — audit and fixes

**Audit run:** 2026-08-24
**Fixes applied:** 2026-08-24, same session
**Scope:** Local dry run. No remote provider calls, no YouTube publish, no video
uploaded anywhere. Source was `video-work/inbox/*-uploader-e2e-input.mp4`
(2.0 s, 320×180, 29,681 bytes).

**Status: 8 of 8 findings fixed, 53/53 tests passing, production build clean.**
One new finding (F9) is reported but deliberately not fixed — it needs a UI
decision. The changes are written into the working tree and **not committed**;
`git diff` shows them alongside your own uncommitted work.

## How this was run

The app cannot be started from the desktop bridge: that shell is a Linux VM,
while `node_modules` holds macOS-built native binaries (`better_sqlite3.node`
fails with `invalid ELF header`). Rebuilding in place would have broken the Mac
install, so the repo was mirrored into an isolated sandbox — same source, same
`config/bilibili.db`, same `.env`, fresh `npm install` — and both the audit and
the verification runs happened there. Findings and fixes are source-level and
reproduce on any host.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | P0 | `videoContext` crashes on every run, blocking 5 of 7 presets | **Fixed** |
| F2 | P0 | A Bilibili job sends `SESSDATA` to any host the URL names | **Fixed** |
| F3 | P1 | Run preflight reports "ready" for an upload that cannot happen | **Fixed** |
| F4 | P1 | The pipeline logs nothing about jobs | **Fixed** |
| F5 | P2 | Diagnostics discards the identity of a check that throws | **Fixed** |
| F6 | P2 | Job creation accepts a source path that does not exist | **Fixed** |
| F7 | P3 | `cancel` reports "canceling" for jobs that are already finished | **Fixed** |
| F8 | P3 | Importing a library module opens the operator's live database | **Fixed** |
| F9 | P2 | No UI can select a YouTube authorization | **Open — needs your decision** |

---

### F1 — P0 · `videoContext` crashed on every run · blocked 5 of 7 presets

`videoContext.js` exports a function named `process`. In an ES module that
declaration is hoisted into module scope and **shadows Node's global `process`**,
so `process.env` was `undefined` throughout the file and line 22 threw before any
work began:

```
TypeError: Cannot read properties of undefined (reading 'OPENAI_API_KEY')
    at resolveCredentials (src/lib/pipeline/processors/videoContext.js:22:67)
```

Observed live: the step failed 1 ms after starting, at 0 % progress, leaving
`metadata` and `youtube` `pending`. Affected presets: **Studio Full Auto, Dub
only, Edit and publish, Subtitle max accuracy, Hardcoded subtitles extract** —
everything except *Upload only* and *Face swap proof*.

**Fix.** Capture the environment through `globalThis.process` before the shadow
applies, the same pattern `voiceover.js` already used:

```js
function resolveCredentials(credentials = {}, options = {}) {
  const env = globalThis.process?.env || {};        // added
  ...
  transcribeApiKey: credentials.transcribeApiKey || env.OPENAI_API_KEY || '',
```

**Verified.** `GET /api/pipeline/diagnostics` now reports `videoContext: ok`. In
a real job the step advanced from an instant crash to 27 % progress — past
credential resolution and audio extraction, into Whisper model loading — where
the sandbox's egress rules blocked the model download from ModelScope and Hugging
Face. That last leg is untested here; it should work on your Mac, where the model
either caches under `~/.bilibili-uploader/models` or downloads normally.

`test/pipeline-adapters.test.mjs` guards the whole class of bug: it fails if any
adapter that exports `process` reads a bare `process.env`. Confirmed to fail
against the old code and pass against the new.

### F2 — P0 · A Bilibili job sent `SESSDATA` to any host the URL named

`sources/bilibili.js` passed any `http(s)://` input through unvalidated, and
`video/bilibili.js` attached the session cookie with no host check. Demonstrated
with a local listener and a clearly-fake token — the non-Bilibili host received
`cookie: SESSDATA=…` verbatim. `resolveInput` also accepted `../../etc/passwd`,
producing `https://www.bilibili.com/video/../../etc/passwd`.

This compounded with two documented properties of the console: it binds `0.0.0.0`
and has **no authentication**. Anyone who could reach port 4455 could
`POST /api/pipeline/jobs` with a URL they controlled and receive your live
Bilibili session cookie.

**Fix.** A new module, `src/lib/video/bilibiliUrl.js`, is now the single gate:

- `isAllowedBilibiliHost()` — suffix-matches `bilibili.com` / `b23.tv` on the
  registrable domain, so `www.`, `m.`, `space.`, `api.` pass and
  `bilibili.com.evil.test` does not.
- `normalizeBilibiliVideoInput()` — accepts a canonical Bilibili URL, a `BV`
  identifier, or an `av`/numeric id, and rejects everything else *before* it can
  be interpolated into a path.
- `assertBilibiliUrl()` — called inside `parseBilibiliVideoInfo()`, before the
  cookie header is built, so a caller cannot skip it.
- `guardRedirect()` — wired to axios `beforeRedirect`, so a Bilibili URL that
  redirects off-site cannot carry the cookie with it.

Space pages are still supported, and links scraped off one are re-validated
individually — a scraped page is untrusted input. `pipeline.js` also rejects a
non-Bilibili source at queue time, so the job never reaches the worker.

**Verified.** `test/bilibili-url-guard.test.mjs` reproduces the original attack
against a live local listener and asserts the foreign host receives **no request
at all**. Live: `POST /api/pipeline/jobs` with `https://evil.example.com/x` now
returns
`Bilibili source refused: evil.example.com is not a Bilibili host.`
The download path itself never carried the cookie (it sends only User-Agent and
referer), so no other call site needed changing.

### F3 — P1 · Run preflight reported "ready" for an upload that could not happen

Preflight for `localFile → sceneCut → youtube` returned `ready: true` with the
uploader row `ok / Ready` — with **zero rows in `youtube_authorizations`**. The
job was then accepted, the source and processor burned real ffmpeg work, and only
the final step failed. `youtube.testConnection()` checked that the Python script
existed and nothing else.

**Fix.** `testConnection(credentials, context)` now verifies the credential:

- with a chosen authorization, that it is enabled, usable, and that its
  `<credential-ref>_client_secret.json` actually exists;
- without one, that at least one usable authorization exists, or that
  `YOUTUBE_CHANNEL_ID` is set;
- the guided desktop uploader (`YOUTUBE_UPLOAD_METHOD=pygui`) still passes on
  script presence alone, because it authenticates by hand.

`runPreflight()` passes the job's authorization and source input into each
adapter check, and `createJob()` refuses a YouTube job that has no way to
authenticate, so the failure now arrives before any work.

**Verified live.**

```
before: ready: true    youtube  ok    Ready
after:  ready: false   youtube  fail  No authorized YouTube account. Register one in
                                      Connections ▸ Sign in for automated delivery…
```

and job creation returns that same message instead of queueing.

### F4 — P1 · The pipeline logged nothing about jobs

`pipeline.js` contained one `console` call. Across four job runs, two of them
failures, the server produced **not one line** about a job starting, a step
running, or a step failing — only Next.js's HTTP access log. `metrics_json` was
allocated on every step row and always left empty.

**Fix.** Job claim, step start, step completion with duration, review pauses,
cancellation, and failures now log with the job id; step duration and adapter id
are recorded into `metrics_json`. Failures log the stack. Nothing logs
credentials, tokens, cookies, or provider keys.

**Verified live** — a complete run now reads:

```
[Pipeline] job=7 claimed by worker-9056-3b14e3c5: source=localFile processors=["sceneCut"] uploader=none
[Pipeline] job=7 step=source:localFile attempt=1 started
[Pipeline] job=7 step=source:localFile ok in 27 ms
[Pipeline] job=7 step=processor:sceneCut attempt=1 started
[Pipeline] job=7 step=processor:sceneCut ok in 163 ms
[Pipeline] job=7 done in 192 ms
```

with `metrics_json` = `{"durationMs":163,"role":"processor","adapterId":"sceneCut"}`.

### F5 — P2 · Diagnostics discarded the identity of a check that threw

Every thrown check collapsed into one anonymous row, `unknown / Unexpected check
failure` — F1 was only located by counting positions in the response array. Its
fix hint pointed at a stack trace that was never written, because `settle()` did
not log.

**Fix.** `settle(id, label, check)` keeps the check's own id and label on the
failure row and `console.error`s the real stack. The check list is now
`[id, label, check]` triples, so the two cannot drift apart.

### F6 — P2 · Job creation accepted a source path that did not exist

A job created with a non-existent path returned `{"status":"queued"}` and failed
only when the worker reached it. For a batch of fifty pasted paths, that is fifty
avoidable failures arriving one at a time.

**Fix.** `createJob()` validates local paths at queue time — absolute, exists, is
a file, readable, non-empty — and `localFile.testConnection()` now checks the
path the run will actually use when the planner supplies it. `GenerateStudio`
sends `sourceInput` with its preflight request and re-checks when the input
changes.

**Verified live** — `POST` with a missing path now returns
`Local source file not found: …` instead of queueing.

### F7 — P3 · `cancel` reported "canceling" for jobs that were already finished

`cancelJob()` returned `canceling` for any status other than `queued`/`review`,
including already-`canceled` and already-`failed` jobs. Nothing was cancelling and
nothing ever would; a UI rendering a spinner on that response would spin forever.

**Fix.** `canceling` is returned only for a genuinely running job. A terminal job
returns its real status plus `alreadyFinished: true`.

**Verified live** — cancelling a finished job now returns
`{"status":"failed","alreadyFinished":true}`.

### F8 — P3 · Importing a library module opened the operator's live database

`db/sqlite.js` calls `initDB()` as an import side effect, so anything that
transitively imports it opens `config/bilibili.db` and runs migrations.
`npm test` did exactly that: `youtube-oauth.test.mjs` imported
`src/lib/youtube/oauth.js` for a path-validation helper and the run printed
`SQLite Database connected at: <repo>/config/bilibili.db`.

**Fix.** A new `test/setup.mjs`, loaded via `--import` before any test file,
pins `VIDEO_SQLITE_PATH` to a throwaway temp database unless a test sets its own,
and registers the extension loader so adapter imports resolve. `npm test` is now
`node --import ./test/setup.mjs --test test/*.test.mjs`.

**Verified** — a full run opens only `<temp>/test.db`; `config/bilibili.db` is
untouched (md5 unchanged before and after).

The deeper fix — making `initDB()` explicit rather than an import side effect —
is a wider refactor across every consumer and was left alone deliberately.

---

### F9 — P2 · No UI can select a YouTube authorization · **open**

Found while fixing F3. `youtubeAuthorizationId` is read by `pipeline.js` and
`diagnostics.js`, and `youtube-authorizations.test.mjs` proves the binding is
immutable and audited — but **no component ever sets it**. The whole
authorization-selection feature is unreachable from the console; the field only
exists on the API.

That left a choice. A strict gate would have made every YouTube job from the UI
fail at creation with "select an authorization" and no way to select one.
So `resolveYouTubeAuthorizationId()` currently:

- uses the authorization the request names, if any;
- **binds automatically when exactly one account is authorized** — the common
  case, and unambiguous;
- refuses with the list of names when several are authorized;
- refuses with a registration hint when none are.

Auto-binding a single account is a judgement call I made in your absence.
It is safe today (you have zero authorizations, and uploads default to private),
but if you would rather every job name its channel explicitly, the fix is a
channel picker in **Automation → Source tools** and the batch planner, sending
`youtubeAuthorizationId`; then that middle branch can be deleted. I did not build
that picker because it is a design decision, not a defect.

---

## What changed

| File | Lines | Why |
|---|---|---|
| `src/lib/video/bilibiliUrl.js` | new | F2 — host allowlist, input normalization, redirect guard |
| `src/lib/pipeline/pipeline.js` | 151 | F4 logging, F6 path validation, F2 queue-time check, F7 cancel, F3 authorization resolution |
| `src/lib/pipeline/diagnostics.js` | 73 | F5 attribution, F3 preflight context |
| `src/lib/pipeline/uploaders/youtube.js` | 63 | F3 — real credential verification |
| `src/lib/pipeline/sources/bilibili.js` | 43 | F2 — validate input and scraped links |
| `src/lib/pipeline/sources/localFile.js` | 15 | F6 — check the path the job will use |
| `src/lib/video/bilibili.js` | 7 | F2 — host assert + redirect guard on the cookie-bearing request |
| `src/lib/pipeline/processors/videoContext.js` | 5 | F1 — the shadowed-global fix |
| `src/components/GenerateStudio.js` | 5 | F6 — send the real input to preflight |
| `package.json` | 1 | F8 — test bootstrap |

New tests: `test/setup.mjs`, `test/pipeline-adapters.test.mjs`,
`test/bilibili-url-guard.test.mjs`, `test/pipeline-guards.test.mjs`.
`test/youtube-authorizations.test.mjs` was updated because its fixture used a
fictional path that F6 now correctly rejects — it writes a real temp file instead.

**53/53 tests pass. `npm run build` completes.** Nothing is committed.

## Still not exercised

Honest gaps, so none of this is mistaken for a clean bill of health:

- Any remote provider call — Gemini/Kimi metadata, Whisper API, TTS, vision.
- The real YouTube upload, OAuth consent, and channel verification. The credential
  checks are verified against a registered authorization and a fixture
  client-secret file, not against Google.
- The Bilibili and Douyin **download** paths. F2's guards are proven; the
  post-guard download was never run against the real site.
- Whisper transcription end to end — blocked by sandbox egress, see F1.
- FaceFusion, Subtitle Studio's five stages, and the batch planner under load.
- **Upload idempotency** — the previously filed P1 (a retry after YouTube accepted
  but the process died can create a duplicate private video) still cannot be
  reproduced without a live upload. **It remains open and untested.**

## Suggested next steps

1. Run `npm test` and `npm run dev` on your Mac to confirm the fixes hold against
   your real `node_modules` and cached Whisper models.
2. Register one YouTube authorization, then re-run the preflight — it should go
   green and bind that account.
3. Decide F9: keep auto-binding, or add the channel picker.
4. The console still has no authentication and still binds `0.0.0.0`. F2 closed
   the credential leak, but an unauthenticated LAN caller can still queue and
   cancel jobs.
