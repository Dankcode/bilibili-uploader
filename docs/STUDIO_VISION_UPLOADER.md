# Studio screen uploader (`uploadMethod: studio`)

A third way for a job to reach YouTube, next to the Data API (`api`) and the
older guided uploader (`pygui`). It drives the **YouTube Studio web page** in a
browser that is already signed in to the channel. PyAutoGUI moves the real
cursor, and every control is found by matching **cropped screenshots
(templates)** you capture once on the upload machine. There is no API call, no
OAuth client and no quota.

> **Risk.** YouTube's Terms of Service restrict automated access to the service.
> If this is detected, the channel is what's at risk, not the run. Use a
> throwaway channel for calibration, keep uploads Private until you trust a
> profile, and prefer the API method whenever quota allows.

## What it will not do

- **Type passwords or get past Google sign-in, 2-step verification or CAPTCHAs.**
  When `signed_out_marker` or `challenge_marker` shows up, the run pauses, the
  job's progress note reads *"Needs you: finish signing in…"*, and the upload
  carries on once you finish in the browser. If nobody does so within
  `YOUTUBE_STUDIO_HUMAN_WAIT_SECONDS`, the run fails cleanly without uploading
  anything.
- **Click blind.** Before each click, the control is matched a second time at
  the same spot. A control that is missing or still moving fails the run by
  name and saves a screenshot to `video-work/studio-runs/<run>/`.
- **Pick a channel.** It publishes to whichever channel the browser is signed
  in to. Capture `channel_badge` so a run refuses to start in the wrong
  account.

## How a run works

| # | Stage | Templates | Notes |
|---|---|---|---|
| 1 | open_studio | `dashboard_ready` (+ gates) | Opens `YOUTUBE_STUDIO_URL` if Studio isn't already on screen |
| 2 | verify_channel | `channel_badge` (optional) | Refuses the wrong account before any click |
| 3 | open_upload_dialog | `create_button` → `upload_videos_item` → `select_files_button` | `upload_limit_marker` here defers the job (+6 h) |
| 4 | choose_file | — | macOS ⌘⇧G · Linux Ctrl+L · Windows paste into the file box. **`sent` becomes true here** |
| 5 | details | `details_title_field`, `details_description_field`, `(not_)made_for_kids_radio`, `show_more_button` → `tags_field` | Pastes through the clipboard. Scrolls to find the audience radio. Tags are skipped with a warning if their templates aren't captured |
| 6 | advance | `next_button` ×N until `visibility_step_marker` | |
| 7 | visibility | `private_radio` / `unlisted_radio` / `public_radio` | |
| 8 | read_link | `copy_link_button` | Reads the watch URL from the clipboard |
| 9 | wait_upload | `upload_complete_marker` | Never saves or closes before the file has finished uploading |
| 10 | save | `save_button` or `publish_button` → `finished_dialog_marker` / `published_dialog_marker` → `close_dialog_button` | Studio words the confirmation differently after SAVE and after PUBLISH; either is accepted |

Title and description are cleaned the way Studio requires: no `<` or `>`,
title at most 100 characters, description at most 5,000, and tags at most
500 characters in total.

## How it fits the release layer

- Every Studio upload still gets an **upload receipt**. It reserves 0 units,
  and the Publish page's budget meter is not touched.
- `sent: false` (a sign-in timeout, a missing template, the daily limit before a
  file was chosen) closes the receipt as *Refused*, so a retry starts fresh.
- `sent: true` failures (after the file was chosen) leave the receipt
  *Unconfirmed*. Studio may now hold a draft, and there is no API credential to
  check with, so the retry is blocked until you confirm the upload in
  **Publish ▸ Receipts**: paste the URL, or mark it as never arrived.
- Studio's daily upload limit **defers** the job instead of failing it.
- The method is pinned onto `options.youtube.uploadMethod` when the job is
  queued. Changing `YOUTUBE_UPLOAD_METHOD` later only affects new jobs.

## Setup on the upload machine

