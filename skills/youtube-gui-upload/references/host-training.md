# Host-local GUI training

Use this procedure on the machine whose desktop will perform the upload. Work
from its bilibili-uploader checkout. All paths below are relative to that checkout
unless explicitly absolute. Resolve a different installed skill location back to
the application repository before running its helpers.

## Discover and prove desktop access

Inspect the active session, desktop, browser and available computer-use MCP tools.
Record OS, session type, browser/version, desktop size, scale, browser zoom,
language and theme. Prefer the installed browser that the host tools actually
support. Firefox is valid for an assisted workflow when those tools can operate
it; a Firefox installation alone does not prove GUI control or standalone replay.

On GNOME Wayland, do not assume an SSH process, DISPLAY variable, XWayland browser,
or PyAutoGUI installation can capture/control the whole desktop. Discover the
host's permitted desktop control capability and read its tool documentation. Use
that capability in the active user's session. If a portal requests user selection
or consent, let the user complete it. Do not silently switch to Xorg, weaken
desktop security, or start a screen stream/recorder to get a screenshot.

Prove three capabilities with a harmless browser page: one fresh still screenshot,
a click on a visible control, and text entry followed by a fresh observation.
Verify that the image changes with the real window, and that screenshot pixels
map correctly to tool coordinates. If any capability is unavailable, save the
specific blocker; do not proceed with blind clicks or call the host trained.

When no browser profile exists, launch the installed browser normally through
the supported host tools. Let it create a local profile. Continue to Studio and
reuse a signed-in session, or let the user sign in when required. Never import
another machine's cookies, authentication profile, or passwords for calibration.
Verify the intended channel ID and visible identity after sign-in.

## Create an isolated local profile

First inspect the [reviewed visual examples](../assets/studio-examples/README.md)
and [example index](../assets/studio-examples/examples.json). Match the semantic
purpose of each control to the local UI, then capture it anew. Do not copy this
directory into a runtime profile or treat the examples as successful upload
evidence. The index deliberately omits channel identity and click coordinates.

Choose a descriptive profile such as `oldlaptop-firefox-wayland`:

```sh
export YOUTUBE_STUDIO_TEMPLATE_DIR="$PWD/config/studio_templates/oldlaptop-firefox-wayland"
```

Keep existing profiles intact. Store evidence under
`video-work/gui-training/<profile>/<run>/`, with small reference PNGs and
`calibration.json` under the template directory. These are local runtime data,
not source files to commit. Use the application's Python environment with the
offline image-processing dependencies verified; do not assume the Mac venv is
portable. Read the helper's `--help` before invocation if the checkout differs.

Read `scripts/python/studio_templates.manifest.json` as the control-name contract.
The channel identity reference is required. Also train controls required by the
chosen workflow even when the manifest marks them optional: Show more/tags and
the selected privacy option. Requested tags cannot be silently omitted.
Train the direct Visibility tab if observed, retaining Next as a fallback. Do not
train Public controls just to exercise states outside the authorized workflow.

For each state, capture a still image using the desktop tool and crop stable
labels/buttons from its actual pixels. Avoid changing titles, progress percentages,
personal information and generic icons shared by multiple controls. Example:

```sh
YOUTUBE_STUDIO_TEMPLATE_DIR="$PWD/config/studio_templates/oldlaptop-firefox-wayland" \
  .venv-gui/bin/python scripts/python/youtube_studio_vision_uploader.py \
  --capture-from /absolute/path/observed.png --template create_button \
  --box X Y WIDTH HEIGHT --logical-size LOGICAL_WIDTH LOGICAL_HEIGHT \
  --confidence 0.94
```

Replace every coordinate with measured values. The box and optional `--click X Y`
are physical image pixels; logical dimensions describe the same captured region.
Record the window origin if translating into desktop coordinates. The offline
helper creates real cropped references and metadata; it does not control Wayland.

## Train progressively and verify fresh frames

Navigate Create > Upload videos using observed controls. Selecting a file starts
an external transfer, so use only the SQL video/channel/privacy authorized for
this run. Without one, stop at the file picker and report partial calibration.
For an authorized upload, use the app's source API and SQL media record, prepare
the saved title/description/tags first, and check source-URL duplicate blockers.

Capture title/description fields, audience controls, tags, navigation, visibility,
Save and real saved-result markers as those states appear. Choose the audience
from the content/job metadata, not a blanket training default. No synthetic
completion references and no second upload merely to obtain another screenshot.

Validate reference matching on a new still screenshot:

```sh
YOUTUBE_STUDIO_TEMPLATE_DIR="$PWD/config/studio_templates/oldlaptop-firefox-wayland" \
  .venv-gui/bin/python scripts/python/youtube_studio_vision_uploader.py \
  --check --screen-image /absolute/path/fresh.png --logical-width LOGICAL_WIDTH
```

Inspect both template coverage and currently visible matches. References for
other screens should not match the current screen. Test each relevant state on
fresh observations during the same authorized run. Require a unique stable match
before each image-based action, then verify its expected transition. Prefer
semantic/accessibility actions where supported, recording that the run was assisted.
On a failed match, inspect and correct that reference from the current UI; do not
blindly lower all thresholds or loop indefinitely. Stop after two failed attempts
at the same transition and record the unresolved state.

Save once after verifying metadata, channel and privacy. Observe acceptance and
capture one still confirmation, preserving URL and SQL source identity. Do not
poll transfer/processing completion by default. Record accepted work as submitted
and leave the browser open. An uncertain Save needs reconciliation with existing
Studio content/drafts and receipts before retrying.

## Record capability and hand off execution

Save a `training-report.json` beside the profile with:

- Profile, timestamp, environment fingerprint and screenshot coordinate mapping.
- Desktop tool/runtime actually used, screenshot/click/type probe results.
- Observed/trained controls and fresh-frame verification results.
- Missing controls and the precise next blocked step, if any.
- Stage: `desktop-ready`, `partially-calibrated`, `calibrated`,
  `assisted-upload-verified`, or `standalone-replay-verified`.
- For a verified upload: SQL video ID, source URL/checksum, channel, visibility,
  YouTube URL, submitted status, receipt and screenshot paths.

Do not include credentials or declare standalone verification from an assisted
MCP run. A skill guides an agent; it is not a daemon or a Wayland input backend.
The existing app's `studio` worker uses PyAutoGUI. Keep that execution path disabled
unless its capture, input, browser navigation and upload flow have actually passed
on this host. An available MCP desktop tool does not automatically make PyAutoGUI
work. Report the integration gap if the host supports only assisted execution.

Once standalone replay is verified, configure its template directory and browser
session for that same runtime. If it remains assisted, run through the agent's
GUI tools and existing app MCP contracts; do not invent a queue-claim or upload
receipt endpoint. Do not let a background worker and GUI agent deliver the same
job. Follow the entrypoint's SQL approval and receipt rules.

Revalidate on browser/theme/language/zoom/scale changes, stale screenshots, or
failed transitions. Reuse good local references; replace only stale ones. Return
the report and real evidence so another agent can resume without retraining from
scratch or repeating an upload.
