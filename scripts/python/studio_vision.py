"""Pure logic for the image-driven YouTube Studio uploader.

Nothing in this module touches the mouse, keyboard, clipboard or a real
screen, so all of it is unit-tested against synthetic screenshots
(scripts/python/tests/test_studio_vision.py). The runtime that drives the
desktop lives in youtube_studio_vision_uploader.py.

Coordinate systems — the one trap in this design:
  * physical px — what a screenshot contains. On a Retina/HiDPI display this
    is 2x (or 1.5x, ...) the logical size.
  * logical px  — what pyautogui.moveTo()/click() take.
  scale = screenshot width / logical screen width.
Templates are cropped from physical screenshots and remember the scale they
were captured at, so a template captured on a Retina panel still matches when
the same browser is dragged to a 1x external monitor.
"""
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

DEFAULT_CONFIDENCE = 0.88
TITLE_MAX = 100
DESCRIPTION_MAX = 5000
TAGS_MAX_CHARS = 500
CALIBRATION_FILE = 'calibration.json'


# --------------------------------------------------------------------------- manifest

def load_manifest(path):
    with open(path, 'r', encoding='utf-8') as handle:
        manifest = json.load(handle)
    templates = manifest.get('templates')
    if not isinstance(templates, dict) or not templates:
        raise ValueError('Template manifest has no templates')
    for name, spec in templates.items():
        if not re.fullmatch(r'[a-z][a-z0-9_]{1,63}', name):
            raise ValueError(f'Invalid template name: {name}')
        if spec.get('role') not in ('click', 'marker', 'gate', 'stop'):
            raise ValueError(f'Template {name} has an unknown role')
    return manifest


