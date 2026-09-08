# Audit: concepts worth taking from social-dashboard

**Date:** 2026-09-04 · **Status:** audit + plan only, no code changed
**Reference:** `AurelioAvila/social-dashboard` — read in full (14.1k LOC), then deleted
**Subject:** `bilibili-uploader` — 23k LOC in `src/`, 24 components, 44 API routes

This pass is about **ideas and process**, not plumbing. Where a structural
problem is unavoidable it gets one line in the appendix and nothing more.

---

## The one-sentence version

social-dashboard is a smaller, simpler app than yours and it will stay that way,
because it is built around one discipline you don't have: **every fact has
exactly one place it is written down, and every failure carries its own next
step.** Your app has more capability and more surfaces, and the surfaces have
started to disagree with each other. That, not the feature count, is what makes
it feel heavy to use.

Its frontend is worth studying but not copying — `static/app.js` is a single
4,480-line file. What's worth copying is its **access model**: a flat section
list, connection reachable from anywhere as a modal, status visible in the
navigation before you click, and every problem rendered as a button that takes
you to its fix.

---

# Part 1 — Seven concepts, and where each one lands in your app

## 1. One funnel records "how did it go." Everything else reads it.

**In social-dashboard.** Every platform adapter, on every fetch, calls one
function: `connections.record_fetch_outcome(connection_id, error_or_None)`. That
writes `auth_state` and `auth_checked_at` on the connection row. The sidebar
dots, the diagnostics badge, the connect screen and the overview all read that
one row. The commit that introduced it explains why: diagnostics was saying
"authorization expired" while the connect screen still showed the same account
as active. Two screens, two probes, two answers.

**In bilibili-uploader.** You have three independent sources of truth for "is
this service healthy":

| Screen | Where it gets its answer |
|---|---|
| Overview → *Automation health* rail | `/operations/overview` → `payload.health` |
| Diagnostics → *Troubleshooter* | a live probe of every adapter, run on mount |
| Connections → service cards | `service_connections` rows + `youtube_authorizations.status` |

Only YouTube writes `last_error`. Pipeline step failures land in
`video_job_steps` and are read by nobody outside the process drawer. So a
Bilibili cookie that expired during a run shows as *ok* in the health rail (it
was fine when last probed), *fail* in the Troubleshooter (probed just now), and
*connected* on the Connections card (it has stored credentials). All three are
"right." None is useful.

**What to build.** In `src/lib/pipeline/connections.js`:

```
recordOutcome(serviceId, { connectionId, error })   // the only writer
isAuthFailure(error)                                // shared predicate
```

Every adapter calls it — at the end of `run()`, and at the end of `test()`. Add
`auth_state` + `checked_at` to `service_connections`. Then the health rail, the
Troubleshooter and the Connections cards all render from the same rows, and the
Troubleshooter's live probe becomes a *refresh* button rather than a fourth
opinion. **Deletes code.** The health-rail computation in
`operations/store.js` and half of `pipeline/diagnostics.js` collapse into reads.

---

## 2. A failure is a category, a sentence, and a button — never a raw string.

**In social-dashboard.** `diagnostics.py` carries a table of error patterns:
`invalid_grant` / `invalid_scope` / `quota` / `429` / `401` / `404` / `timeout`
→ each maps to a category, a concrete next step, and where relevant an
`action: {type: "goto", section: "connections"}` that the frontend renders as a
button. The user never reads a stack trace and never has to work out which
screen fixes it.

**In bilibili-uploader.** `diagnostics.js` has `STEP_FIX` — a static hint per
service, shown whatever actually went wrong:

> `bilibili: 'Add your SESSDATA cookie in Settings ▸ bilibili for HD downloads.'`

That is the right sentence for an expired cookie and the wrong one for a
network timeout, a 403 region block, or a missing ffmpeg. And it's prose telling
the user to navigate somewhere, in an app that already has `navigate(view)` in
`page.js` and could just take them there.

Meanwhile runtime failures — the ones that actually cost you a video — surface
as `check.detail` truncated to 240 characters, or as whatever the processor
threw, in the process drawer.

**What to build.** `classifyError(error, { serviceId, stepId })` returning
`{ severity, category, detail, nextStep, action }`. Pattern table covering what
your pipeline actually produces, not what a social API produces:

| Pattern | Category | Next step | Action |
|---|---|---|---|
| `invalid_grant`, `Token has been expired` | Authorization expired | Re-authorize this YouTube channel | → Connections, scoped to that account |
| `-352`, `412`, risk-control HTML in a Bilibili response | Source blocked | SESSDATA expired or rate-limited — sign in again | → Connections ▸ bilibili |
| `ENOENT` on ffmpeg / ffprobe | Tool missing | Reinstall media tools | → Health |
| `ENOSPC`, `No space left` | Disk full | Free space in `video-work` | → the retention panel |
| `429`, `quota`, `RESOURCE_EXHAUSTED` | Provider limit | Wait, or switch provider | → Connections ▸ that provider |
| whisper/model load failure | Local model unavailable | Re-run the local Whisper install | → Health |
| context revision mismatch | Stale artifact | Re-run *Timed screenshots* before *Kimi context* | → the project's stage list |

Run **both** the preflight checks and the failed `video_job_steps` rows through
it. Then the Troubleshooter stops being a connectivity list and becomes what its
name promises. Note the last row: your `design-philosophy.md` §5 already
commits to "a stage either produces a validated artifact or reports why it did
not" — this is the missing half of that promise.

---

## 3. Compute what can be computed. Spend AI only on what only AI can do.

