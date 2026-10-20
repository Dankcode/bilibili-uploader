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

The bridge exposes the same twenty operations as `/api/agent/v1/openapi.json`.
It does not open SQLite or run the upload worker in the stdio process.
`npm run mcp:setup` is now a compatibility notice; old credential files are
preserved but not required for access. Optional legacy bearer headers still
work, without granting a different role.

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
