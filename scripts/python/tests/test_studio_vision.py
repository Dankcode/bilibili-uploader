"""Tests for the image-driven Studio uploader.

No real screen: a FakeStudio renders synthetic Studio "screens" (distinct
textured controls on a noisy background) and changes state when the uploader
clicks, types or scrolls. Templates are captured from it the same way
--calibrate captures them from a real display, at 2x (Retina) scale.

Run: python3 -m unittest discover -s scripts/python/tests
"""
import json
import os
import sys
import tempfile
import time as real_time
import unittest
from pathlib import Path

import cv2
import numpy as np

TMP = tempfile.mkdtemp(prefix='studio-vision-test-')
os.environ.update({
    'YOUTUBE_STUDIO_POLL_SECONDS': '0.001',
    'YOUTUBE_STUDIO_STEP_TIMEOUT_SECONDS': '1.5',
    'YOUTUBE_STUDIO_HUMAN_WAIT_SECONDS': '3',
    'YOUTUBE_STUDIO_UPLOAD_WAIT_MINUTES': '0.05',
    'YOUTUBE_STUDIO_RUN_DIR': str(Path(TMP) / 'runs'),
    'YOUTUBE_STUDIO_LOCK': str(Path(TMP) / 'studio.lock'),
    'YOUTUBE_STUDIO_TEMPLATE_DIR': str(Path(TMP) / 'templates'),
    'YOUTUBE_STUDIO_ZOOM_SCALES': '1.0',
})

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import studio_vision as sv  # noqa: E402
import youtube_studio_vision_uploader as uploader  # noqa: E402


class FastTime:
    time = staticmethod(real_time.time)

    @staticmethod
    def sleep(_seconds):
        return None


uploader.time = FastTime
uploader.webbrowser.open = lambda *_args, **_kwargs: True

LOGICAL = (800, 600)
CONTROLS = {
    # name: (x, y, w, h) in logical px
    'dashboard_ready': (20, 20, 150, 30),
    'channel_badge': (700, 20, 60, 30),
    'create_button': (560, 20, 110, 30),
    'upload_videos_item': (560, 60, 140, 30),
    'select_files_button': (330, 300, 140, 36),
    'details_title_field': (60, 120, 420, 40),
    'details_description_field': (60, 180, 420, 80),
    'not_made_for_kids_radio': (60, 300, 220, 26),
    'made_for_kids_radio': (60, 270, 220, 26),
    'show_more_button': (60, 360, 120, 28),
    'tags_field': (60, 400, 300, 30),
    'next_button': (660, 540, 90, 34),
    'visibility_step_marker': (60, 90, 160, 30),
    'private_radio': (60, 150, 140, 26),
    'unlisted_radio': (60, 190, 140, 26),
    'public_radio': (60, 230, 140, 26),
    'copy_link_button': (720, 160, 40, 30),
    'upload_complete_marker': (60, 545, 200, 26),
    'save_button': (560, 540, 90, 34),
    'publish_button': (460, 540, 90, 34),
    'finished_dialog_marker': (260, 240, 280, 40),
    'close_dialog_button': (460, 300, 90, 30),
    'signed_out_marker': (320, 260, 160, 40),
    'challenge_marker': (320, 320, 160, 40),
    'upload_limit_marker': (250, 200, 300, 40),
}


