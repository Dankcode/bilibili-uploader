"""Train and locate cropped GUI references. No desktop access on import.

Coordinates are logical screen pixels. Retina captures are normalized before
cropping/matching, so a physical screenshot pixel is never used as a mouse point.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


class ReferenceError(RuntimeError):
    pass


REQUIRED = (
    "create", "upload_menu", "select_files", "details", "title", "description",
    "audience_no", "audience_no_selected", "next", "elements", "checks",
    "checks_complete", "visibility", "private", "private_selected", "save",
    "upload_complete", "copy_link",
)


def normalize(image, logical_size):
    if min(logical_size) <= 0:
        raise ReferenceError("Invalid logical screen dimensions")
    if abs(image.width / logical_size[0] - image.height / logical_size[1]) > .05:
        raise ReferenceError("Screenshot aspect ratio differs from desktop; select one display")
    return image.convert("RGB").resize(tuple(logical_size), Image.Resampling.LANCZOS)


def read_profile(directory):
    path = Path(directory) / "profile.json"
    if not path.exists():
        return {"version": 1, "controls": {}}
    profile = json.loads(path.read_text())
    if profile.get("version") != 1 or not isinstance(profile.get("controls"), dict):
        raise ReferenceError("Unsupported visual reference profile")
    return profile


def train(directory, key, image, box, logical_size, anchor=None, threshold=.94, region=None):
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,60}", key):
        raise ReferenceError("Use a lowercase control name with underscores")
    if not .85 <= threshold <= 1:
        raise ReferenceError("Threshold must be between .85 and 1")
    image = normalize(image, logical_size)
    x, y, w, h = map(int, box)
    if min(w, h) < 8 or x < 0 or y < 0 or x + w > image.width or y + h > image.height:
        raise ReferenceError("Crop must be at least 8x8 and inside the screenshot")
    crop = image.crop((x, y, x + w, y + h))
    if np.asarray(crop.convert("L")).std() < 5:
        raise ReferenceError("Blank/low contrast crop cannot identify a control")
    anchor = list(anchor or [w / 2, h / 2])
    if len(anchor) != 2 or not all(np.isfinite(v) for v in anchor):
        raise ReferenceError("Invalid click anchor")
    # Anchors may sit just outside a label crop to target its associated input.
    if not (-w <= anchor[0] <= 2*w and -2*h <= anchor[1] <= 4*h):
        raise ReferenceError("Click anchor is too far from the control crop")
    region = list(region or [0, 0, 1, 1])
    if len(region) != 4 or not (0 <= region[0] < region[2] <= 1 and 0 <= region[1] < region[3] <= 1):
        raise ReferenceError("Search region must be normalized left,top,right,bottom")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (key + ".png")
    crop.save(path)
    profile = read_profile(directory)
    profile["controls"][key] = {
        "file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "box": [x, y, w, h], "logicalSize": list(logical_size),
        "anchor": anchor, "threshold": threshold, "region": region,
    }
    temporary = directory / "profile.json.tmp"
    temporary.write_text(json.dumps(profile, indent=2) + "\n")
    temporary.replace(directory / "profile.json")
    return profile["controls"][key]


def reference_path(directory, entry):
    root = Path(directory).resolve()
    path = (root / entry["file"]).resolve()
    if path.parent != root or not path.is_file():
        raise ReferenceError("Missing reference or unsafe reference path")
    if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
        raise ReferenceError("Reference changed since training; retrain it")
    return path


def locate(directory, key, image, logical_size):
    profile = read_profile(directory)
    if key not in profile["controls"]:
        raise ReferenceError("Untrained control: " + key)
    entry = profile["controls"][key]
    screen = np.asarray(normalize(image, logical_size))
    template = np.asarray(Image.open(reference_path(directory, entry)).convert("RGB"))
    if np.asarray(Image.fromarray(template).convert("L")).std() < 5:
        raise ReferenceError("Low contrast reference")
    left, top, right, bottom = entry["region"]
    x0, y0 = int(left * logical_size[0]), int(top * logical_size[1])
    roi = screen[y0:int(bottom * logical_size[1]), x0:int(right * logical_size[0])]
    h, w = template.shape[:2]
    if roi.shape[0] < h or roi.shape[1] < w:
        raise ReferenceError("Search region is smaller than reference")
    # Color matching distinguishes the enabled button from a gray disabled one.
    result = cv2.matchTemplate(roi, template, cv2.TM_SQDIFF_NORMED)
    minimum, _, point, _ = cv2.minMaxLoc(result)
    score = 1 - minimum
    if score < entry["threshold"]:
        return None
    x, y = point
    # Suppress the same peak, then reject a second plausible target.
    result[max(0,y-h//2):y+h//2+1, max(0,x-w//2):x+w//2+1] = 1
    second = 1 - float(result.min())
    if second >= entry["threshold"] or score - second < .015:
        raise ReferenceError("Ambiguous control: " + key)
    click = [x0+x+entry["anchor"][0], y0+y+entry["anchor"][1]]
    if not (0 <= click[0] < logical_size[0] and 0 <= click[1] < logical_size[1]):
        raise ReferenceError("Matched click is outside desktop")
    return {"key": key, "score": round(score, 5), "point": click,
            "box": [x0+x, y0+y, w, h]}


def validate(directory, tags=False):
    required = REQUIRED + (("show_more", "tags") if tags else ())
    profile = read_profile(directory)
    missing = [key for key in required if key not in profile["controls"]]
    if missing:
        raise ReferenceError("Missing trained controls: " + ", ".join(missing))
    for key in required:
        reference_path(directory, profile["controls"][key])
    return list(required)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default="config/gui-references/youtube")
    sub = parser.add_subparsers(dest="command", required=True)
    capture = sub.add_parser("train", help="Crop a saved screenshot (no desktop interaction)")
    capture.add_argument("key")
    capture.add_argument("screenshot")
    capture.add_argument("--box", nargs=4, type=int, required=True, metavar=("X","Y","W","H"))
    capture.add_argument("--logical-size", nargs=2, type=int, required=True)
    capture.add_argument("--anchor", nargs=2, type=float)
    capture.add_argument("--region", nargs=4, type=float)
    capture.add_argument("--threshold", type=float, default=.94)
    live = sub.add_parser("capture", help="Save only a tight crop from the current desktop")
    live.add_argument("key")
    live.add_argument("--box", nargs=4, type=int, required=True)
    live.add_argument("--anchor", nargs=2, type=float)
    live.add_argument("--region", nargs=4, type=float)
    live.add_argument("--threshold", type=float, default=.94)
    match = sub.add_parser("match")
    match.add_argument("key")
    match.add_argument("screenshot")
    match.add_argument("--logical-size", nargs=2, type=int, required=True)
    sub.add_parser("validate")
    args = parser.parse_args()
    if args.command == "train":
        print(json.dumps(train(args.directory, args.key, Image.open(args.screenshot), args.box,
                               args.logical_size, args.anchor, args.threshold, args.region)))
    elif args.command == "capture":
        import pyautogui
        print(json.dumps(train(args.directory, args.key, pyautogui.screenshot(), args.box,
                               tuple(pyautogui.size()), args.anchor, args.threshold, args.region)))
    elif args.command == "match":
        print(json.dumps(locate(args.directory, args.key, Image.open(args.screenshot), args.logical_size)))
    else:
        print(json.dumps({"ready": True, "controls": validate(args.directory)}))


if __name__ == "__main__":
    main()
