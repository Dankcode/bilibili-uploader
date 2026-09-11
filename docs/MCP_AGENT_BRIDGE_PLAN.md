# MCP Agent Bridge — Implementation Plan

Status: **plan and code review only, nothing built yet.**
Reviewed against the working tree at `b1cc71b` (branch `codex/pygui-upload`), 2026-09-10.
Companion plan artifact: https://claude.ai/code/artifact/93411104-cd81-43b0-893e-724efaca6c62

Scope: an MCP server that lets an agent drive the pipeline end to end — scan a creator
page, select videos, plan and queue a batch, draft metadata — and stops it one move short
of publishing.

Decisions taken with Leon before writing:

| Question | Decision |
|---|---|
| Transport | **stdio server in-repo** (`scripts/mcp/server.mjs`), launched by the MCP client. Not a Next.js HTTP route yet — zero new network exposure, works with every client today. |
| Layering | **MCP wraps `/api/agent/v1`** (the 2026-08-27 design in `AUTOMATION_PLANNER_API.md`'s successor), not direct `src/lib/*` imports. One place for auth, idempotency and audit; REST and MCP cannot drift. |
| Autonomy | **Agent proposes, human approves at the metadata review gate.** Not full auto, not tiered. |
| Deliverable | This document plus the code review in §5. Leon does the coding. |

---

## 0. The one-paragraph version

An agent gets thirteen typed tools over stdio. Twelve of them read or stage work; the
thirteenth, `propose_metadata`, writes a title/description/tags draft onto a job and leaves
it parked in `status = 'review'` with a deep link back to the console. There is no
`approve_metadata` tool, no scope that grants one, and no REST path the agent can
construct — so "wait for a human here" is enforced by the absence of a capability rather
than by the model choosing to behave. Before any of that is safe, four critical defects in
the existing surface have to be closed, the first of which is that **the review gate this
whole design rests on does not currently fire.**

---

## 1. The finding that changes the plan

`pauseForReview` is not a property of the pipeline. It is a per-job boolean the *caller*
sets, and every path that currently creates a job sets it to `false`.

```
src/lib/pipeline/processors/metadata.js:145
    pauseForReview: Boolean(options.reviewMetadata)

src/lib/pipeline/presets.js:24        metadata: { reviewMetadata: false }
src/lib/pipeline/presets.js:39        metadata: { reviewMetadata: false }
src/components/AutomationHub.js:479   reviewMetadata: false
src/lib/studio/publish.js:15          reviewMetadata: false
src/components/SubtitleStudio.js:161  reviewMetadata: false   <- only UI that can flip it
```

So a batch queued from the Automation planner today runs source -> processors -> YouTube
with no human in the loop at all. The "existing gate" fires only when someone ticks a
checkbox in Subtitle Studio.

There is a second hole behind it. `runNextQueuedJob()` (`pipeline.js:718`) pauses only when
a step reports its own `pauseForReview`, and only the `metadata` processor ever does. A job
with `processorIds: []` and `uploaderId: 'youtube'` has nothing that *can* pause it,
whatever the options say.

**Fix, and it belongs in Phase 0 before any agent tool writes anything.** In
`validateJobInput()` (`pipeline.js:166`): when the principal is an agent **and**
`uploaderId` is set, force `options.metadata.reviewMetadata = true` **and** require
`metadata` in the processor chain, rejecting the job otherwise. Not a default the agent can
override — a constraint the agent cannot express.

---

## 2. Architecture — one contract, two faces

MCP-over-REST is the right call: hermes and ComfyUI need HTTP anyway, and duplicating
validation between an MCP server and a REST route is how the two drift. But do not write
the tool schemas twice either.

Add **`src/lib/agent/contract.js`** — one array of operation descriptors, each carrying:

```js
{
  name: 'list_work',
  title: 'List work waiting on someone',
  description: '...',                 // what the model reads
  inputSchema: { /* JSON Schema */ },
  method: 'GET',
  path: '/work',
  annotations: { readOnly: true, destructive: false, idempotent: true },
  project: (row) => ({ /* trim the app response to what an agent needs */ }),
}
```

Three things generate from that array:

1. the Next route handlers under `/api/agent/v1/*`,
2. `GET /api/agent/v1/openapi.json`, for hermes and ComfyUI,
3. the MCP server's `tools/list` response and its dispatch table.

This inherits the property the `/api/agent/v1` design already had — job validation reads
`src/lib/pipeline/registry.js`, so adding a processor teaches the agent about it with no API
change — and extends it to the tool list itself.

```
Claude / hermes ──stdio──> scripts/mcp/server.mjs ──bearer──> /api/agent/v1
                                                                    │
                                                          contract.js -> registry.js
                                                                    │
   source ──> processors ──> metadata ──> [ REVIEW GATE ] ──> uploader
   └──────── agent writes here ────────┘   human only        agent reads only
```

---

## 3. The MCP surface — thirteen tools, not forty-one

The earlier REST design listed 41 functions. Ship all 41 over HTTP if useful, but do **not**
turn them into 41 MCP tools: every tool definition is re-sent on every turn, and a model
choosing among forty near-identical verbs picks badly and often.

`list_work` is the spine. It tells the agent what is stuck and names the tool that unblocks
each item, so the model never has to hold the state machine in its head.

| Tool | Kind | What it does | Wraps |
|---|---|---|---|
| `list_work` | read | The inbox. `state = needs_metadata \| in_review \| failed \| scheduled \| running`. Compact rows, each with a `nextAction` naming the unblocking tool. | `listJobs` + `video_records` |
| `get_job` | read | One job in full: steps, attempts, error, bound channel, assets. | `pipeline.js:796` |
| `get_video_context` | read | Everything needed to write metadata for one item — source title, transcript, OCR text, duration, the creator's prior published titles. **The context half of the plan.** | `video_assets` + `video_publications` |
| `check_preconditions` | read | Quota remaining, usable YouTube authorizations, connection health, disk. Called before planning so failures are answers, not queue-time exceptions. | `diagnostics.js` + `usage.js` |
| `search_catalog` | read | Fixed-projection lookup over `video_records` / `video_publications` — "which bvids are already published". | `operations/store.js` |
| `list_creator_videos` | read | The scanned checklist for one creator, with per-row selected / already-published state. | `scrapedCatalog.js` |
| `scan_creator` | write | Account URL -> resolved mid -> paginated enumeration -> checklist rows. Idempotent per `(creatorId, day)`. | Phase 4, Python scraper |
| `select_creator_videos` | write | Bulk tick/untick by bvid. Chunked; refuses partial application rather than truncating. | `operations/bilibili-scrapes` |
| `plan_batch` | read | **Dry run.** Returns exactly what would be queued, the quota cost, the `scheduledFor` spacing and every blocker, plus a `planToken`. Writes nothing. | new |
| `queue_batch` | write | Commits a plan. Requires the `planToken` and an `idempotencyKey`. Server forces the review gate on. | `createJobBatch` |
| `propose_metadata` | write | Writes a draft onto the job's metadata asset. Job **stays** in `review`. Returns the console deep link. | new — *not* `approveMetadata` |
| `retry_job` | write | Resumes at the failed step, honours `max_attempts`. | `pipeline.js:848` |
| `cancel_job` | write | Cancels queued / review / running, returns the real resulting status. | `pipeline.js:947` |

### 3.1 Four resources

MCP resources are fetched on demand rather than shipped every turn, so the bulky and rarely
decisive material goes here: `videops://manifest` (the registry's sources, processors and
uploaders with their option schemas), `videops://presets`, `videops://health`, and
`videops://job/{id}/log`. The agent pulls a log only when it is actually diagnosing.

### 3.2 Deliberately absent

| Not a tool | Why |
|---|---|
| `approve_metadata` | The human's move. Not a scope the agent token can hold. |
| `run_sql` | Full read/write SQL was agreed for REST. Do not surface it over MCP — a model with a SQL tool will use it instead of the typed ones. |
| `save_runtime_settings` | Repoints the whole control plane. Never reachable from a tool call. |
| any `delete_*` | No agent tool destroys a record. `cancel_job` is the strongest verb available. |

### 3.3 Two protocol details worth using

- **Elicitation** for the one genuinely ambiguous choice: which YouTube authorization, when
  several are usable. `resolveYouTubeAuthorizationId` currently throws in that case
  (`pipeline.js:100`). Client support varies, so fall back to a typed `NEEDS_CHOICE` error
  carrying the options.
- **Tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`) generated from
  the same `contract.js` row. Clients use them to decide what to auto-approve; getting them
  right is what makes the server safe to leave connected.

---

## 4. Rails — what an agent breaks that a browser doesn't

The console's write paths were built for one operator clicking one button. Four assumptions
stop holding the moment a model is calling them.

1. **Retries are automatic.** An MCP client that times out re-calls the tool. `createJob`
   has no dedupe key, so a retry is a second job and a second upload — the
   upload-idempotency bug that has been open since the first audit, now much easier to
   trigger. Add an `Idempotency-Key` header plus an `agent_idempotency` table that stores
   the first response and replays it.
2. **Two writers now.** Nothing on `updateVideoRecord`, `updateScrapedBilibiliVideo` or
   `updateQueuedJob` detects a concurrent edit. Inline-editing a title while the agent bulk
   updates the same row means one of you loses silently. `If-Match: <updated_at>` ->
   `409 STALE_WRITE`.
3. **Errors are read by a machine.** Every route answers `400` with a bare message, so
   "Job not found", a validation failure and an internal fault are indistinguishable. An
   agent cannot tell retryable from fatal, so it retries the destructive ones. Typed codes
   (`NOT_FOUND`, `INVALID_INPUT`, `PRECONDITION_FAILED`, `STALE_WRITE`, `RETRYABLE`) with
   correct HTTP status.
4. **Someone will ask what it did.** An `agent_actions` table — principal, tool, arguments,
   result, timestamp — and a plain view of it in the console. Without it, "why is this
   queued" has no answer.

One more, MCP-specific: `listJobs` returns steps, logs **and** assets for up to a hundred
jobs. Fine feeding a DOM; as a tool result it lands in the model's context window and can
run to hundreds of kilobytes. **Every list tool caps at 25 rows with a cursor, and no list
tool ever returns a log.**

---

## 5. Code review — the surface MCP would expose

Scoped to what an agent would touch: job creation and the review gate, the approval path,
the two proxies, runtime settings, and the operations write routes.

| # | Sev | Where | Finding |
|---|---|---|---|
| A1 | Critical | `metadata.js:145`, `presets.js:24,39`, `AutomationHub.js:479`, `publish.js:15` | The review gate never fires by default. `pauseForReview` is caller-controlled and every default path disables it. See §1. |
| A2 | Critical | `pipeline.js:718` | A job with no `metadata` processor cannot pause at all. `processorIds: []` + a YouTube uploader publishes unattended. |
| A3 | Critical | `pipeline/jobs/route.js:15`, all `operations/*` | Job and operations routes are unauthenticated. Only `/api/server/[...path]:19` checks a bearer token, and the server binds `0.0.0.0` — any LAN host can queue, cancel, approve or bulk-edit. MCP adds a standing reason to keep that port open. |
| A4 | Critical | `runtime/settings/route.js:19` | `assertSameOrigin()` returns early when there is no Origin header. curl has none, so a LAN caller can POST `action:"save"` with `connectionMode:"remote"` and repoint the control plane. Open since 2026-08-27. |
| A5 | High | `server/[...path]:72`, `control/[...path]:29` | Both proxies build the target as `new URL('/api/'+path, incomingUrl.origin)`, and that origin derives from the Host header. Verify with `curl -H 'Host: example.invalid'`; fix is a fixed `http://127.0.0.1:${port}` base. |
| A6 | High | `pipeline.js:397` | No idempotency key on `createJob`. A timed-out tool call the client retries produces a duplicate job and a duplicate upload. |
| A7 | High | `operations/videos/route.js:22`, `bilibili-scrapes:21` | No optimistic concurrency on any write route. Agent and human edits to the same row clobber each other with no error. |
| A8 | High | `pipeline.js:869` | `approveMetadata` records no actor. Nothing distinguishes a human click from an API call, so "who approved this" is unanswerable and the gate cannot be enforced against an agent that finds the endpoint. |
| A9 | High | `pipeline/jobs/route.js:57` | Every failure returns `400` with a bare message, including "Job not found" and internal errors. Machine callers cannot classify them. |
| A10 | Medium | `pipeline.js:796` | `listJobs` inlines steps, full step logs and assets for up to 100 jobs. Unbounded payload; as a tool result it burns the context window. |
| A11 | Medium | `pipeline.js:971` | `bulkJobAction` silently `.slice(0, 100)`s the id list and reports success for the truncated set — same class as the `AutomationHub.js:155` batch truncation. |
| A12 | Medium | `pipeline.js:100` | `resolveYouTubeAuthorizationId` throws mid-validation when zero or several channels are usable. Correct behaviour, wrong moment for an agent — it needs this as a queryable precondition. |

**Verdict: request changes.** A1–A4 must land before the MCP server is allowed a single
write tool. A1 and A2 are not "harden the API" items; they are the difference between the
design above and one where an agent publishes to the channel unattended. A5–A9 are the rails
that make agent traffic survivable. A10–A12 can ride along with Phase 1.

---

## 6. Phases

Each phase names how you know it worked.

### Phase 0 — Rails
A1–A4 plus typed errors (A9). Server-side forcing of `reviewMetadata` for agent principals;
require `metadata` in the chain when an uploader is set; bearer auth on the job and
operations routes; fix `assertSameOrigin`; fix both proxy base URLs. No new features.

> **Done when** a job created with `reviewMetadata: false` by an agent token still lands in
> `status = 'review'`, and `curl` with no Origin header can no longer save runtime settings.

### Phase 1 — Contract
`src/lib/agent/contract.js`, the generated route handlers for the six read operations,
`GET /manifest` and `GET /openapi.json`. Projections that trim `listJobs` to inbox rows (A10).
Nothing writes yet.

> **Done when** `list_work`'s HTTP equivalent answers in under 25 rows with a cursor, and a
> contract test asserts every descriptor's schema validates its own example.

### Phase 2 — Bridge
`scripts/mcp/server.mjs`. Add `@modelcontextprotocol/sdk`. The server imports `contract.js`
for schemas and calls a fixed `http://127.0.0.1:4455` base with the bearer token from its
client-config env. Resources and the six read tools only. Wire into Claude Desktop and Cowork.

> **Done when** `tools/list` returns the six with correct `readOnlyHint`, and asking Claude
> "what's stuck in the pipeline" gets a real answer with no write path present.

### Phase 3 — Writes
`plan_batch` -> `queue_batch` -> `propose_metadata`, with `Idempotency-Key`, `If-Match`, the
`agent_actions` audit table and its console view (A6–A8). `plan_batch` ships first and stays
free — the dry run is what makes the commit reviewable.

> **Done when** the same `queue_batch` call replayed twice creates one batch, and an
> agent-queued job appears in the review queue with a filled draft and an audit row naming
> the tool that made it.

### Phase 4 — Ingest
`scan_creator` and the checklist tools. Depends on `scripts/python/scrape_creator_videos.py`
from the creator-ingest plan — mid extraction, pagination, WBI signing. The P0 truncation in
`runStep`'s source branch (one item taken of N) is a prerequisite, not a detail.

> **Done when** pasting `space.bilibili.com/85729717/upload/video` to the agent yields the
> full checklist, not the first page and not one video.

### Phase 5 — Reach
`GET /api/agent/v1/events` (SSE) so hermes can watch instead of poll — the codebase has no
streaming endpoint anywhere today. Then the Streamable HTTP MCP entry over the same
`contract.js`, for ComfyUI. ComfyUI graphs run to completion, so keep its workflows
single-pass and let hermes own the long watch.

> **Done when** a `job.review_required` event reaches a listener within a second of the
> worker pausing.

---

## 7. Testing

- **Contract tests** — every `contract.js` descriptor's `inputSchema` validates its own
  documented example, and every declared `path` resolves to a real handler.
- **Gate test** — the load-bearing one. Create a job as an agent principal with
  `reviewMetadata: false`, an empty processor chain and `uploaderId: 'youtube'`; assert it is
  rejected. Create one with a valid chain; assert it reaches `status = 'review'` and not
  `done`.
- **Golden `tools/list`** — snapshot the generated tool list so an accidental schema change
  is visible in review rather than in a model's behaviour.
- **Idempotency test** — replay the same `queue_batch` with one key, assert one batch.
- Follow `test/setup.mjs`, which pins `VIDEO_SQLITE_PATH` so tests never open the live DB.

---

## 8. Still-open decisions

- **Quota vs pygui.** ~6 API uploads/day per Cloud project still decides default batch
  spacing, and now also what `plan_batch` reports. If pygui becomes the bulk path,
  `plan_batch` has to model two very different cost curves.
- **One token or many.** A single `serverApiToken` is enough for a stdio server you launch
  yourself. The moment hermes and ComfyUI both connect, `agent_tokens` with per-principal
  scopes is what keeps the audit table meaningful.
- **Whether the console itself ever gets auth.** Phase 0 puts a token in front of the API.
  If the browser UI keeps calling those routes unauthenticated from the same origin, the LAN
  exposure is only half closed.