**In social-dashboard.** `insights.py` opens by describing what it replaced:
every click on "Analyze" used to call a paid model — variable cost, an external
dependency, and, when credit ran out, the provider's raw billing error shown to
a paying customer. The same questions ("what performed best, what's below
average, how often am I posting, how much engagement per view") are arithmetic
over data already on disk. The rewrite is instant, free, offline, and identical
on every run.

Just as important is the part most people skip — the **noise caps**:

```
MIN_ITEMS_FOR_COMPARISON = 4   # below this, "best" and "average" are the same post
FLOP_RATIO = 0.4               # under 40% of average
STAR_RATIO = 1.5               # over 150% of average
MAX_PER_ENTITY = 2 ; MAX_TOTAL = 6 ; priority: warn > good > info
```

Its comment: *"With six linked accounts, one observation per metric per account
produces twenty lines. Nobody reads them, and the point of a summary panel is to
avoid reading them all."*

**In bilibili-uploader.** Your `VideoAnalytics` view reads
`video_metric_snapshots` and `video_publications` — real data, no insight layer
over it. Separately you already have an `api_usage` table and
`src/lib/pipeline/usage.js` tracking provider spend, surfaced nowhere prominent.

**What to build.** Two things, both cheap:

- `src/lib/analytics/insights.js` — deterministic, no provider calls: best
  publishing window, over- and under-performers against your own baseline,
  cadence, engagement-per-view. Apply the caps verbatim; they are the difference
  between a panel people read and one they scroll past.
- Put **cumulative provider spend** on the Overview KPI row. You are running
  Kimi vision, Gemini, OpenAI, ElevenLabs and Whisper per video; the one number
  that changes behavior is what the last 30 days cost. The data is already in
  `api_usage`.

Keep AI where it earns its keep: metadata generation, translation, vision
context extraction. Nothing there is arithmetic.

---

## 4. Progress measured in real units of work.

**In social-dashboard.** Each adapter exposes `count_units()` — the number of
channels it is about to read. `/api/refresh` sums them before starting, the
worker increments a shared counter per channel, and `/api/refresh/status` serves
the real fraction. The bar moves five times for five channels instead of
lurching from 0 to 100. The docstring names the failure it avoids: *"a single
bar lurching across 5 entries."*

**In bilibili-uploader.** `page.js` polls `/operations/overview` every 8 seconds
and shows *counts*. Per-video, `ProgressTree.js` renders steps. But a run that is
transcribing a 40-minute video sits on "running" for twenty minutes with no
indication whether it is 5% or 95% through — which is exactly when an operator
starts wondering whether to kill it.

**What to build.** Give each processor an optional `estimateUnits(job)` and have
the worker report `unitsDone / unitsTotal` per step into `video_job_steps`
(`metrics_json` already exists for this). Whisper knows its segment count,
`sceneCut` knows its clip count, `frames` knows its frame count, the uploader
knows its byte count. `ProgressTree` renders a real fraction. This is a small
change that removes the most common reason to open a terminal.

---

## 5. The guided fallback — and validating credentials at the moment they're pasted.

This is the concept with the highest payoff for your app, and it's the least
obvious one.

**In social-dashboard.** Instagram and TikTok won't let an unreviewed app
connect *other people's* accounts, but both allow connecting *the account of
whoever registered the app* — Instagram in Development mode, TikTok via Sandbox.
So rather than showing "coming soon" and stopping, pressing Connect opens a modal
offering **"Connect it now"**: a step-by-step guided flow to register your own
app, about ten minutes, once. `own_app.py` says it plainly — *"This is not a
workaround: it is the use both platforms intend."*

And then the detail that matters more than the flow:

```python
FORMATS = {
  "tiktok": { "client_id": (r"^(sb)?aw[A-Za-z0-9]{8,30}$", "ownapp_bad_tt_key"), ... }
}
```

*"Almost every real error is a bad copy and paste — fields swapped, half of it
pasted, invisible whitespace picked up with the value. Catching it here produces
a precise message immediately, instead of a sign-in that fails three screens
later without explaining why."* The patterns are deliberately loose: they reject
the obvious mistake, they don't try to predict the platform's next format.

**In bilibili-uploader.** Your entire connection surface is hand-pasted
credentials with **zero validation at the point of entry**: Bilibili SESSDATA
cookies, the Douyin sidecar URL and cookie, YouTube OAuth client JSON, five
provider API keys, a FaceFusion directory path, a face source image path. Every
one of them fails later — during a run, in a step log — rather than on paste.
`ServiceConnections.js` is 772 lines of forms that accept anything.

Your registry already has the hook: `credentialFields` with `{ key, type }`.

**What to build.**

1. Add `pattern`, `example`, `hint` to `credentialFields` and validate on blur.
   A SESSDATA that still has `SESSDATA=` glued to the front, a Kimi key that's
   actually an OpenAI key, a path with a trailing newline — all catchable in the
   field.
2. Make **Test** the primary button on every service card, not a diagnostics
   feature. Paste → validate shape → test live → green. Three seconds, at the
   moment the user is thinking about that service.
3. Where a credential requires a multi-step setup elsewhere (YouTube OAuth
   client, FaceFusion install, the Douyin sidecar), put the steps **inline in the
   card as a numbered guided panel** — the reference's `guided-step` pattern —
   instead of the prose fix-hints currently in `STEP_FIX` that tell the user to
   go read a shell script.

---

## 6. Tests that check what a human cannot see.

**In social-dashboard.** Alongside ordinary behavioral tests sit a handful of
*invariant guards*. `test_theme_tokens.py` is the model: it fails the build if
any colour is written outside the `:root` token blocks, and it computes actual
WCAG contrast for the notification badge in every theme — it caught white text
at 2.55:1, *"readable for someone with good eyesight on a good monitor, and not
for everybody else."* Crucially it reads the token names **out of the CSS rule
itself** rather than hardcoding them, so rewriting the rule can't make the test
quietly measure the old pair and keep passing.

**In bilibili-uploader.** `page.module.css` has 14 hardcoded hex values sitting
outside your `globals.css` token block (`#0f1214` ×7, `#10130e` ×2, `#090b0c`
×2, and four more). Small today. It is exactly the crack that test exists to
close, and it's what will make a light theme or a contrast pass impossible later.

**What to build.** `test/design-tokens.test.mjs`: no hex outside `globals.css`;
AA contrast for each status-text-on-status-background pair the CSS actually
declares; every `--token` referenced in a module is defined. Runs in a second,
and turns a style system from a convention into a rule. Do this *before* the CSS
split in Part 3, so the test guards the refactor rather than following it.

---

## 7. Say what it did. Don't claim intelligence.

social-dashboard's diagnostics never say "AI detected an issue" — they say
"`{name}`: nothing for 8 days," then the reason, then the step. Your
`design-philosophy.md` §6 already commits to the same thing: *"Operational copy
should name concrete actions — 'Timed screenshots,' 'Kimi context' — instead of
vague promises such as 'Enhance with AI.' A successful state reports counts and
artifacts, not intelligence claims."*

You wrote the rule. The Overview doesn't follow it yet: *"Automation health,"
"Live checks," "Priority order," "Pipeline throughput"* are labels about the
system rather than about the work. The reference's equivalents name the user's
concern: *"what's growing," "what needs attention," "when your content performs
best."* Cheap to fix, and it's the difference between a console that reports on
itself and one that answers a question.

---

# Part 2 — Frontend: making the functions reachable

## What the reference does that works

Not the visual style — the **access model**. Five properties, all portable to React:

1. **Flat sections, no sub-tabs.** Every destination is one click from the
   sidebar and one scroll long. There is no "Automation ▸ Sources ▸ Generate."
2. **Connection is a modal, not a place.** The same connect panel opens from
   any section, from any empty state, and from any diagnostic. Its comment:
   *"keeping connection one click away without requiring users to find a
   dedicated page."*
3. **Status lives in the navigation.** A dot per platform and a count badge on
   Diagnostics, computed by one shared function (`platformStatusMap`) so the
   sidebar and the overview cannot disagree. Four states, not two — *"not
   connected yet" (grey) is different from "connected with a problem"* — which
   is the distinction that tells a new user what to do next.
4. **One global action with honest progress** (Refresh + the real fraction from
   Concept 4), plus `Ctrl+K`.
5. **Every problem is a button.** A diagnostic renders its `action` as a control
   that navigates to the fix.

## What yours does today

Nine top-level views, several with a second tier:

```
Overview   Library   Automation ┬ Sources ┬ Generate      Editor ┬ Subtitles
                                │         └ Douyin               └ Scenes
                                ├ Runs
                                └ Proof
Analytics  Mail   Connections   Runtime   Diagnostics
```

That's ~16 real destinations. Three consequences:

**Starting a video has four front doors.** Topbar *Import videos* →
Automation. Automation ▸ Sources ▸ Generate. Automation ▸ Sources ▸ Douyin.
Editor ▸ import a file. They queue jobs through different paths and none of them
is obviously *the* way to begin.

**"Why did my video fail" has five answers.** The Overview health rail, the
Troubleshooter, Automation ▸ Runs, the Library row, and the process drawer. This
is Concept 1's problem showing up as a navigation problem.

**The navigation carries almost no signal.** One count badge on Library
(`counts.needsReview`). Nothing tells you a credential expired until you go
looking. The sidebar footer says `3/4 checks ready` — which checks, and where?

Also: **Editor is a nav destination but Subtitle Studio is per-video.** You open
Editor, then import a file *again* to get a project. The studio should open
*from* a video, in the flow where you already have one.

## Proposed structure — four destinations and a modal

| Now | Becomes |
|---|---|
| Overview, Library, Automation ▸ Runs | **Work** — one table: everything in the catalog, filter chips for `queued / running / needs review / published`. The KPI row and throughput chart stay on top. One row component, one place to look. |
| Automation ▸ Sources (both tabs), Editor ▸ import, topbar Import | **Create** — one flow: *source* (Bilibili URL / Douyin / local file / generate) → *steps* (the existing numbered checklist, already good) → *destination*. One front door. |
| Editor ▸ Subtitles, Editor ▸ Scenes, the process drawer | **Studio** — opened from a video row, not from the sidebar. It is per-project by nature (`design-philosophy.md` §4) and the nav should say so. |
| Diagnostics, Runtime, the health rail | **Health** — checks, runtime, provider spend, retention. One page for "is the machine okay." |
| Connections, Automation ▸ Proof | **A modal**, opened from any failure, any empty state, and a sidebar item. FaceSwap Proof isn't a destination — it's the faceFusion step's *Test*, per Concept 5. |
| Analytics, Mail | Stay as they are. Analytics gains the insights panel from Concept 3. |

Plus, from the reference: status dots per service in the sidebar computed by one
shared function; a badge on Health; `Ctrl+K` over videos and actions.

**Nine destinations with sixteen surfaces becomes six with six.** No capability
is removed — `SubtitleStudio`, `AutomationHub`'s checklist, `ProcessDetail` all
survive intact. What changes is that each one has a single door.

---

# Part 3 — Simplification, concretely

Ordered by payoff-to-risk. The first three are the ones that matter.

1. **Collapse the three health sources into one** (Concept 1). Removes a
   duplicate probe path and makes the merge in Part 2 possible. Everything else
   in the frontend plan depends on it.
2. **One entry point for creating work.** Merge `GenerateStudio`,
   `DouyinImporter` and `EditorWorkspace`'s import into `Create`. Three
   components' worth of near-duplicate source-selection and queue-POST logic
   collapse into one.
3. **One video-row component.** `OperationsOverview`'s table, `VideoLibrary`'s
   list and `AutomationHub`'s run list render the same entity three ways with
   three sets of status-tone logic. One `<VideoRow>` and one `statusTone`.
4. **Stop the app calling itself over HTTP.** Every screen fetches
   `/api/control/...`, which re-issues an HTTP request back into the same
   process to reach the handler next to it. The Overview polls through this
   every 8 seconds. In local mode it should call the function directly; the
   proxy path is only meaningful when the backend is genuinely remote.
5. **Split the two files carrying a quarter of the frontend.**
   `SubtitleStudio.js` (1,196 lines) along the seams its own design doc already
   names — transcript, frames, context, corrections, translate — and
   `ServiceConnections.js` (772) into one card per service, driven by the
   registry you already have. Do this after the token test exists.
6. **Split `page.module.css`** (3,796 lines / 762 rules, the single stylesheet
   for all 24 components) into co-located `*.module.css`, leaving only shell and
   layout in the page module. Mechanical, and it's what makes deleting a
   component actually delete its styles.

---

# Part 4 — Sequence

Each step is independently shippable. Effort is rough working time.

**Step 1 — One source of truth for health.** (1 day)
`recordOutcome()` + `isAuthFailure()`; `auth_state` + `checked_at` on
`service_connections`; every adapter reports; health rail, Troubleshooter and
Connections all read it. *Verify:* force a Bilibili auth failure mid-run and
confirm all three surfaces say the same thing within one refresh.

**Step 2 — Errors become next steps.** (1 day)
`classifyError()` with the pattern table from Concept 2, applied to preflight
checks *and* failed `video_job_steps`. Issues gain `{severity, category,
nextStep, action}`; the Troubleshooter renders `action` as a button through the
existing `navigate()`. *Verify:* fixture test, one case per pattern.

**Step 3 — Credential validation at the point of entry.** (1 day)
`pattern` / `example` / `hint` on `credentialFields`; validate on blur; **Test**
promoted to the primary action on every service card; inline numbered guided
panels replacing the `STEP_FIX` prose for YouTube OAuth, FaceFusion and the
Douyin sidecar. *Verify:* paste a malformed SESSDATA and a swapped key pair;
both rejected in the field with a specific message.

**Step 4 — Token test, then the CSS split.** (1.5 days)
`test/design-tokens.test.mjs` first; hoist the 14 hex values; then split
`page.module.css` into co-located modules. *Verify:* test green, and a visual
pass over each view.

**Step 5 — Navigation merge.** (2 days)
Nine views → Work / Create / Studio / Health / Analytics / Mail, plus the
Connections modal and sidebar status dots. Depends on Steps 1 and 2 —
merging the screens before they agree just moves the contradiction. *Verify:*
walk the full path Bilibili URL → queued → running → failed → fixed → published
and count the clicks against today's.

**Step 6 — Honest progress.** (1 day)
`estimateUnits()` per processor; worker writes `unitsDone/unitsTotal` into
`video_job_steps.metrics_json`; `ProgressTree` renders the fraction.

**Step 7 — Local insights + visible cost.** (1 day)
`src/lib/analytics/insights.js` with the noise caps; 30-day provider spend from
`api_usage` on the Work KPI row. *Verify:* golden-file test on a fixture set.

Steps 1–3 are the substance — they're where the app stops contradicting itself.
Steps 4–5 are what make it feel simple. Steps 6–7 are polish that users notice.

---

# Appendix — structural findings carried forward

Not the focus of this pass; recorded so they aren't lost. Each is one line.

- **Access control.** The app binds all interfaces and the `/api/control/*`
  catch-all forwards any method to any handler with no credential check, while
  `/api/server/*` carefully checks a bearer token to reach the same handlers.
  Worth a decision before the LAN setup grows: single-operator localhost, or a
  real token.
- **No schema versioning.** 30 `CREATE TABLE IF NOT EXISTS` plus 17
  `addColumnIfMissing` calls, no version row, no backup before a change, no way
  back. `db/migrations.py` in the reference was the model: numbered, additive
  only, backup then restore-on-failure.
- **The database lives inside the working tree** (`config/bilibili.db`). A
  clone or a clean loses connected accounts and job history.
- **Secret encryption is opt-in.** `src/lib/security/secrets.js` is sound, but
  everything except Gmail falls back to plaintext when the key is unset.
- **`node_modules/` is tracked in git** — 310 of 703 tracked files.
- **No CI and no ESLint config.** Consequence: the test suite's true state is
  unknown. 30/39 passed when I ran it, but every failure was a native-binary
  mismatch from running in a Linux VM against macOS-built modules — re-run on
  macOS before believing any of them.

---

*Method: full read of the reference repo, then structural read of this one —
health/diagnostics paths, connection and credential handling, the pipeline
registry, navigation and component boundaries, styling system, tests. The
reference clone has been deleted.*
