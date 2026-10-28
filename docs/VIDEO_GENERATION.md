# Video creation through Video Editor MCP

Video creation belongs to the separate `Documents/GitHub/video-automation`
project. This uploader contains only an MCP adapter and media handoff, plus
source imports and publishing. The former Subtitle Studio, scene library,
local STT/OCR/translation/TTS, FaceFusion, and rendering engines are removed.

## Setup

1. Install/start video-automation using its own README. Its default local MCP
   endpoint is `http://127.0.0.1:4560/mcp`.
2. In the uploader's Connections, configure **Video creation (Video Editor MCP)**.
   The endpoint defaults to `VIDEO_EDITOR_MCP_URL` or the local URL above. A
   saved bearer token or `VIDEO_EDITOR_MCP_TOKEN` supplies the editor's
   `VA_AGENT_TOKEN` for LAN/tailnet access. Set `STUDIO_SECRET_KEY` before saving
   a token through Connections; the name is retained for secret-store compatibility.
3. Test the connection. This checks advertised MCP tools and editor FFmpeg
   readiness. Configure translation/vision providers in video-automation for
   localization; render-only does not require a model.
4. Queue an automation with `processorIds: ["videoEditor", "metadata"]`, or
   select the create-only preset to return a video without publishing.

## Data flow

```text
source download → create_project (MCP) → stream source to editor
  → autopilot (localize mode only; poll get_job)
  → render (poll get_job) → download MP4 → local media validation
  → publishing metadata → optional YouTube upload
```

The MCP contract is the editor's `src/core/agent/tools.js`. Large media uses
`PUT /api/v1/projects/{id}/media?filename=...` and
`GET /api/v1/projects/{id}/files/renders/...` on the same editor origin. Both
carry the configured server-side bearer token and reject redirects. A shared
filesystem is not required.

Transcript cues are paged through `get_transcript` and saved with the editor
project/render IDs as a pipeline asset. The metadata step can use that text.
The worker validates the downloaded MP4 and records its local video version
before any upload is attempted.

## Job options

```json
{
  "processorIds": ["videoEditor", "metadata"],
  "options": {
    "videoEditor": {
      "mode": "localize",
      "direction": "zh-to-en",
      "quality": "high"
    }
  }
}
```

| Option | Values/default |
|---|---|
| `mode` | `localize` (default), `render` |
| `direction` | `zh-to-en` (default), `en-to-zh` |
| `quality` | `high` (default), `draft` |
| `name` | Optional editor project name; otherwise source title/name |

`localize` uses the editor's configured slide/subtitle localization workflow.
`render` imports and renders the source without automatic translation. Neither
mode recreates the former local dubbing/FaceFusion pipeline. Configure advanced
creation directly in the editor, then import its finished media for upload.
The uploader's planner no longer offers local model or face-swap controls.

## Progress, cancellation and retries

The uploader persists `video-work/<job-id>/video-editor.json` in each job's work directory.
It records the editor project, media, localization job and render job. A retry
polls saved job IDs and downloads their output rather than submitting duplicate
work. Input/settings changes require a fresh job to avoid stale output reuse.
Default polling is every two seconds; the default processing limit is six hours
(`timeoutMs` in connection settings). A polling timeout retains the editor job
for retry. Canceling a running uploader step requests `cancel_job` in the editor.

Before each mutation the checkpoint records a pending submission. If the
connection is lost before its response is saved, the result is uncertain and
the uploader stops. Inspect the editor's projects/jobs before repairing that
checkpoint or creating a replacement job. It never automatically repeats an
uncertain submission.

## Existing workflows and storage

Built-in create/publish presets now select `videoEditor`; obsolete built-in
local-processing presets are removed. Custom presets, queued/historical jobs,
old credentials and user media are preserved. Removed processor IDs are rejected
with a migration message: replace them with `videoEditor` in a new or edited
workflow. Old local options are not silently mapped to unsupported editor tools.
The uploader's original stdio MCP publishing bridge remains available.