1. `pip install -r requirements.txt` (adds `opencv-python`, `numpy`, `mss`).
2. **macOS permissions:** System Settings ▸ Privacy & Security ▸
   **Accessibility** *and* **Screen Recording** for the terminal or app that
   runs the worker. Without Screen Recording, screenshots come back blank and
   nothing matches.
3. Open Chrome with a dedicated profile, sign in to the channel, and open
   `https://studio.youtube.com`. Keep the browser zoom at 100 % and the window
   size and theme you will upload with.
4. Capture templates:
   ```sh
   python3 scripts/python/youtube_studio_vision_uploader.py --calibrate
   # re-capture a few after Studio changes:
   python3 scripts/python/youtube_studio_vision_uploader.py --calibrate --only next_button save_button
   ```
   For each control, bring it on screen, then point at its top-left and
   bottom-right corners (and at the click point, for buttons). Include the
   label text: a bare icon or a plain white box matches too many places. The
   tool warns when a capture is not unique on screen.
5. Check: `python3 scripts/python/youtube_studio_vision_uploader.py --check`
   prints every template's match score for the current screen.
6. **Publish** page ▸ *Studio screen uploader* card shows **Calibrated**.
7. In **Create New Automations**, set *Upload method* to *YouTube Studio
   screen automation* and queue one short Private video first.

Templates depend on the screen, theme, zoom and language. Retina vs 1×
displays are handled, because the capture scale is recorded. A different
language, dark/light theme or browser zoom needs its own template set: point
`YOUTUBE_STUDIO_TEMPLATE_DIR` at another folder.

## Tested on 2026-09-21 against a mock Studio

The uploader was run unmodified against a stand-in Studio page in Chromium on
a Linux X display, driving the real `pyautogui` — real cursor moves, real
clicks, real clipboard, real screenshots — with templates captured from that
screen. This exercises the machinery (matching, scaling, click offsets, the
file-path typing, clipboard read, gates, failure states); it does **not**
prove anything about YouTube's real layout.

| Scenario | Result |
|---|---|
| Private upload, tags, not-made-for-kids | Passed in ~23 s. Title, description, tags, audience, visibility and file path all landed correctly; link read from the clipboard |
| Public + made for kids | Passed; used PUBLISH and the made-for-kids radio |
| Signed out for 12 s at the start | Paused, reported `needs_human`, saved a screenshot, resumed by itself and finished |
| Upload never completes | Failed at `wait_upload` with `sent: true` and a screenshot — the state an operator resolves in Publish ▸ Receipts |
| Title/description with `<>` | Stripped before typing, as Studio requires |

Two problems the run exposed, both now fixed:

1. **One confirmation template was not enough.** A Public upload ends on
   "Video published", not "Video saved as private", so the run failed after
   the video was already published. There is now an optional
   `published_dialog_marker`, either wording is accepted, and calibration
   warns when publishing without it.
2. **A timeout under a minute printed "within 0 min".** It now reports seconds.

Match cost measured on a 1280×900 screen: ~26 ms per template, ~0.6 s for all
24. A Retina screenshot is ~4× the pixels, so budget ~0.1 s per template
there; each poll matches the gates plus the control it is waiting for.

## Operating rules

- **Don't touch the mouse or keyboard during a run.** Move the pointer into a
  screen corner to abort (PyAutoGUI fail-safe); the job fails as *sent* if a
  file was already chosen.
- Only one Studio upload uses the screen at a time. The worker already runs
  one job at a time, and the helper also holds `video-work/studio-uploader.lock`.
- Re-run `--check` weekly, or after any Studio redesign, so layout drift shows
  up before a batch does.

## Files

- `scripts/python/youtube_studio_vision_uploader.py`: runtime, `--calibrate`, `--check`
- `scripts/python/studio_vision.py`: matching, scaling, text cleaning, payload
- `scripts/python/studio_templates.manifest.json`: template list, roles, hints
- `scripts/python/tests/test_studio_vision.py`: 21 simulated-Studio tests (run by `npm test` when OpenCV is installed)
- `src/lib/youtube/uploadMethod.js`: method registry and calibration status
- `src/lib/video/uploader.js`: `uploadWithStudio` and the result protocol