def patch_for(name, width, height):
    rng = np.random.default_rng(abs(hash(name)) % (2 ** 32))
    base = rng.integers(0, 256, size=(max(2, height // 6), max(2, width // 6), 3), dtype=np.uint8)
    patch = cv2.resize(base, (width, height), interpolation=cv2.INTER_NEAREST)
    cv2.putText(patch, name[:12], (4, max(12, height // 2)), cv2.FONT_HERSHEY_SIMPLEX, height / 60, (255, 255, 255), max(1, height // 30))
    return patch


class FakeStudio:
    """A tiny state machine standing in for the Studio web page."""

    def __init__(self, scale=2.0, start='dashboard', upload_polls=3, link='https://youtu.be/AbCdEfGhIjK'):
        self.scale = scale
        self.state = start
        self.scrolled = False
        self.tags_open = False
        self.nexts = 0
        self.polls_on_visibility = 0
        self.upload_polls = upload_polls
        self.link = link
        self.clipboard_text = ''
        self.focused = None
        self.typed = {}
        self.clicked = []
        self.human_after = None
        self.screens = 0
        background_rng = np.random.default_rng(7)
        noise = background_rng.integers(20, 60, size=(LOGICAL[1] // 10, LOGICAL[0] // 10, 3), dtype=np.uint8)
        self.background_2x = cv2.resize(noise, (LOGICAL[0] * 2, LOGICAL[1] * 2), interpolation=cv2.INTER_LINEAR)
        self.file_dialog_open = False
        self.path_pasted = False

    # -- what is on screen
    def visible(self):
        state = self.state
        if state == 'signed_out':
            return ['signed_out_marker']
        if state == 'limit':
            return ['dashboard_ready', 'create_button', 'upload_limit_marker']
        if state == 'dashboard':
            return ['dashboard_ready', 'channel_badge', 'create_button']
        if state == 'menu':
            return ['dashboard_ready', 'channel_badge', 'create_button', 'upload_videos_item']
        if state == 'dialog':
            return ['select_files_button']
        if state == 'details':
            names = ['details_title_field', 'details_description_field', 'next_button']
            if self.scrolled:
                names += ['not_made_for_kids_radio', 'made_for_kids_radio', 'show_more_button']
                if self.tags_open:
                    names.append('tags_field')
            return names
        if state == 'visibility':
            names = ['visibility_step_marker', 'private_radio', 'unlisted_radio', 'public_radio', 'copy_link_button', 'save_button', 'publish_button']
            if self.polls_on_visibility >= self.upload_polls:
                names.append('upload_complete_marker')
            return names
        if state == 'finished':
            return ['finished_dialog_marker', 'close_dialog_button']
        return []

    # -- Desktop interface
    def logical_size(self):
        return LOGICAL

    def screenshot(self):
        self.screens += 1
        if self.human_after is not None and self.state == 'signed_out' and self.screens >= self.human_after:
            self.state = 'dashboard'
        if self.state == 'visibility':
            self.polls_on_visibility += 1
        # Render the page at 2x, then let a 1x display downsample it — the way
        # the same browser window looks on a Retina panel vs an external monitor.
        image = self.background_2x.copy()
        for name in self.visible():
            x, y, w, h = CONTROLS[name]
            px, py, pw, ph = [int(round(value * 2)) for value in (x, y, w, h)]
            image[py:py + ph, px:px + pw] = patch_for(name, pw, ph)
        if self.scale == 2.0:
            return image
        size = (int(LOGICAL[0] * self.scale), int(LOGICAL[1] * self.scale))
        return cv2.resize(image, size, interpolation=cv2.INTER_AREA)

    def _hit(self, x, y):
        for name in self.visible():
            cx, cy, cw, ch = CONTROLS[name]
            if cx <= x < cx + cw and cy <= y < cy + ch:
                return name
        return None

    def click(self, x, y):
        name = self._hit(x, y)
        self.clicked.append(name)
        self.focused = name
        transitions = {
            ('dashboard', 'create_button'): 'menu',
            ('menu', 'upload_videos_item'): 'dialog',
            ('finished', 'close_dialog_button'): 'done',
        }
        if (self.state, name) in transitions:
            self.state = transitions[(self.state, name)]
        elif name == 'select_files_button':
            self.file_dialog_open = True
        elif name == 'show_more_button':
            self.tags_open = True
        elif name == 'next_button' and self.state == 'details':
            self.nexts += 1
            if self.nexts >= 3:
                self.state = 'visibility'
        elif name == 'copy_link_button':
            self.clipboard_text = self.link
        elif name in ('save_button', 'publish_button') and self.state == 'visibility':
            self.state = 'finished'

    def paste(self, text, replace=True):
        if self.file_dialog_open:
            self.path_pasted = text
            return
        self.typed[self.focused] = text

    def press(self, key):
        if key == 'enter' and self.file_dialog_open and self.path_pasted:
            self.file_dialog_open = False
            self.state = 'details'

    def hotkey(self, *keys):
        return None

    def scroll(self, x, y, clicks):
        if self.state == 'details':
            self.scrolled = True

    def clipboard(self):
        return self.clipboard_text

    def clear_clipboard(self):
        self.clipboard_text = ''


def calibrate_from(fake_factory, template_dir, skip=()):
    """Capture every template from the fake screens, like --calibrate does."""
    calibration = {'version': 1, 'templates': {}}
    template_dir = Path(template_dir)
    template_dir.mkdir(parents=True, exist_ok=True)
    fake = fake_factory()
    for name, (x, y, w, h) in CONTROLS.items():
        if name in skip:
            continue
        canvas = fake.background_2x.copy()
        s = 2.0
        px, py, pw, ph = [int(round(value * s)) for value in (x, y, w, h)]
        canvas[py:py + ph, px:px + pw] = patch_for(name, pw, ph)
        crop = canvas[py:py + ph, px:px + pw]
        cv2.imwrite(str(template_dir / f'{name}.png'), crop)
        # click 10px right of the left edge for text fields, centre otherwise
        offset = (-(w / 2) + 10, 0) if name.endswith('_field') else (0, 0)
        calibration['templates'][name] = sv.make_record(name, crop.shape, s, offset, LOGICAL)
    sv.save_calibration(template_dir, calibration)
    return calibration


def payload(**overrides):
    video = Path(TMP) / 'clip.mp4'
    video.write_bytes(b'not a real video')
    base = {'videoPath': str(video), 'title': 'Cats <3 compilation', 'description': 'Line one\nLine <two>',
            'tags': ['cats', 'funny cats', '#shorts'], 'privacyStatus': 'private', 'madeForKids': False}
    base.update(overrides)
    return sv.parse_payload(json.dumps(base))


class TextTests(unittest.TestCase):
    def test_title_description_tags_are_made_acceptable_to_studio(self):
        self.assertEqual(sv.clean_title('  a <b>  c ' + 'x' * 200)[:8], 'a b c xx')
        self.assertLessEqual(len(sv.clean_title('x' * 300)), 100)
        self.assertEqual(sv.clean_description('a <b>\r\nc'), 'a b\nc')
        self.assertEqual(sv.clean_tags('cats, funny cats,#shorts,cats'), ['cats', 'funny cats', 'shorts'])
        self.assertEqual(sv.clean_tags('one two'), ['one', 'two'])
        self.assertLessEqual(sum(len(tag) + 1 for tag in sv.clean_tags(['t' * 60] * 20)), 500)

    def test_video_links_parse_from_every_form_studio_copies(self):
        for text in ('https://youtu.be/AbCdEfGhIjK', 'https://www.youtube.com/watch?v=AbCdEfGhIjK&t=1',
                     'https://youtube.com/shorts/AbCdEfGhIjK', 'https://studio.youtube.com/video/AbCdEfGhIjK/edit'):
            self.assertEqual(sv.parse_video_link(text)['videoId'], 'AbCdEfGhIjK', text)
        self.assertIsNone(sv.parse_video_link('https://example.com/AbCdEfGhIjK'))
        self.assertIsNone(sv.parse_video_link(''))

    def test_payload_requires_a_path_and_title_and_normalises_privacy(self):
        with self.assertRaises(ValueError):
            sv.parse_payload('{"title": "x"}')
        with self.assertRaises(ValueError):
            sv.parse_payload('{"videoPath": "/x", "title": "<>"}')
        self.assertEqual(sv.parse_payload('{"videoPath": "/x", "title": "t", "privacyStatus": "weird"}')['privacyStatus'], 'private')

    def test_manifest_is_valid_and_lists_required_templates(self):
        manifest = sv.load_manifest(uploader.MANIFEST_PATH)
        required = {name for name, spec in manifest['templates'].items() if spec.get('required')}
        self.assertTrue({'create_button', 'select_files_button', 'next_button', 'save_button', 'copy_link_button'} <= required)
        status = sv.calibration_status(manifest, {'templates': {}}, Path(TMP) / 'empty')
        self.assertEqual(set(status['missingRequired']), required)


class MatchingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = Path(TMP) / 'match-templates'
        cls.calibration = calibrate_from(lambda: FakeStudio(scale=2.0), cls.dir)

    def test_templates_captured_at_2x_match_on_2x_and_1x_screens_with_logical_click_points(self):
        for scale in (2.0, 1.0):
            fake = FakeStudio(scale=scale)
            matcher = sv.TemplateMatcher(self.dir, self.calibration)
            shot = fake.screenshot()
            match = matcher.find('create_button', sv.to_gray(shot), sv.screen_scale(shot, LOGICAL))
            self.assertIsNotNone(match, f'scale {scale}')
            x, y, w, h = CONTROLS['create_button']
            self.assertLessEqual(abs(match.click_x - (x + w / 2)), 2)
            self.assertLessEqual(abs(match.click_y - (y + h / 2)), 2)

    def test_click_offset_is_applied_in_logical_pixels(self):
        fake = FakeStudio()
        fake.state = 'details'
        shot = fake.screenshot()
        matcher = sv.TemplateMatcher(self.dir, self.calibration)
        match = matcher.find('details_title_field', sv.to_gray(shot), 2.0)
        x, _, _, _ = CONTROLS['details_title_field']
        self.assertLessEqual(abs(match.click_x - (x + 10)), 2)

    def test_absent_controls_do_not_match(self):
        fake = FakeStudio()
        shot = fake.screenshot()
        matcher = sv.TemplateMatcher(self.dir, self.calibration)
        self.assertIsNone(matcher.find('save_button', sv.to_gray(shot), 2.0))
        self.assertIsNone(matcher.find('never_calibrated', sv.to_gray(shot), 2.0))

    def test_region_search_and_same_spot(self):
        fake = FakeStudio()
        gray = sv.to_gray(fake.screenshot())
        matcher = sv.TemplateMatcher(self.dir, self.calibration)
        first = matcher.find('create_button', gray, 2.0)
        again = matcher.find('create_button', gray, 2.0, region=sv.region_around(first))
        self.assertTrue(sv.same_spot(first, again))
        self.assertIsNone(matcher.find('dashboard_ready', gray, 2.0, region=sv.region_around(first)))

    def test_plan_requirements_names_missing_templates_before_touching_the_browser(self):
        partial = Path(TMP) / 'partial-templates'
        calibration = calibrate_from(lambda: FakeStudio(), partial, skip=('public_radio', 'publish_button', 'tags_field'))
        matcher = sv.TemplateMatcher(partial, calibration)
        missing, warnings = sv.plan_requirements(payload(privacyStatus='public'), matcher)
        self.assertEqual(missing, ['public_radio', 'publish_button'])
        self.assertTrue(warnings and 'Tags will be skipped' in warnings[0])


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(TMP) / f'flow-{self._testMethodName}'
        self.calibration = calibrate_from(lambda: FakeStudio(), self.dir)

    def session(self, fake):
        matcher = sv.TemplateMatcher(self.dir, self.calibration)
        return uploader.Session(fake, matcher, Path(TMP) / 'runs' / self._testMethodName)

    def test_full_private_upload_fills_every_field_and_returns_the_link(self):
        fake = FakeStudio()
        session = self.session(fake)
        link = uploader.upload(payload(), session)
        self.assertEqual(link, {'videoId': 'AbCdEfGhIjK', 'url': 'https://www.youtube.com/watch?v=AbCdEfGhIjK'})
        self.assertEqual(fake.typed['details_title_field'], 'Cats 3 compilation')
        self.assertEqual(fake.typed['details_description_field'], 'Line one\nLine two')
        self.assertEqual(fake.typed['tags_field'], 'cats,funny cats,shorts,')
        self.assertIn('not_made_for_kids_radio', fake.clicked)
        self.assertIn('private_radio', fake.clicked)
        self.assertIn('save_button', fake.clicked)
        self.assertNotIn('publish_button', fake.clicked)
        self.assertEqual(fake.state, 'done')
        self.assertTrue(session.sent)
        # Studio must finish receiving the file before SAVE is clicked.
        self.assertGreaterEqual(fake.polls_on_visibility, fake.upload_polls)

    def test_public_made_for_kids_upload_uses_the_matching_controls(self):
        fake = FakeStudio()
        uploader.upload(payload(privacyStatus='public', madeForKids=True, tags=[]), self.session(fake))
        self.assertIn('made_for_kids_radio', fake.clicked)
        self.assertIn('public_radio', fake.clicked)
        self.assertIn('publish_button', fake.clicked)
        self.assertNotIn('tags_field', fake.typed)

    def test_signed_out_browser_waits_for_a_person_then_continues(self):
        fake = FakeStudio(start='signed_out')
        fake.human_after = 6
        link = uploader.upload(payload(), self.session(fake))
        self.assertEqual(link['videoId'], 'AbCdEfGhIjK')

    def test_nobody_signing_in_fails_cleanly_as_not_sent(self):
        fake = FakeStudio(start='signed_out')
        with self.assertRaises(uploader.StudioError) as caught:
            uploader.upload(payload(), self.session(fake))
        self.assertFalse(caught.exception.sent)
        self.assertIn('signed out marker', str(caught.exception))

    def test_daily_limit_before_file_selection_is_deferrable_and_not_sent(self):
        fake = FakeStudio(start='limit')
        with self.assertRaises(uploader.StudioError) as caught:
            uploader.upload(payload(), self.session(fake))
        self.assertTrue(caught.exception.deferrable)
        self.assertFalse(caught.exception.sent)
        self.assertEqual(caught.exception.code, uploader.EXIT_STOPPED)

    def test_failure_after_the_file_is_submitted_reports_sent_with_a_screenshot(self):
        fake = FakeStudio(upload_polls=10 ** 9)
        session = self.session(fake)
        with self.assertRaises(uploader.StudioError) as caught:
            uploader.upload(payload(), session)
        self.assertTrue(caught.exception.sent)
        self.assertEqual(caught.exception.stage, 'wait_upload')
        self.assertTrue(list((Path(TMP) / 'runs' / self._testMethodName).glob('upload-not-complete.png')))

    def test_unreadable_link_still_saves_then_fails_as_sent(self):
        fake = FakeStudio(link='')
        with self.assertRaises(uploader.StudioError) as caught:
            uploader.upload(payload(), self.session(fake))
        self.assertTrue(caught.exception.sent)
        self.assertEqual(fake.state, 'done')
        self.assertIn('Receipts', str(caught.exception))

    def test_wrong_channel_is_refused_before_anything_is_clicked(self):
        fake = FakeStudio()
        original = fake.visible
        fake.visible = lambda: [name for name in original() if name != 'channel_badge']
        with self.assertRaises(uploader.StudioError) as caught:
            uploader.upload(payload(), self.session(fake))
        self.assertEqual(caught.exception.stage, 'verify_channel')
        self.assertEqual(fake.clicked, [])

    def test_missing_file_is_bad_input(self):
        with self.assertRaises(uploader.StudioError) as caught:
            uploader.upload(payload(videoPath=str(Path(TMP) / 'nope.mp4')), self.session(FakeStudio()))
        self.assertEqual(caught.exception.code, uploader.EXIT_BAD_INPUT)


class CliTests(unittest.TestCase):
    def test_uncalibrated_run_reports_a_clean_not_sent_result(self):
        import subprocess
        env = {**os.environ, 'YOUTUBE_STUDIO_TEMPLATE_DIR': str(Path(TMP) / 'never')}
        video = Path(TMP) / 'cli.mp4'
        video.write_bytes(b'x')
        completed = subprocess.run(
            [sys.executable, str(HERE / 'youtube_studio_vision_uploader.py'), '--payload', json.dumps({'videoPath': str(video), 'title': 't'})],
            capture_output=True, text=True, env=env, timeout=60, stdin=subprocess.DEVNULL,
        )
        self.assertEqual(completed.returncode, uploader.EXIT_BAD_INPUT)
        line = [entry for entry in completed.stdout.splitlines() if entry.startswith('STUDIO_RESULT ')][-1]
        result = json.loads(line[len('STUDIO_RESULT '):])
        self.assertFalse(result['ok'])
        self.assertFalse(result['sent'])
        self.assertIn('--calibrate', result['error'])


if __name__ == '__main__':
    unittest.main()
