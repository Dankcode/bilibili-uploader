---
name: youtube-gui-upload
description: Train host-local YouTube Studio button references on a new desktop, including Linux GNOME Wayland, then perform SQL-backed GUI uploads through computer-use MCP and preserve real screenshot receipts in bilibili-uploader.
---

# YouTube GUI upload

Work in the bilibili-uploader repository. Read `docs/STUDIO_VISION_UPLOADER.md`
for the runtime and `docs/MCP_AGENT_BRIDGE.md` when using the app MCP. This skill
adds instructions, not a new MCP server, browser session or OS permission.

## Train on a new host

For requests to set up, self-train, port, or recalibrate the uploader on another
machine, follow [Host-local training](references/host-training.md) first. The
agent discovers its own desktop tools, opens its local browser, captures its
own references, and validates fresh observations. Do not transfer Mac calibration
images as a working Linux profile. Training means calibrating and verifying GUI
controls, not changing model weights or installing an unattended uploader.

Use the existing authorized destination and visibility. A request to train the
GUI authorizes desktop inspection and reversible calibration, but does not by
itself choose a video or authorize an additional publication. Complete training
up to that boundary if no upload is authorized. Browser sign-in and desktop
access follow the host tools' actual capabilities and user interaction rules.

## Select the task and destination

Identify source files, exact channel and privacy from the current user request.
Reuse existing authorization. Check the channel ID in Studio's URL and its
visible identity before selecting a file. If the active account differs from
an unresolved destination, ask once. Check previous uploads and receipts to
avoid uploading the same source twice. Keep verification uploads private unless
the user explicitly requests a different supported visibility.

Use real screenshots as training evidence. Still screenshots do not require
continuous video recording: do not start a recorder. Keep screenshot permission
available when the user allows still captures. Stop only recording sessions
started for this task; do not change unrelated recording sessions or permissions.

## Agent-assisted calibration

Use the available computer-use MCP according to its documentation. Verify that
the selected local browser stays on the target tab between observations and actions. Re-derive
control indices from each fresh accessibility tree; stop if another person or
agent is using the same desktop. Do not run a stale index after a refresh.

Capture the full-size browser window. A thumbnail, frozen image or blank capture
is not usable. Restore a visible normal window and verify a fresh screenshot
before cropping. Read actual image dimensions and scaling, not a
resized preview's dimensions. Save screenshots from the tool's returned bytes.

The app reads `scripts/python/studio_templates.manifest.json`. Train those names
into the selected `YOUTUBE_STUDIO_TEMPLATE_DIR` (default
`config/studio_templates/default`). `channel_badge` should include the channel
name; a generic avatar is insufficient. Capture stable field labels with a click
point inside their input, enabled buttons, the appropriate audience radio,
visibility choice, upload-complete status and final saved-confirmation wording.
Avoid private account details, changing video titles and tiny generic icons.

Use the offline capture command; it does not access the desktop:

```sh
.venv-gui/bin/python scripts/python/youtube_studio_vision_uploader.py \
  --capture-from /absolute/path/screenshot.png --template create_button \
  --box X Y WIDTH HEIGHT --logical-size LOGICAL_WIDTH LOGICAL_HEIGHT \
  --confidence 0.94
```

`--box` and optional `--click X Y` are **physical screenshot pixels**. The click
point defaults to the crop center. The logical dimensions describe that same
image, not an unrelated desktop. The command rejects blank, out-of-bounds or
ambiguous crops and saves a small PNG plus the app's calibration metadata.
Full-window and desktop captures may have different origins: establish the
mapping before passing matched points to MCP. Never assume a missing offset.

Operate Studio through the authorized GUI: Create, Upload videos, Select files,
Details, audience, elements/checks, visibility, Save. Verify filled metadata and
Private selection. Capture each reference when its actual state appears. Do not
invent references for controls not observed. Login or challenges follow the host
tool's rules; do not save passwords in templates or solve a CAPTCHA automatically.

## Replay and MCP integration

Validate against a fresh screen, not only the calibration screenshot:

```sh
.venv-gui/bin/python scripts/python/youtube_studio_vision_uploader.py \
  --check --screen-image /absolute/path/fresh.png --logical-width LOGICAL_WIDTH
```

