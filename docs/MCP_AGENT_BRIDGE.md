# MCP agent bridge

VideoOps is a single-owner workspace. There is no app login, operator cookie,
agent-token requirement, or separate human publishing approval. The owner
authorizes work by asking their MCP client to perform it. Network access is
controlled by the listener and your Tailscale permissions.

## Setup

1. Install dependencies with `npm install`.
2. Start locally with `npm run dev:local`, or run `npm run build` followed by
   `npm run start:tailscale` for tailnet access. The Tailscale command uses
   `tailscale ip -4` and binds only to that device's Tailscale IPv4 address.
   Set `TAILSCALE_BIN` if its CLI is not on PATH. Alternatively set
   `VIDEO_ACCESS_MODE=tailscale` and `VIDEO_BIND_HOST` to the host's Tailscale IP.
3. Configure the stdio MCP server:

```json
{
  "mcpServers": {
    "videops": {
      "command": "node",
      "args": ["/absolute/path/bilibili-uploader/scripts/mcp/server.mjs"],
      "env": {
        "VIDEO_AGENT_BASE_URL": "http://your-device.your-tailnet.ts.net:4455"
      }
    }
  }
}
```

No token, pairing, or insecure-HTTP opt-in flag is needed. For local use, the
base URL defaults to `http://127.0.0.1:4455`. Point the client at the backend
beside its SQLite database, not a remote-mode frontend.

The bridge exposes the same 24 operations as `/api/agent/v1/openapi.json`.
It does not open SQLite or run the upload worker in the stdio process.
Optional legacy bearer headers still work, without granting a different role.

## Tools at a glance

| Area | Read | Write |
|---|---|---|
| Jobs | `list_work`, `get_job`, `get_video_context`, `check_preconditions` | `propose_metadata`, `retry_job`, `cancel_job` |
| Library records | `search_catalog`, `get_saved_upload` | `update_video_record`, `save_upload_metadata`, `queue_saved_uploads`, `delete_video_record` |
| Bilibili checklist | `list_creator_videos`, `plan_batch` (dry run) | `scan_creator`, `select_creator_videos`, `queue_batch` |
| YouTube posts | `list_youtube_posts`, `get_youtube_post` | `save_youtube_post`, `claim_youtube_post`, `record_youtube_post` |
| Settings | resource `videops://title-contexts` | `save_title_context` |

Resources: `videops://manifest`, `videops://presets`, `videops://health`,
`videops://title-contexts`, and the template `videops://job/{id}/log`.

Every write needs a unique `idempotencyKey`; repeating a call with the same key
and arguments replays the first result instead of acting twice. Edits to an
existing item also need `ifMatch` (the item's `updatedAt`); a mismatch returns
`STALE_WRITE`, so reload and retry. Errors always have a typed `code`:
`INVALID_INPUT` (fix the arguments; `details` lists each problem),
`NOT_FOUND`, `STALE_WRITE`, `PRECONDITION_FAILED` (with the app's own reason),
`NEEDS_CHOICE`, or `RETRYABLE` (backend busy or unreachable).

## Adding a tool

1. Declare it in `src/lib/agent/contract.js` with `operation(...)`: name,
   JSON Schema, method and path. Writes must include `...write`.
2. Add its handler to `readHandlers` or `writeHandlers` in
   `src/lib/agent/service.js`. Call the same `src/lib` function the console
   route uses, so the app and the MCP validate identically. Write handlers run
   inside the audited, idempotent transaction and must be synchronous.
3. Nothing else: the REST route, OpenAPI document and stdio MCP server are
   generated from the contract. Importing `service.js` fails if a contract
   operation has no handler, or the wrong kind.
4. Add a test to `test/agent-bridge-tools.test.mjs` and update the tool count
   in `test/agent-bridge.test.mjs`.

Deliberately not exposed: runtime/connection settings, raw SQL, and editing a
record's status or publication history (these protect duplicate-upload checks).

## Upload workflow

- `check_preconditions` reports `humanApprovalRequired: false`.
- `queue_saved_uploads` queues saved video records and metadata for upload,
  without stopping for console approval.
- For a saved Bilibili checklist, use `plan_batch` then `queue_batch`.
  Planning is read-only and signs the exact batch for fifteen minutes using
  an internal, in-memory key; it requires no operator-token setup.
- MCP-created jobs bypass metadata and correction-review pauses. Saved source
  material, target account, visibility and schedules continue through the worker.
- `propose_metadata` updates a metadata hold and resumes immediately.
  `retry_job` can also resume an existing metadata/correction hold without an
  additional human approval. Existing held work is not bulk-resumed merely by
  updating the app.
- `claim_youtube_post` can claim a saved draft directly for owner-requested GUI
  delivery, without first marking it approved in the console.
- `get_job`, `list_work`, and the job-log resource expose progress and receipts.
  Return the observed destination URL after delivery; do not report success
  from a queue response alone.

The app still checks readable media, exact account binding, valid metadata,
batch sizes, versions and duplicate-delivery receipts. These are correctness
checks, not authorization prompts. YouTube/Google sign-in, API quota, browser
verification and platform upload limits are external requirements and are not
bypassed. An MCP host may independently have its own tool-permission settings.

## Editing and deleting records

`update_video_record` edits the Library fields: title, campaign, language,
priority and planned schedule. Get `id` and `updatedAt` from `search_catalog`
and pass `updatedAt` as `ifMatch`.

`delete_video_record` removes an idle video from the working catalog. First use
`search_catalog` to get its `id` and `updatedAt`, then provide `videoId`,
`ifMatch` and a unique `idempotencyKey`. Cancel queued, running, or review jobs
and wait for them to stop first. Deletion is logical: the row, media, job and
publication history remain on disk to preserve delivery and duplicate-upload
checks. It does not delete any external video or editor project.

## Deployment boundary

Anyone who can reach this service has full workspace and publishing authority.
Use Tailscale permissions to restrict access to your devices. Do not expose the
service through Tailscale Funnel or a public listener. Tailnet membership is
not inherently limited to one person.

Default local startup remains loopback-only. The explicit `shared` listener
mode is retained for compatibility and is also token-free; it defaults to all
interfaces, so prefer `start:tailscale`. Remote-mode frontends need only the
backend URL; their access-token fields are removed. SQLite must remain local
to the backend, never on a network share.

For private Tailscale Serve, keep the backend loopback-bound instead: persist
`VIDEO_ACCESS_MODE=tailscale`, `VIDEO_BIND_HOST=127.0.0.1` and `PORT=4455`,
then start `node scripts/run_server.mjs start --web-only` while validating.
Do not add `--shared` or `--tailscale`. Set `VIDEO_AGENT_BASE_URL` to the private
Serve HTTPS origin. This supports tailnet use without SSH or app sign-in.

## Outbound Video Editor MCP

The publishing bridge above remains this app's MCP server. Separately, the
worker is an MCP client of video-automation for video creation. Use processor
`videoEditor` with `mode: "localize"` or `mode: "render"`; its endpoint defaults
to `http://127.0.0.1:4560/mcp`. Model and editing configuration belongs to the
editor. See [video creation](VIDEO_GENERATION.md) for media handoff and retries.
