---
name: youtube-gui-upload
description: Calibrate cropped YouTube Studio controls, perform agent-assisted GUI uploads through computer-use MCP, replay uploads with visual references, and retain real completion screenshots in the bilibili-uploader app.
---

# YouTube GUI upload

Use this skill with the bilibili-uploader workspace and the agent's available
computer-use MCP. Locate `scripts/python/gui_references.py` and read
`docs/GUI_UPLOAD.md` in that workspace for commands and control definitions.
Do not imply this skill adds an MCP server or grants browser/OS permissions.

## Decide the run

Identify the source files, destination channel and privacy from the user's
request and current session. Use the application's previous publications to
suggest a destination, but verify the active Studio channel before sending a
file. If the active channel differs and the destination is unresolved, ask once.
Reuse authorization already given. Inspect the video and existing upload history
so a rehearsal doesn't duplicate previously uploaded content. Private is the
workflow's default; public publishing requires a separately supported workflow.

Distinguish two modes:

- **Assisted calibration:** the agent operates Studio with computer-use MCP and
  saves control crops as the real screens appear.
- **Replay:** the agent matches fresh screenshots against the trained controls
  and clicks through the same MCP, or runs the project's PyAutoGUI driver when
  that runtime is explicitly requested/authorized by the user and permitted by
  the host tools. Never use a forbidden runtime to work around a tool rejection.

Screenshots are still images, not continuous recording. Do not start a recorder.
Stop any continuous recorder started for this task before replay. Preserve still
capture permission when the user allows it; otherwise explain that this visual
matcher cannot run without images. Don't change unrelated recording sessions.

## Assisted calibration

1. Read the computer-use MCP documentation and inspect the actual browser state.
   Use the existing signed-in Studio tab, or open one. Handle authentication and
   challenges according to the host tool's rules. Do not store credentials in
   templates or automate a CAPTCHA.
2. Verify the channel ID in the Studio URL and visible identity. Review source
   metadata; this driver supports private videos not made for kids.
3. Use the tool's screenshot API. Save returned image bytes through supported
   local file I/O. Crop from those real bytes using `gui_references.py train`,
   preserving the relationship between screenshot pixels and logical desktop
   coordinates. Avoid cropping a scaled overview, a window-switcher thumbnail,
   or a partially animated window. Don't invent images for missing controls.
4. Capture the actual control list in `docs/GUI_UPLOAD.md` as the upload wizard
   advances. Match stable labels and enabled button appearances; include checked
   radio state for audience and privacy. Use label-relative anchors for inputs.
   Save small crops, not a recording of the entire desktop.
5. Fill and verify title/description, set the correct audience, wait for upload
   and checks, choose Private and save. Inspect the saved confirmation and link.
   Capture the real completed dialog or Studio content row, including title,
   privacy and video identity when visible. A progress bar or draft is not proof
   of completion.
6. Record the source checksum, channel ID, returned video URL, timestamp and
   screenshot path in a local receipt. If publishing through the app's pipeline,
   retain its publication record; do not mark a failed/draft upload published.

## Replay with a second video

Choose a distinct reviewed source. Validate the reference manifest; readiness
requires fresh live matches, not just file presence. In MCP mode, capture current
state, call the offline `match` command, then click the matched coordinate through
MCP. Follow its coordinate system and refresh state after actions. Never pass
whole-desktop coordinates to a window-relative surface without verified offsets.
Prefer accessibility controls when reliable in assisted mode; record which
replay actions used image matching so evidence doesn't overstate autonomy.

In explicitly authorized PyAutoGUI mode, focus Chrome and use
`youtube_gui_uploader.py` with the channel ID. It verifies inputs, checks, private
selection and completion, with bounded waits and duplicate-protected receipts.
An agent-assisted upload does not prove standalone replay. Name which ran.

Stop on an ambiguous/missing reference, wrong account, changed UI, failed checks,
login challenge, or uncertain save. Inspect Studio before retrying; reconcile an
existing draft or saved video rather than re-uploading blindly. Keep failures
and pending work visible. Don't claim calibration or upload success from mocks,
synthetic test crops or the script merely exiting.

## Evidence and delivery

After each successful upload, take one real screenshot of the final confirmation
or verified Studio content row. Save it with the run receipt. Display that image
inline using an absolute local path and give the matching YouTube link. Report
privacy and whether it was assisted or reference-driven replay. If screenshots
or channel access are unavailable, report the concrete blocker and finish any
independent code/documentation work; do not fabricate a confirmation image.

For distribution, keep this skill in `skills/youtube-gui-upload/` in the app
repository. Users can copy or symlink the folder into their agent's skill path,
then invoke `$youtube-gui-upload` with their channel and files. The MCP provider,
OS permissions, signed-in browser and locally trained references remain separate
runtime prerequisites.
