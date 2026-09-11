# MCP agent bridge

Implemented from `MCP_AGENT_BRIDGE_PLAN.md`: thirteen stdio tools over the authenticated
`/api/agent/v1` REST contract. The bridge reads the app's existing SQLite catalog,
checklists, jobs, connection health and publications. It does not maintain another queue
or expose SQL, credentials, runtime settings, deletion or publishing approval.

## Setup

1. Install dependencies with `npm install`, then run `npm run mcp:setup` **on the backend**.
   This creates `config/agent-bridge.json` with distinct random `agentToken` and
   `operatorToken`, file permissions `0600`. The file is gitignored; existing tokens
   are never overwritten. Read it locally in your editor, not in shared logs.
2. Start the app normally (`npm run dev`, or build and `npm start`). Sign in to the
   console with **operatorToken**. Once bridge credentials are configured, all legacy
   APIs and server actions require an operator credential. The browser uses a
   twelve-hour HttpOnly, SameSite=Lax session (to preserve Google OAuth callbacks); bearer access remains available to
   trusted operator clients. Operator tokens are not stored in localStorage.
3. Add the following stdio server to your MCP client's configuration, replacing the
   path and **agentToken only**. Never give the client the operator token.

```json
{
  "mcpServers": {
    "videops": {
      "command": "node",
      "args": ["/absolute/path/bilibili-uploader/scripts/mcp/server.mjs"],
      "env": {
        "VIDEO_AGENT_BASE_URL": "http://127.0.0.1:4455",
        "VIDEO_AGENT_TOKEN": "<agentToken from the private config file>"
      }
    }
  }
}
```

Use a direct `node` launch, not an npm command that prints banners to stdout. The
stdio process imports only the shared contract and MCP dependencies; it never opens
SQLite or starts a worker. For remote use, point it at the backend's HTTPS origin,
not a remote-mode frontend. Trusted LAN/Tailscale HTTP requires the explicit client
environment flag `VIDEO_AGENT_ALLOW_INSECURE_REMOTE=1`. HTTP redirects are refused
so the bearer credential cannot follow a redirect to another server.

Server environment overrides: `VIDEO_AGENT_TOKEN`, `VIDEO_OPERATOR_TOKEN`, and
`VIDEO_AGENT_CONFIG` (alternate private JSON file). Existing `VIDEO_SERVER_API_TOKEN`
continues to authenticate the remote operator proxy. Use distinct secrets. `PORT`
must match the Next listening port; both internal proxies always target
`http://127.0.0.1:${PORT || 4455}`, never the incoming Host header.

Bridge setup is deliberately opt-in. With no bridge/operator/backend token configured,
legacy local behavior remains unchanged; do not expose that unconfigured app to an
untrusted network. Do not remove authentication while retaining an agent client.
For HTTPS reverse proxies, preserve the original Host and configure forwarded protocol
correctly. Runtime-setting writes always require an Origin header, including bearer
clients. Other operator bearer calls do not require Origin.

## Agent workflow

1. `check_preconditions`: inspect saved connection health and usable YouTube channels.
2. `list_creator_videos`: reuse the existing SQL checklist. It includes `selected`,
   `isUploaded`, `deliveryState`, and `updatedAt`; uploaded rows are omitted by default.
   `includeUploaded: true` includes them for comparison. Follow `nextCursor`.
3. If necessary, `scan_creator` with a creator URL and page number. Follow `nextPage`
   until null. Each creator/UTC-day/page is deduplicated, in addition to the request
   idempotency key. Interrupted reservations can be retried after five minutes.
   This uses the existing authenticated Playwright/WBI scraper, now explicitly paged;
   it does not depend on a future Python scraper or silently stop at 100 videos.
4. `select_creator_videos`: submit up to 100 `{bvid, selected, ifMatch: updatedAt}`
   entries. A missing, stale, uploaded or disabled long-video row rejects the whole edit.
5. `plan_batch`: submit creatorId and 1–100 BV IDs. Defaults are Bilibili, metadata,
   YouTube, and every one day. `startAt` accepts an ISO timestamp; `everyDays` spaces
   starts by that many 24-hour periods in UTC. Saved title/description/tags, AI prompt,
   generation fields and YouTube options are reused. Explicit cadence replaces per-row
   dates for this plan. Choose `youtubeAuthorizationId` if there is more than one usable
   channel; `NEEDS_CHOICE` includes the choices. `uploaderId: ""` creates processing-only
   jobs. The exact batch, blockers and a signed 15-minute `planToken` are returned.
   Dry-run planning makes no SQL writes and reserves neither quota nor schedule slots.
6. `queue_batch`: supply the token and an `idempotencyKey`. The transaction rechecks
   row versions, uploaded/active-job status and channel validity. Repeating a successful
   request returns its original response; reusing a key with different inputs is rejected.
7. `list_work` / `get_job` / `get_video_context`: inspect progress and saved evidence.
   When a job reaches metadata review, `propose_metadata` saves a draft and leaves it
   in review. `consoleUrl` opens the process page's human approval form.
8. A signed-in operator reviews and clicks **Approve and resume**. This records the
   actor in SQL. Polling does not overwrite their draft: if an agent edits it meanwhile,
   approval is disabled until **Load latest draft** is clicked.

Upload jobs require metadata as the final processor. The server forces review on,
and the worker independently checks persisted operator approval before uploading,
including on retries. An agent retry of a legacy upload without a metadata gate is
rejected; other legacy upload retries acquire the gate. Already-published retries
require operator investigation. Running cancellation is persistent but cooperative:
it takes effect between steps and cannot undo an upload already in flight.

All write tools require an idempotency key. Single-job edits also require `ifMatch`
from `get_job.updatedAt`. REST accepts corresponding `Idempotency-Key` and `If-Match`
headers; conflicting header/body values are rejected. New console checklist, process
and approval edits send versions too. Legacy operator callers may omit a version for
compatibility, so those callers do not receive stale-write protection.

## Discovery, audit and limits

- The tool schemas, REST dispatch and OpenAPI are generated from
  `src/lib/agent/contract.js`. Authenticated OpenAPI: `/api/agent/v1/openapi.json`.
- Resources: `videops://manifest`, `videops://presets`, `videops://health`, and
  `videops://job/{id}/log`. Logs are requested separately, redacted and capped at 64 KiB.
- List tools return at most 25 rows and a cursor, without logs. Video evidence is
  capped at 120 KiB with an explicit truncation flag. Source content is untrusted data.
- **System → MCP activity** shows SQL-persisted changes, failures and human approvals.
  Agent tokens and signed plan tokens are excluded from the audit projection.
- SQLite changes are additive: `agent_actions`, `agent_idempotency`, and job columns
  `agent_principal`, `metadata_approved_by`, `cancel_requested`. Existing saved data is
  retained. Idempotency history is retained to protect old client retries.
- Quota remaining/cost are returned as **unknown**, with upload count separately.
  The app cannot guarantee YouTube API quota or external upload idempotency from SQL.
- HTTP MCP/SSE, event feeds and background autonomous publishing are not enabled.
  The typed `NEEDS_CHOICE` response works even without client elicitation support.

## Verification

`npm test` includes SQL/REST/auth/gate/idempotency/paging regression tests and an actual
SDK stdio handshake/REST-forwarding smoke test against a temporary localhost backend.
Tests use temporary SQLite databases, never the operator database. `npm run build`
checks Next route and frontend compatibility. Live platform scraping, AI generation
and YouTube publishing require separately configured accounts; tests do not perform
those external actions.
