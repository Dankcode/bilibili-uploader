"""Image-driven YouTube Studio uploader (YOUTUBE_UPLOAD_METHOD=studio).

Uploads through the YouTube Studio web page in a browser that is already
signed in, finding every control by matching cropped screenshots
(templates) and clicking with real OS input via pyautogui. No YouTube Data
API, no OAuth client, no quota.

What it deliberately does NOT do:
  * type passwords or complete Google sign-in, 2-step verification or
    CAPTCHAs. When a gate template is on screen it pauses, reports
    `needs_human`, and waits for a person to finish in the browser.
  * guess. Every click is preceded by a second match at the same spot; a
    control that is not on screen fails the run by name with a screenshot.

Modes
  --payload JSON       upload one video (used by the app)
  --calibrate          capture templates interactively in a terminal
  --check              report which templates are visible right now
  --screen-image PNG   with --check: test against a saved screenshot

Protocol (stdout, one JSON object per line, prefix-tagged):
  STUDIO_EVENT  {"type": "progress"|"needs_human"|"warning", ...}
  STUDIO_RESULT {"ok": true, "videoId": ..., "url": ...}
  STUDIO_RESULT {"ok": false, "stage": ..., "sent": bool, "error": ..., "screenshot": ...}
`sent` becomes true the moment a file path is submitted to the file dialog:
from then on Studio may hold a draft, so the app keeps its upload receipt
open for reconciliation instead of treating the failure as clean.
The final stdout line of a successful run is the watch URL.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import webbrowser
from collections import namedtuple
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import studio_vision as sv  # noqa: E402

MANIFEST_PATH = HERE / 'studio_templates.manifest.json'
TEMPLATE_DIR = Path(os.getenv('YOUTUBE_STUDIO_TEMPLATE_DIR', 'config/studio_templates/default'))
STUDIO_URL = os.getenv('YOUTUBE_STUDIO_URL', 'https://studio.youtube.com')
STEP_TIMEOUT = float(os.getenv('YOUTUBE_STUDIO_STEP_TIMEOUT_SECONDS', '45'))
HUMAN_WAIT = float(os.getenv('YOUTUBE_STUDIO_HUMAN_WAIT_SECONDS', '600'))
UPLOAD_WAIT = float(os.getenv('YOUTUBE_STUDIO_UPLOAD_WAIT_MINUTES', '60')) * 60
RUN_DIR = Path(os.getenv('YOUTUBE_STUDIO_RUN_DIR', 'video-work/studio-runs'))
LOCK_PATH = Path(os.getenv('YOUTUBE_STUDIO_LOCK', 'video-work/studio-uploader.lock'))
ZOOM_SCALES = tuple(float(value) for value in os.getenv('YOUTUBE_STUDIO_ZOOM_SCALES', '1.0,0.9,1.1').split(',') if value.strip())
POLL = float(os.getenv('YOUTUBE_STUDIO_POLL_SECONDS', '0.4'))
Point = namedtuple('Point', 'x y')

EXIT_OK, EXIT_FAILED, EXIT_BAD_INPUT, EXIT_STOPPED = 0, 1, 2, 4


def emit(tag, payload):
    print(f'{tag} {json.dumps(payload, ensure_ascii=False)}', flush=True)


def event(kind, **fields):
    emit('STUDIO_EVENT', {'type': kind, **fields})


class StudioError(Exception):
    def __init__(self, stage, message, sent=False, code=EXIT_FAILED, deferrable=False):
        super().__init__(message)
        self.stage = stage
        self.sent = sent
        self.code = code
        self.deferrable = deferrable


# --------------------------------------------------------------------------- desktop

class Desktop:
    """Screen capture + input. Imported lazily so --check on a saved
    screenshot works on a headless machine."""

    def __init__(self):
        import pyautogui
        import pyperclip
        self.pyautogui = pyautogui
        self.pyperclip = pyperclip
        pyautogui.FAILSAFE = True  # slam the mouse into a screen corner to abort
        pyautogui.PAUSE = 0.05
        self.modifier = 'command' if sys.platform == 'darwin' else 'ctrl'
        try:
            import mss
            self._mss = mss.mss()
        except Exception:  # noqa: BLE001 — pyautogui fallback is fine
            self._mss = None

    def logical_size(self):
        size = self.pyautogui.size()
        return (size.width, size.height)

    def screenshot(self):
        if self._mss is not None:
            monitor = self._mss.monitors[1]
            return np.array(self._mss.grab(monitor))[:, :, :3]
        image = self.pyautogui.screenshot()
        return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

    def click(self, x, y):
        self.pyautogui.moveTo(x, y, duration=0.25, tween=self.pyautogui.easeInOutQuad)
        self.pyautogui.click()
        time.sleep(0.35)

    def paste(self, text, replace=True):
        self.pyperclip.copy(text or '')
        if self.pyperclip.paste() != (text or ''):
            raise RuntimeError('Clipboard did not accept the requested text')
        if replace:
            self.pyautogui.hotkey(self.modifier, 'a')
            time.sleep(0.1)
        self.pyautogui.hotkey(self.modifier, 'v')
        time.sleep(0.3)

    def press(self, key):
        self.pyautogui.press(key)

    def hotkey(self, *keys):
        self.pyautogui.hotkey(*keys)

    def scroll(self, x, y, clicks):
        self.pyautogui.moveTo(x, y, duration=0.15)
        self.pyautogui.scroll(clicks)
        time.sleep(0.4)

    def clipboard(self):
        return self.pyperclip.paste() or ''

    def clear_clipboard(self):
        self.pyperclip.copy('')

    def read_field(self):
        self.clear_clipboard()
        self.pyautogui.hotkey(self.modifier, 'a')
        self.pyautogui.hotkey(self.modifier, 'c')
        time.sleep(0.2)
        return self.clipboard().replace('\r\n', '\n')


class Session:
    def __init__(self, desktop, matcher, run_dir):
        self.desktop = desktop
        self.matcher = matcher
        self.run_dir = run_dir
        self.sent = False
        self.stage = 'start'
        self._shot = None
        self._scale = 1.0

    # ---- screen

    def grab(self):
        image = self.desktop.screenshot()
        self._shot = image
        self._scale = sv.screen_scale(image, self.desktop.logical_size())
        return sv.to_gray(image), self._scale

    def find(self, name, region=None):
        gray, scale = self.grab()
        return self.matcher.find(name, gray, scale, region=region)

    def save_screenshot(self, label):
        if self._shot is None:
            try:
                self.grab()
            except Exception:  # noqa: BLE001
                return ''
        self.run_dir.mkdir(parents=True, exist_ok=True)
        path = self.run_dir / f'{label}.png'
        cv2.imwrite(str(path), self._shot)
        return str(path)

    def fail(self, message, code=EXIT_FAILED, deferrable=False):
        raise StudioError(self.stage, message, sent=self.sent, code=code, deferrable=deferrable)

    # ---- gates

    def check_gates(self, gray, scale):
        for gate in ('signed_out_marker', 'challenge_marker'):
            if self.matcher.find(gate, gray, scale):
                return gate
        if not self.sent and self.matcher.find('upload_limit_marker', gray, scale):
            self.fail('YouTube Studio reports the daily upload limit is reached', code=EXIT_STOPPED, deferrable=True)
        return None

    def wait_for_human(self, gate, target):
        self.save_screenshot(f'needs-human-{self.stage}')
        event('needs_human', stage=self.stage, gate=gate,
              message='Finish signing in or verifying in the browser window. The upload continues by itself afterwards.')
        deadline = time.time() + HUMAN_WAIT
        while time.time() < deadline:
            time.sleep(min(2.0, POLL * 5))
            gray, scale = self.grab()
            if self.check_gates(gray, scale):
                continue
            match = self.matcher.find(target, gray, scale) if target else None
            if match or not target:
                event('progress', stage=self.stage, note='Resumed after sign-in')
                return match
        self.fail(f'Nobody completed {gate.replace("_", " ")} within {int(HUMAN_WAIT)} s')

    def wait_for(self, name, timeout=STEP_TIMEOUT, required=True):
        deadline = time.time() + timeout
        while True:
            gray, scale = self.grab()
            gate = self.check_gates(gray, scale)
            if gate:
                match = self.wait_for_human(gate, name)
                if match:
                    return match
                deadline = time.time() + timeout
                continue
            match = self.matcher.find(name, gray, scale)
            if match:
                return match
            if time.time() >= deadline:
                if not required:
                    return None
                shot = self.save_screenshot(f'missing-{name}')
                self.fail(f'"{name}" was not found on screen within {int(timeout)} s (screenshot: {shot})')
            time.sleep(POLL)

    def wait_for_any(self, names, timeout=STEP_TIMEOUT):
        """First of several templates to appear. Studio words the same moment
        differently depending on the path taken (SAVE vs PUBLISH), and a run
        must not fail because it was watching for the other wording."""
        candidates = [name for name in names if self.matcher.has(name)]
        if not candidates:
            self.fail(f'None of these templates are calibrated: {", ".join(names)}')
        deadline = time.time() + timeout
        while True:
            gray, scale = self.grab()
            gate = self.check_gates(gray, scale)
            if gate:
                self.wait_for_human(gate, None)
                deadline = time.time() + timeout
                continue
            for name in candidates:
                if name == 'finished_content_marker' and self.matcher.find('visibility_step_marker', gray, scale):
                    continue  # The list can also be visible behind the upload modal.
                match = self.matcher.find(name, gray, scale)
                if match:
                    return match
            if time.time() >= deadline:
                shot = self.save_screenshot(f'missing-{candidates[0]}')
                self.fail(f'None of {", ".join(candidates)} appeared within {int(timeout)} s (screenshot: {shot})')
            time.sleep(POLL)

    def click(self, name, timeout=STEP_TIMEOUT):
        match = self.wait_for(name, timeout)
        # Image analogue of an elementFromPoint check: the control must still
        # be at the same place a moment later, i.e. not mid-animation.
        time.sleep(0.15)
        again = self.find(name, region=sv.region_around(match))
        if not sv.same_spot(match, again):
            time.sleep(0.6)
            match = self.wait_for(name, timeout)
            again = self.find(name, region=sv.region_around(match))
            if not sv.same_spot(match, again):
                shot = self.save_screenshot(f'moving-{name}')
                self.fail(f'"{name}" kept moving; refusing to click blind (screenshot: {shot})')
        self.desktop.click(match.click_x, match.click_y)
        return match

    def find_with_scroll(self, name, anchor, attempts=6):
        match = self.find(name)
        tries = 0
        while not match and tries < attempts:
            self.desktop.scroll(anchor[0], anchor[1], -5)
            match = self.find(name)
            tries += 1
        return match


# --------------------------------------------------------------------------- upload flow

def choose_file(desktop, video_path):
    time.sleep(1.5)
    if sys.platform == 'darwin':
        desktop.hotkey('command', 'shift', 'g')
        time.sleep(0.8)
        desktop.paste(video_path, replace=False)
        desktop.press('enter')
        time.sleep(0.8)
        desktop.press('enter')
    elif sys.platform.startswith('win'):
        desktop.paste(video_path, replace=False)
        desktop.press('enter')
    else:
        desktop.hotkey('ctrl', 'l')
        time.sleep(0.3)
        desktop.paste(video_path, replace=False)
        desktop.press('enter')


def fill_verified(session, name, text):
    session.click(name)
    for _ in range(2):
        session.desktop.paste(text)
        if session.desktop.read_field() == text.replace('\r\n', '\n'):
            return
    shot = session.save_screenshot(f'unverified-{name}')
    session.fail(f'The browser field {name} does not match the requested metadata (screenshot: {shot})')


def verify_saved_content(session, payload):
    screenshot = session.save_screenshot('saved-content')
    try:
        result = subprocess.run(
            ['swift', '-module-cache-path', str(Path(tempfile.gettempdir()) / 'bilibili-studio-swift-cache'),
             str(HERE / 'studio_ocr.swift'), screenshot],
            capture_output=True, text=True, check=True, timeout=60,
        )
        verified = sv.verified_content_row(json.loads(result.stdout), payload['title'], payload['privacyStatus'])
    except (OSError, subprocess.SubprocessError, ValueError):
        verified = False
    if not verified:
        session.fail(f'Studio returned to the content list, but the exact saved row could not be verified. '
                     f'Reconcile this upload before retrying (screenshot: {screenshot})')


def upload(payload, session):
    desktop, matcher = session.desktop, session.matcher
    video_path = str(Path(payload['videoPath']).expanduser().resolve())
    if not Path(video_path).is_file():
        raise StudioError('input', f'Upload file not found: {video_path}', code=EXIT_BAD_INPUT)

    missing, warnings = sv.plan_requirements(payload, matcher)
    if missing:
        raise StudioError('input', f'Calibrate these templates first: {", ".join(missing)}', code=EXIT_BAD_INPUT)
    if payload.get('verifyCompletion') and matcher.has('finished_content_marker') and not matcher.has('finished_dialog_marker'):
        if sys.platform != 'darwin' or not shutil.which('swift'):
            raise StudioError('input', 'Content-list confirmation requires macOS Swift/Vision. '
                              'Otherwise calibrate finished_dialog_marker.', code=EXIT_BAD_INPUT)
    for warning in warnings:
        event('warning', message=warning)

    session.stage = 'open_studio'
    event('progress', stage=session.stage, percent=5, note='Opening YouTube Studio')
    if not session.find('dashboard_ready'):
        webbrowser.open(STUDIO_URL)
    session.wait_for('dashboard_ready', timeout=max(STEP_TIMEOUT, 60))

    if matcher.has('channel_badge'):
        session.stage = 'verify_channel'
        if not session.wait_for('channel_badge', timeout=10, required=False):
            shot = session.save_screenshot('wrong-channel')
            session.fail(f'The browser is not signed into the calibrated channel (screenshot: {shot})')

    session.stage = 'open_upload_dialog'
    event('progress', stage=session.stage, percent=10, note='Opening the upload dialog')
    session.click('create_button')
    session.click('upload_videos_item')
    session.click('select_files_button')

    session.stage = 'choose_file'
    event('progress', stage=session.stage, percent=15, note='Selecting the file')
    session.sent = True
    choose_file(desktop, video_path)
    if not session.wait_for('details_title_field', timeout=max(STEP_TIMEOUT, 90), required=False):
        # A surviving file-picker control does not prove the transfer never
        # started. Preserve uncertainty so the release layer blocks duplicates.
        shot = session.save_screenshot('file-not-accepted')
        session.fail(f'Studio did not accept the file (screenshot: {shot})')

    session.stage = 'details'
    event('progress', stage=session.stage, percent=25, note='Filling title and description')
    title_match = session.wait_for('details_title_field')
    fill_verified(session, 'details_title_field', payload['title'])
    fill_verified(session, 'details_description_field', payload['description'])

    anchor = (title_match.click_x, title_match.click_y + 120)
    audience = 'made_for_kids_radio' if payload['madeForKids'] else 'not_made_for_kids_radio'
    if not session.find_with_scroll(audience, anchor):
        shot = session.save_screenshot(f'missing-{audience}')
        session.fail(f'"{audience}" was not found after scrolling the Details step (screenshot: {shot})')
    session.click(audience)

    if payload['tags'] and matcher.has('show_more_button') and matcher.has('tags_field'):
        if session.find_with_scroll('show_more_button', anchor, attempts=4):
            session.click('show_more_button')
            if session.find_with_scroll('tags_field', anchor, attempts=4):
                session.click('tags_field')
                desktop.paste(','.join(payload['tags']) + ',', replace=False)
            else:
                session.fail('tags_field not found; refusing to save without requested tags')
        else:
            session.fail('show_more_button not found; refusing to save without requested tags')

    session.stage = 'advance'
    event('progress', stage=session.stage, percent=40, note='Moving to Visibility')
    # The direct step tab skips optional elements/checks without waiting for processing.
    if matcher.has('visibility_tab_button') and session.find('visibility_tab_button'):
        session.click('visibility_tab_button')
        session.wait_for('visibility_step_marker', timeout=3, required=False)
    for _ in range(5):
        if session.find('visibility_step_marker'):
            break
        session.click('next_button')
        time.sleep(1.2)
    session.wait_for('visibility_step_marker')

    session.stage = 'visibility'
    session.click(sv.PRIVACY_TEMPLATES[payload['privacyStatus']])

    session.stage = 'read_link'
    desktop.clear_clipboard()
    session.click('copy_link_button')
    time.sleep(0.4)
    link = sv.parse_video_link(desktop.clipboard())
    if not link:
        event('warning', message='Could not read the video link from the clipboard; continuing to save')

    if payload.get('verifyCompletion'):
        session.stage = 'wait_upload'
        event('progress', stage=session.stage, percent=55, note='Waiting for Studio to finish receiving the file')
        started = time.time()
        while True:
            gray, scale = session.grab()
            if matcher.find('upload_complete_marker', gray, scale):
                break
            if time.time() - started > UPLOAD_WAIT:
                shot = session.save_screenshot('upload-not-complete')
                waited = f'{UPLOAD_WAIT / 60:.0f} min' if UPLOAD_WAIT >= 60 else f'{UPLOAD_WAIT:.0f} s'
                session.fail(f'Upload did not complete within {waited} (screenshot: {shot})')
            elapsed = time.time() - started
            event('progress', stage=session.stage, percent=min(85, 55 + int(elapsed / max(1, UPLOAD_WAIT) * 30)),
                  note=f'Uploading… {int(elapsed)} s')
            time.sleep(5)

    session.stage = 'save'
    event('progress', stage=session.stage, percent=90, note='Saving')
    wants_publish = payload['privacyStatus'] != 'private' and matcher.has('publish_button')
    session.click('publish_button' if wants_publish else 'save_button')
    completed = session.wait_for_any(
        (['published_dialog_marker', 'finished_dialog_marker'] if wants_publish else ['finished_dialog_marker', 'published_dialog_marker'])
        + ['finished_content_marker'],
        timeout=max(STEP_TIMEOUT, 60),
    )
    if payload.get('verifyCompletion') and completed.name == 'finished_content_marker':
        verify_saved_content(session, payload)
    # Persist the observed confirmation before closing it. Still image only:
    # there is no screen recorder or continuously retained screenshot stream.
    confirmation = session.save_screenshot('upload-confirmed')
    event('progress', stage='confirmation', percent=95, screenshot=confirmation,
          note='Studio accepted the save; background processing may continue')
    if completed.name != 'finished_content_marker' and matcher.has('close_dialog_button'):
        session.click('close_dialog_button', timeout=10)

    if not link:
        session.stage = 'read_link'
        shot = session.save_screenshot('saved-without-link')
        session.fail(f'The video was saved but its link could not be read. Paste it in Publish ▸ Receipts (screenshot: {shot})')
    event('progress', stage='done', percent=100, note='Saved in Studio')
    return {**link, 'screenshot': confirmation, 'deliveryStatus': 'published' if payload.get('verifyCompletion') else 'submitted'}


# --------------------------------------------------------------------------- lock

def acquire_lock():
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            descriptor = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(descriptor, str(os.getpid()).encode())
            os.close(descriptor)
            return
        except FileExistsError:
            try:
                owner = int(LOCK_PATH.read_text().strip() or '0')
                os.kill(owner, 0)
            except (ValueError, ProcessLookupError):
                LOCK_PATH.unlink(missing_ok=True)
                continue
            except PermissionError:
                raise StudioError('lock', 'Another user owns the Studio desktop lock', code=EXIT_BAD_INPUT)
            except OSError as error:
                raise StudioError('lock', f'Cannot verify the Studio desktop lock: {error}', code=EXIT_BAD_INPUT)
            raise StudioError('lock', f'Another Studio upload (pid {owner}) is using the screen', code=EXIT_BAD_INPUT)
    raise StudioError('lock', 'Could not acquire the Studio uploader lock', code=EXIT_BAD_INPUT)


def release_lock():
    try:
        if LOCK_PATH.read_text().strip() == str(os.getpid()):
            LOCK_PATH.unlink()
    except OSError:
        pass


# --------------------------------------------------------------------------- calibrate / check

def calibrate(only=None, confidence=sv.DEFAULT_CONFIDENCE):
    desktop = Desktop()
    manifest = sv.load_manifest(MANIFEST_PATH)
    calibration = sv.load_calibration(TEMPLATE_DIR)
    names = only or list(manifest['templates'].keys())
    print(f'Calibrating into {TEMPLATE_DIR.resolve()}')
    print('For each control: make it visible in the browser, then follow the prompts. Type s + Enter to skip.\n')
    for name in names:
        spec = manifest['templates'].get(name)
        if not spec:
            print(f'Unknown template {name}; skipping')
            continue
        print(f'[{name}] {"REQUIRED" if spec.get("required") else "optional"} — {spec["hint"]}')
        if input('  Move the mouse to the TOP-LEFT of the area, then Enter: ').strip().lower() == 's':
            continue
        top_left = desktop.pyautogui.position()
        input('  Move the mouse to the BOTTOM-RIGHT of the area, then Enter: ')
        bottom_right = desktop.pyautogui.position()
        if spec['role'] == 'click':
            input('  Move the mouse to the exact point to CLICK, then Enter: ')
            click_point = desktop.pyautogui.position()
        else:
            click_point = Point((top_left.x + bottom_right.x) / 2, (top_left.y + bottom_right.y) / 2)
        # Move the pointer off the control so hover styling is not captured.
        desktop.pyautogui.moveTo(5, desktop.logical_size()[1] - 5, duration=0.1)
        time.sleep(0.4)
        shot = desktop.screenshot()
        scale = sv.screen_scale(shot, desktop.logical_size())
        left, top = int(min(top_left.x, bottom_right.x) * scale), int(min(top_left.y, bottom_right.y) * scale)
        right, bottom = int(max(top_left.x, bottom_right.x) * scale), int(max(top_left.y, bottom_right.y) * scale)
        if right - left < 12 or bottom - top < 12:
            print('  Area too small; skipped. Capture at least a whole button with its label.')
            continue
        crop = shot[top:bottom, left:right]
        center = ((left + right) / 2 / scale, (top + bottom) / 2 / scale)
        offset = (click_point.x - center[0], click_point.y - center[1])
        TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(TEMPLATE_DIR / f'{name}.png'), crop)
        calibration['templates'][name] = sv.make_record(name, crop.shape, scale, offset, desktop.logical_size(), confidence)
        matcher = sv.TemplateMatcher(TEMPLATE_DIR, calibration, extra_scales=(1.0,))
        rival = matcher.uniqueness(name, sv.to_gray(shot), scale, (left, top, right - left, bottom - top))
        sv.save_calibration(TEMPLATE_DIR, calibration)
        note = f'  WARNING: something else on screen looks {rival:.2f} similar — capture a larger, more distinctive area.' if rival >= confidence - 0.03 else ''
        print(f'  Saved {name}.png ({right - left}×{bottom - top}px at {scale:.2f}x).{note}\n')
    status = sv.calibration_status(manifest, calibration, TEMPLATE_DIR)
    print(json.dumps(status, indent=2))


def check(screen_image=None, logical_width=None):
    manifest = sv.load_manifest(MANIFEST_PATH)
    calibration = sv.load_calibration(TEMPLATE_DIR)
    matcher = sv.TemplateMatcher(TEMPLATE_DIR, calibration, extra_scales=ZOOM_SCALES)
    if screen_image:
        image = cv2.imread(screen_image, cv2.IMREAD_COLOR)
        if image is None:
            raise SystemExit(f'Cannot read {screen_image}')
        logical = (logical_width or image.shape[1], 0)
    else:
        desktop = Desktop()
        image = desktop.screenshot()
        logical = desktop.logical_size()
    gray, scale = sv.to_gray(image), sv.screen_scale(image, logical)
    report = {'scale': scale, 'status': sv.calibration_status(manifest, calibration, TEMPLATE_DIR), 'visible': {}}
    for name in manifest['templates']:
        if not matcher.has(name):
            continue
        match = matcher.find(name, gray, scale, confidence=0.0)
        threshold = matcher.record(name).get('confidence', sv.DEFAULT_CONFIDENCE)
        report['visible'][name] = {
            'score': round(match.score, 3) if match else None,
            'visible': bool(match and match.score >= threshold),
            'click': [match.click_x, match.click_y] if match else None,
        }
    print(json.dumps(report, indent=2))


# --------------------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description='Image-driven YouTube Studio uploader.')
    parser.add_argument('--payload', help='JSON: videoPath, title, description, tags, privacyStatus, madeForKids')
    parser.add_argument('--calibrate', action='store_true')
    parser.add_argument('--only', nargs='*', help='With --calibrate: template names to (re)capture')
    parser.add_argument('--confidence', type=float, default=sv.DEFAULT_CONFIDENCE)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--screen-image')
    parser.add_argument('--logical-width', type=int)
    parser.add_argument('--capture-from', help='Train one crop from a saved MCP screenshot, without desktop access')
    parser.add_argument('--template', help='Manifest template name for --capture-from')
    parser.add_argument('--box', type=int, nargs=4, metavar=('X', 'Y', 'W', 'H'), help='Physical screenshot pixels')
    parser.add_argument('--logical-size', type=int, nargs=2, metavar=('W', 'H'))
    parser.add_argument('--click', type=int, nargs=2, metavar=('X', 'Y'), help='Physical screenshot click point; defaults to crop center')
    args = parser.parse_args()

    if args.capture_from:
        if not args.template or not args.box or not args.logical_size:
            parser.error('--capture-from requires --template, --box and --logical-size')
        record = sv.capture_from_image(TEMPLATE_DIR, sv.load_manifest(MANIFEST_PATH),
            args.template, cv2.imread(args.capture_from, cv2.IMREAD_COLOR),
            args.box, args.logical_size, args.click, args.confidence)
        print(json.dumps({'template': args.template, 'record': record}))
        return EXIT_OK

    if args.calibrate:
        calibrate(args.only, args.confidence)
        return EXIT_OK
    if args.check:
        check(args.screen_image, args.logical_width)
        return EXIT_OK
    if not args.payload:
        parser.error('--payload, --calibrate or --check is required')

    run_dir = RUN_DIR / datetime.now().strftime('%Y%m%d-%H%M%S')
    session = None
    try:
        payload = sv.parse_payload(args.payload)
        manifest = sv.load_manifest(MANIFEST_PATH)
        calibration = sv.load_calibration(TEMPLATE_DIR)
        status = sv.calibration_status(manifest, calibration, TEMPLATE_DIR)
        if status['missingRequired']:
            raise StudioError('input', 'Studio templates not calibrated: ' + ', '.join(status['missingRequired'])
                              + '. Run: python3 scripts/python/youtube_studio_vision_uploader.py --calibrate', code=EXIT_BAD_INPUT)
        acquire_lock()
        try:
            matcher = sv.TemplateMatcher(TEMPLATE_DIR, calibration, extra_scales=ZOOM_SCALES)
            session = Session(Desktop(), matcher, run_dir)
            link = upload(payload, session)
        finally:
            release_lock()
        emit('STUDIO_RESULT', {'ok': True, **link})
        print(link['url'], flush=True)
        return EXIT_OK
    except StudioError as error:
        emit('STUDIO_RESULT', {
            'ok': False, 'stage': error.stage, 'sent': error.sent, 'deferrable': error.deferrable,
            'error': str(error), 'runDir': str(run_dir),
        })
        return error.code
    except ValueError as error:
        emit('STUDIO_RESULT', {'ok': False, 'stage': 'input', 'sent': False, 'error': str(error)})
        return EXIT_BAD_INPUT
    except Exception as error:  # noqa: BLE001 — includes pyautogui.FailSafeException
        sent = bool(session and session.sent)
        emit('STUDIO_RESULT', {
            'ok': False, 'stage': getattr(session, 'stage', 'start'), 'sent': sent,
            'error': f'{type(error).__name__}: {error}', 'runDir': str(run_dir),
        })
        return EXIT_FAILED


if __name__ == '__main__':
    sys.exit(main())
