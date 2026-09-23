# Visual YouTube Studio uploader

Status on 2026-09-23: implemented and tested offline. Live reference capture and
the requested two-video verification are **not complete**. The desktop control
tool reached Studio but returned `Screenshot unavailable` and only a navigation
menu. No new video has been uploaded by this implementation and no real control
crops have been fabricated or substituted with test fixtures.

The `gui` upload method uses tight PNG control references. This is template
calibration, not neural model training. The older `pygui` method remains the
manual, coordinate-based uploader. The default remains `api` until live GUI
calibration succeeds.

## Environment

Use a signed-in Chrome window on an unlocked macOS desktop. Studio must be in the
same language, theme and browser zoom as training. Login, channel account access,
CAPTCHAs and any challenges are handled by the operator. The visual uploader does
not read stored credentials or automate password entry.

```sh
uv venv .venv-gui --python /usr/bin/python3
uv pip install --python .venv-gui/bin/python -r requirements-gui.txt
```

Screen recording and Accessibility access must already be available to the host
application. Use one display for calibration; incompatible screenshot/desktop
aspect ratios fail instead of producing incorrect mouse coordinates.

## First video: collect cropped references

Choose a different, upload-ready video that has not already been submitted.
Upload through Studio while collecting the controls listed below as they appear.
Keep the training video private. Inspect its contents and metadata before the
upload, and use the channel's normal audience setting only when appropriate.
The current automated flow is specifically for videos **not made for kids**.

From an already saved screenshot (coordinates are logical screen pixels):

```sh
.venv-gui/bin/python scripts/python/gui_references.py train create /absolute/path/studio.png \
  --logical-size 1440 900 --box 1250 100 100 36
```

The numbers above are illustrative, not pre-trained coordinates. Measure the
actual visible control. The capture command takes a live screenshot in memory
and writes only the crop, without retaining the full desktop:

```sh
.venv-gui/bin/python scripts/python/gui_references.py capture create --box 1250 100 100 36
```

Keep crops tight but include the entire distinctive label and enough of the
button to distinguish its enabled appearance. Avoid titles, thumbnails, account
emails and other changing or private content. References and profile metadata
are saved locally in ignored `config/gui-references/youtube/`.

| Reference | Capture when visible | Click target |
| --- | --- | --- |
| `create` | Channel dashboard | Create button |
| `upload_menu` | Create menu | Upload videos item |
| `select_files` | Upload dialog | Select files button |
| `details` | Details step | Stable Details heading; anchor inside scrolling body |
| `title` | Details form | Stable Title label; anchor inside input |
| `description` | Details form | Stable Description label; anchor inside input |
| `audience_no` | Audience section | Not made for kids radio/label |
| `audience_no_selected` | After choosing audience | Selected radio and label |
| `next` | Ready wizard footer | Enabled Next button |
| `elements` | Video elements step | Unique active heading |
| `checks` | Checks step | Unique active heading |
| `checks_complete` | Checks finished without issues | Completed no-issues status |
| `visibility` | Visibility step | Unique active heading |
| `private` | Visibility options | Private radio/label |
| `private_selected` | After choosing Private | Selected radio and label |
| `save` | Ready visibility footer | Enabled Save button |
| `upload_complete` | Saved confirmation dialog | Stable successful-save heading |
| `copy_link` | Same confirmation dialog | Copy video link control |
| `show_more`, `tags` | Optional expanded details | Show more and Tags input label |

`--anchor X Y` is the click location relative to the crop's top-left. The default
is its center. Label references may use an anchor just outside the crop, inside
the associated input. `--region LEFT TOP RIGHT BOTTOM` limits matching to a
normalized screen region (values 0–1); use this when the same label occurs twice.
Never train a generic check mark, plain rectangle or duplicate wizard label.
The matcher rejects blank crops, tampered images and ambiguous matches.

```sh
.venv-gui/bin/python scripts/python/gui_references.py validate
.venv-gui/bin/python scripts/python/gui_references.py match next /absolute/path/new-screen.png \
  --logical-size 1440 900
```

Validation checks file coverage and integrity; it does **not** establish that a
reference matches today's UI. Re-test references on fresh screenshots and perform
the second live upload before considering calibration complete.

## Second video: replay through the GUI

Focus Chrome with Studio open. Use a different source file and reviewed metadata:

```sh
.venv-gui/bin/python scripts/python/youtube_gui_uploader.py \
  /absolute/path/second-video.mp4 'Reviewed title' 'Reviewed description' \
  --channel-id <your-channel-id>
```

The script verifies the channel URL, enters and checks metadata, chooses the
audience, waits for checks, selects and verifies Private, saves, waits for the
confirmation and copies the resulting video link. Optional tags are a fourth
positional string, comma-separated, and require the two extra references. Custom
thumbnails, playlists, scheduling, public uploads and child-directed uploads
are not supported by this workflow.

Do not use the desktop while the run owns it. Move the pointer to a screen corner
to trigger PyAutoGUI's fail-safe. Every wait is bounded. Missing controls or
unexpected screens stop the run instead of falling back to remembered points.

Local JSON receipts live in `video-work/gui-uploads/`, keyed by channel ID and
source SHA-256. A confirmed rerun returns the saved result without uploading
again. Failed or interrupted attempts require reviewing Studio for a draft or
saved video before manually reconciling the receipt; they never retry blindly.
GUI launches share an OS lock. Receipts record matched controls, scores, clicks,
the save attempt, errors and the confirmed URL. No success is printed before
the saved confirmation and a valid link have both been observed.

For the application pipeline, configure only after live verification:

```dotenv
YOUTUBE_UPLOAD_METHOD=gui
YOUTUBE_PYTHON=/absolute/path/to/bilibili-uploader/.venv-gui/bin/python
YOUTUBE_GUI_REFERENCES=config/gui-references/youtube
YOUTUBE_CHANNEL_ID=<your-channel-id>
```

Pipeline uploads use the existing video validation and publication records.
Direct CLI runs retain receipts but do not add records to the application DB.
Connection testing checks reference coverage and dependencies, not a live upload.

## Tests

```sh
.venv-gui/bin/python -m unittest discover -s scripts/python/tests -p 'test_gui*.py' -v
npm test
npm run build
```

Tests exercise moved/missing/duplicate controls, Retina conversion, search regions,
crop bounds, corrupt references, incomplete training, private/check gates, URL
validation and duplicate/uncertain-attempt receipts. Synthetic fixtures are kept
separate from real reference training and never establish live readiness.