def load_calibration(template_dir):
    path = Path(template_dir) / CALIBRATION_FILE
    if not path.exists():
        return {'version': 1, 'templates': {}}
    with open(path, 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    data.setdefault('templates', {})
    return data


def save_calibration(template_dir, calibration):
    directory = Path(template_dir)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / CALIBRATION_FILE
    temporary = path.with_suffix('.json.tmp')
    with open(temporary, 'w', encoding='utf-8') as handle:
        json.dump(calibration, handle, indent=2, sort_keys=True)
    temporary.replace(path)


def calibration_status(manifest, calibration, template_dir):
    """Which templates are usable, which required ones are missing."""
    directory = Path(template_dir)
    ready, missing_required, missing_optional = [], [], []
    for name, spec in manifest['templates'].items():
        record = calibration.get('templates', {}).get(name)
        present = bool(record) and (directory / record.get('file', f'{name}.png')).exists()
        if present:
            ready.append(name)
        elif spec.get('required'):
            missing_required.append(name)
        else:
            missing_optional.append(name)
    return {'ready': ready, 'missingRequired': missing_required, 'missingOptional': missing_optional}


def make_record(name, crop_shape, capture_scale, click_offset, screen_logical_size, confidence=DEFAULT_CONFIDENCE):
    height, width = crop_shape[:2]
    return {
        'file': f'{name}.png',
        'widthPx': int(width),
        'heightPx': int(height),
        'captureScale': float(capture_scale),
        'clickOffset': [int(round(click_offset[0])), int(round(click_offset[1]))],
        'confidence': float(confidence),
        'screenLogical': [int(screen_logical_size[0]), int(screen_logical_size[1])],
        'capturedAt': datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------- matching

@dataclass
class Match:
    name: str
    score: float
    # physical-pixel box of the match in the screenshot
    left: int
    top: int
    width: int
    height: int
    # logical point pyautogui should click (box centre + calibrated offset)
    click_x: int
    click_y: int
    scale: float = 1.0
    extra: dict = field(default_factory=dict)

    def center_logical(self):
        return ((self.left + self.width / 2) / self.scale, (self.top + self.height / 2) / self.scale)


def to_gray(image):
    if image is None:
        raise ValueError('No image')
    if image.ndim == 2:
        return image
    if image.shape[2] == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def screen_scale(screenshot, logical_size):
    logical_width = max(1, int(logical_size[0]))
    return screenshot.shape[1] / logical_width


class TemplateMatcher:
    """Finds calibrated templates in a screenshot.

    `extra_scales` tolerates small browser-zoom differences (e.g. 90 %/110 %)
    at the cost of a few more matchTemplate passes; the first scale that hits
    is remembered per template so later polls cost one pass.
    """

    def __init__(self, template_dir, calibration, extra_scales=(1.0,)):
        self.template_dir = Path(template_dir)
        self.calibration = calibration
        self.extra_scales = tuple(extra_scales) or (1.0,)
        self._raw = {}
        self._resized = {}
        self._preferred_scale = {}

    def has(self, name):
        record = self.calibration.get('templates', {}).get(name)
        return bool(record) and (self.template_dir / record.get('file', f'{name}.png')).exists()

    def record(self, name):
        return self.calibration.get('templates', {}).get(name) or {}

    def _template(self, name, factor):
        key = (name, round(factor, 4))
        if key in self._resized:
            return self._resized[key]
        if name not in self._raw:
            path = self.template_dir / self.record(name).get('file', f'{name}.png')
            image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
            if image is None:
                raise FileNotFoundError(f'Template image missing: {path}')
            self._raw[name] = to_gray(image)
        raw = self._raw[name]
        if abs(factor - 1.0) < 1e-3:
            resized = raw
        else:
            width = max(4, int(round(raw.shape[1] * factor)))
            height = max(4, int(round(raw.shape[0] * factor)))
            interpolation = cv2.INTER_AREA if factor < 1 else cv2.INTER_LINEAR
            resized = cv2.resize(raw, (width, height), interpolation=interpolation)
        self._resized[key] = resized
        return resized

    def find(self, name, screenshot_gray, scale, region=None, confidence=None):
        """Best match for `name`, or None below its confidence.

        region: optional (left, top, width, height) in PHYSICAL px to search.
        """
        if not self.has(name):
            return None
        record = self.record(name)
        threshold = float(confidence if confidence is not None else record.get('confidence', DEFAULT_CONFIDENCE))
        capture_scale = float(record.get('captureScale') or scale or 1.0)
        base_factor = scale / capture_scale
        offset_x, offset_y = 0, 0
        haystack = screenshot_gray
        if region:
            left, top, width, height = [int(value) for value in region]
            left, top = max(0, left), max(0, top)
            haystack = screenshot_gray[top:top + max(1, height), left:left + max(1, width)]
            offset_x, offset_y = left, top

        order = list(self.extra_scales)
        preferred = self._preferred_scale.get(name)
        if preferred in order:
            order.remove(preferred)
            order.insert(0, preferred)

        best = None
        for zoom in order:
            template = self._template(name, base_factor * zoom)
            if template.shape[0] > haystack.shape[0] or template.shape[1] > haystack.shape[1]:
                continue
            result = cv2.matchTemplate(haystack, template, cv2.TM_CCOEFF_NORMED)
            _, score, _, location = cv2.minMaxLoc(result)
            if best is None or score > best[0]:
                best = (float(score), location, template.shape, zoom)
            if score >= threshold:
                break
        if best is None or best[0] < threshold:
            return None
        score, (x, y), (height, width), zoom = best
        self._preferred_scale[name] = zoom
        left, top = x + offset_x, y + offset_y
        offset = record.get('clickOffset') or [0, 0]
        click_x = int(round((left + width / 2) / scale + offset[0] * zoom))
        click_y = int(round((top + height / 2) / scale + offset[1] * zoom))
        return Match(name, score, left, top, width, height, click_x, click_y, scale)

    def uniqueness(self, name, screenshot_gray, scale, exclude_box):
        """Second-best score outside `exclude_box` — high means ambiguous."""
        if not self.has(name):
            return 0.0
        record = self.record(name)
        template = self._template(name, scale / float(record.get('captureScale') or scale))
        if template.shape[0] > screenshot_gray.shape[0] or template.shape[1] > screenshot_gray.shape[1]:
            return 0.0
        result = cv2.matchTemplate(screenshot_gray, template, cv2.TM_CCOEFF_NORMED)
        left, top, width, height = exclude_box
        pad_x, pad_y = max(2, width // 2), max(2, height // 2)
        result[max(0, top - pad_y):top + pad_y, max(0, left - pad_x):left + pad_x] = -1
        return float(result.max())


def region_around(match, pad=12):
    return (match.left - pad, match.top - pad, match.width + 2 * pad, match.height + 2 * pad)


def same_spot(first, second, tolerance_px=4):
    return second is not None and abs(first.left - second.left) <= tolerance_px and abs(first.top - second.top) <= tolerance_px


# --------------------------------------------------------------------------- text

_ANGLE = re.compile(r'[<>]')


def clean_title(value):
    """Studio rejects < and > and titles over 100 characters."""
    text = _ANGLE.sub('', ' '.join(str(value or '').split()))
    return text[:TITLE_MAX].rstrip()


def clean_description(value):
    text = _ANGLE.sub('', str(value or '').replace('\r\n', '\n'))
    return text[:DESCRIPTION_MAX]


def clean_tags(value):
    """Tags as Studio's tag box accepts them: comma separated, <= 500 chars."""
    if isinstance(value, str):
        items = re.split(r'[,\n]|\s{2,}', value) if (',' in value or '\n' in value) else value.split()
    else:
        items = list(value or [])
    tags, total = [], 0
    for item in items:
        tag = _ANGLE.sub('', str(item)).strip().lstrip('#').replace(',', ' ').strip()
        if not tag or tag in tags:
            continue
        cost = len(tag) + (2 if ' ' in tag else 0) + (1 if tags else 0)
        if total + cost > TAGS_MAX_CHARS:
            break
        tags.append(tag)
        total += cost
    return tags


_VIDEO_ID = r'([A-Za-z0-9_-]{11})'


def parse_video_link(text):
    """Video id + canonical URL from whatever Studio put on the clipboard."""
    raw = str(text or '').strip()
    for pattern in (
        rf'youtu\.be/{_VIDEO_ID}',
        rf'youtube\.com/watch\?(?:[^\s#]*&)?v={_VIDEO_ID}',
        rf'youtube\.com/(?:shorts|live|embed)/{_VIDEO_ID}',
        rf'studio\.youtube\.com/video/{_VIDEO_ID}',
    ):
        found = re.search(pattern, raw)
        if found:
            video_id = found.group(1)
            return {'videoId': video_id, 'url': f'https://www.youtube.com/watch?v={video_id}'}
    return None


# --------------------------------------------------------------------------- payload + plan

PRIVACY_TEMPLATES = {'private': 'private_radio', 'unlisted': 'unlisted_radio', 'public': 'public_radio'}


def parse_payload(raw):
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as error:
        raise ValueError(f'Payload must be JSON: {error}') from error
    if not isinstance(payload, dict):
        raise ValueError('Payload must be a JSON object')
    video_path = str(payload.get('videoPath') or '').strip()
    if not video_path:
        raise ValueError('videoPath is required')
    privacy = str(payload.get('privacyStatus') or 'private').lower()
    if privacy not in PRIVACY_TEMPLATES:
        privacy = 'private'
    title = clean_title(payload.get('title'))
    if not title:
        raise ValueError('A title is required')
    return {
        'videoPath': video_path,
        'title': title,
        'description': clean_description(payload.get('description')),
        'tags': clean_tags(payload.get('tags')),
        'privacyStatus': privacy,
        'madeForKids': bool(payload.get('madeForKids')),
    }


def plan_requirements(payload, matcher):
    """Templates this particular upload needs beyond the always-required set,
    checked BEFORE the browser is touched so a job fails with a named missing
    template instead of halfway through Studio."""
    needed = []
    if payload['madeForKids']:
        needed.append('made_for_kids_radio')
    privacy_template = PRIVACY_TEMPLATES[payload['privacyStatus']]
    needed.append(privacy_template)
    if payload['privacyStatus'] != 'private' and not matcher.has('publish_button'):
        needed.append('publish_button')
    missing = [name for name in needed if not matcher.has(name)]
    warnings = []
    if payload['tags'] and not (matcher.has('show_more_button') and matcher.has('tags_field')):
        warnings.append('Tags will be skipped: show_more_button and tags_field are not calibrated')
    return missing, warnings
