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
    for alternatives in manifest.get('requiredAny', []):
        if not any(name in ready for name in alternatives):
            missing_required.append(' or '.join(alternatives))
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


def capture_from_image(template_dir, manifest, name, image, box, logical_size, click=None, confidence=.94):
    """Train from an MCP screenshot without touching the desktop.

    box and click are physical pixels relative to this screenshot. Window
    screenshots have their own origin; callers must map clicks to their MCP's
    coordinate space separately. Only the small control crop is persisted.
    """
    if name not in manifest['templates']:
        raise ValueError(f'Unknown template: {name}')
    if image is None or min(logical_size) <= 0 or not .85 <= confidence <= 1:
        raise ValueError('Invalid screenshot, logical size or confidence')
    scale = screen_scale(image, logical_size)
    if abs(image.shape[0] / logical_size[1] - scale) > .05:
        raise ValueError('Screenshot and logical dimensions have different aspect ratios')
    x, y, width, height = map(int, box)
    if min(width, height) < 12 or min(x, y) < 0 or x+width > image.shape[1] or y+height > image.shape[0]:
        raise ValueError('Crop must be at least 12px and inside the screenshot')
    crop = image[y:y+height, x:x+width]
    if to_gray(crop).std() < 5:
        raise ValueError('Blank or low-contrast control crop')
    center = (x+width/2, y+height/2)
    click = click or center
    if not (0 <= click[0] < image.shape[1] and 0 <= click[1] < image.shape[0]):
        raise ValueError('Click point is outside screenshot')
    # Check uniqueness before changing an existing reference.
    result = cv2.matchTemplate(to_gray(image), to_gray(crop), cv2.TM_CCOEFF_NORMED)
    result[max(0,y-height//2):y+height//2+1, max(0,x-width//2):x+width//2+1] = -1
    rival = float(result.max())
    if rival >= confidence - .03:
        raise ValueError(f'Ambiguous crop (second match {rival:.3f}); include more context')
    directory = Path(template_dir)
    directory.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(directory / f'{name}.png'), crop):
        raise ValueError('Could not save template image')
    calibration = load_calibration(directory)
    record = make_record(name, crop.shape, scale,
                         ((click[0]-center[0])/scale, (click[1]-center[1])/scale),
                         logical_size, confidence)
    calibration['templates'][name] = record
    save_calibration(directory, calibration)
    return record


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


def verified_content_row(observations, title, privacy):
    """Verify one saved row from offline OCR, never mix adjacent videos' cells.

    Coordinates are normalized, top-left origin. Truncated/ambiguous titles
    deliberately fail closed; the operator can reconcile the saved receipt.
    """
    normalize = lambda text: ''.join(c for c in text.casefold() if c.isalnum())
    rows = [r for r in observations if r.get('confidence', 0) >= .9]
    titles = [r for r in rows if normalize(r['text']) == normalize(title)]
    if len(titles) != 1 or not any(normalize(r['text']) == 'channelcontent' for r in rows):
        return False
    target = titles[0]
    cy = target['y'] + target['height'] / 2
    for cell in rows:
        # Vision occasionally interprets the lock icon as an A or a bullet.
        if not re.fullmatch(r'(?:[A•🔒]\s*)?' + re.escape(privacy), cell['text'].strip(), re.I):
            continue
        if cell['x'] <= target['x'] + target['width'] or abs(cell['y'] + cell['height'] / 2 - cy) > .018:
            continue
        if any(normalize(r['text']) == 'uploaded' and r['x'] > cell['x'] + cell['width']
               and .005 <= r['y'] - target['y'] <= .045 for r in rows):
            return True
    return False


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
        'verifyCompletion': payload.get('verifyCompletion') is True,
    }


def plan_requirements(payload, matcher):
    """Templates this particular upload needs beyond the always-required set,
    checked BEFORE the browser is touched so a job fails with a named missing
    template instead of halfway through Studio."""
    needed = []
    if payload.get('verifyCompletion'):
        needed.append('upload_complete_marker')
    if payload['madeForKids']:
        needed.append('made_for_kids_radio')
    privacy_template = PRIVACY_TEMPLATES[payload['privacyStatus']]
    needed.append(privacy_template)
    if payload['privacyStatus'] != 'private' and not matcher.has('publish_button'):
        needed.append('publish_button')
    missing = [name for name in needed if not matcher.has(name)]
    warnings = []
    if payload['privacyStatus'] != 'private' and not matcher.has('published_dialog_marker'):
        warnings.append("published_dialog_marker is not calibrated: if Studio's confirmation after PUBLISH is worded "
                        'differently from the SAVE one, this run will be reported as unconfirmed')
    if payload['tags'] and not (matcher.has('show_more_button') and matcher.has('tags_field')):
        warnings.append('Tags will be skipped: show_more_button and tags_field are not calibrated')
    return missing, warnings