Report missing required templates. During MCP replay, match a fresh capture,
verify a stable unique control, click it using the MCP's correct coordinate
mapping, and inspect the next state. Accessibility-assisted actions are valid
for the assisted run; label them honestly rather than claiming an autonomous
image-only replay.

The app's standalone PyAutoGUI mode is `uploadMethod: studio`. Use it only when
that runtime is specifically authorized and permitted by the host tool rules.
Do not change to another runtime to evade a denied MCP action. It requires a
signed-in unlocked desktop and no competing keyboard/mouse activity.

For app MCP orchestration, `check_preconditions`, `list_creator_videos`,
`plan_batch`, `queue_batch`, `list_work`, `get_job` and `get_video_context` operate
through the existing authenticated bridge. Follow its actual returned schema,
idempotency keys and versions. The app's persisted operator metadata approval
is a separate boundary; do not bypass it by writing SQL or inventing approval.
Direct user-authorized GUI verification and queued pipeline work are distinct.

Stop on a wrong channel, missing/ambiguous controls, unexpected UI, failed checks,
login challenge or uncertain save. Once a file has been submitted, inspect Studio
and reconcile the existing receipt before retrying; there may already be a draft
or saved upload. Never claim a synthetic test proves a live YouTube upload.

## Completion evidence

After each upload, verify the saved confirmation and its video URL or a Studio
content row with matching title, visibility and identity. Capture the real final
state. The standalone runtime saves `upload-confirmed.png` before closing the
dialog and returns its path in `STUDIO_RESULT`. That is a still image, not a
recording. A draft, upload progress indicator or process exit is not completion.

Save a receipt linking source checksum, channel, URL, privacy, timestamp, mode
(assisted or replay) and screenshot path. Preserve app publication records when
using the pipeline. Display the real screenshot inline with an absolute local
path and link the matching video. If blocked, name the blocker and what remains;
never fabricate a completion screenshot.

Distribute this folder with the app. Users can copy or symlink it into their
agent's skill directory and invoke `$youtube-gui-upload` with their channel and
videos. Computer-use MCP, app MCP credentials, signed-in browser and locally
trained templates remain separate prerequisites.

## Database upload workflow

Library > Upload selected queues saved video records through the backend worker.
Existing media is reused; supported remote sources download only when needed.
Metadata uses saved transcript or source description, natural concrete wording,
and no em dashes. Studio defaults to submitting Save without waiting for upload
checks or processing. Record this as submitted, not processed or published.
The optional `verifyCompletion: true` restores the slower verification mode.
Keep the browser running so background transfers can finish. Do not close its
window or kill the browser after submission. Existing receipt checks still
prevent duplicate uploads.

For community text posts use `skills/youtube-post/SKILL.md` and its dedicated
MCP draft/claim/receipt workflow.

## Fast GUI handoff

Download Bilibili media through the source adapter/API, validate it and save its
version/checksum in the app database before selecting the file in Studio.
Prepare grounded metadata before GUI entry. Use accessibility fields to enter
and verify title, description, audience and tags in one Details pass. When the
observed Visibility tab is available, use it directly instead of three Next
clicks. The standalone runtime supports the optional trained
`visibility_tab_button` with Next as fallback. Read the generated video URL,
select the requested visibility, Save and capture the acceptance once. Do not
poll processing or checks. Keep the browser open, persist the receipt as
submitted, and reconcile uncertain saves before retrying. If the screenshot
and accessibility state disagree, restore a fresh active window before using
image matches or claiming screenshot confirmation.


## SQL metadata and source identity

Select the SQL video ID with `search_catalog`, inspect `get_saved_upload`, and
respect its duplicate blocker. Use `save_upload_metadata` to persist title,
description, tags, personality and context with the returned version. Then call
`queue_saved_uploads` with `metadataMode: saved` or `generate`. Never substitute a
local file path for the SQL identity. The backend resolves its saved media
reference. Agent-queued jobs still require the console's operator metadata
approval. Check publication URLs and unresolved receipts across equivalent source
URLs before any new GUI selection; tracking parameters do not make a new video.
