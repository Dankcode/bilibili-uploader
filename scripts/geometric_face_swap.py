#!/usr/bin/env python3
"""Create a short, landmark-aligned face-swap proof with OpenCV YuNet."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--detector-model", required=True)
    parser.add_argument("--max-frames", type=int, default=30)
    return parser.parse_args()


def detect_largest(detector: cv2.FaceDetectorYN, frame: np.ndarray) -> np.ndarray | None:
    height, width = frame.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(frame)
    if faces is None or len(faces) == 0:
        return None
    return max(faces, key=lambda face: float(face[2] * face[3]))


def anchor_points(face: np.ndarray) -> np.ndarray:
    mouth_center = (face[10:12] + face[12:14]) / 2
    return np.float32([face[4:6], face[6:8], mouth_center])


def face_mask(shape: tuple[int, ...], face: np.ndarray) -> np.ndarray:
    x, y, width, height = face[:4]
    mask = np.zeros(shape[:2], dtype=np.uint8)
    center = (int(x + width * 0.5), int(y + height * 0.5))
    axes = (max(1, int(width * 0.48)), max(1, int(height * 0.56)))
    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1, cv2.LINE_AA)
    return cv2.GaussianBlur(mask, (0, 0), max(2.0, width * 0.035))


def match_color(source: np.ndarray, target: np.ndarray, mask: np.ndarray) -> np.ndarray:
    selected = mask > 24
    if selected.sum() < 16:
        return source
    source_lab = cv2.cvtColor(source, cv2.COLOR_BGR2LAB).astype(np.float32)
    target_lab = cv2.cvtColor(target, cv2.COLOR_BGR2LAB).astype(np.float32)
    source_pixels = source_lab[selected]
    target_pixels = target_lab[selected]
    source_mean = source_pixels.mean(axis=0)
    source_std = np.maximum(source_pixels.std(axis=0), 1.0)
    target_mean = target_pixels.mean(axis=0)
    target_std = np.maximum(target_pixels.std(axis=0), 1.0)
    source_lab[selected] = (source_pixels - source_mean) * np.clip(target_std / source_std, 0.65, 1.45) + target_mean
    return cv2.cvtColor(np.clip(source_lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def composite(source: np.ndarray, source_face: np.ndarray, target: np.ndarray, target_face: np.ndarray) -> np.ndarray:
    transform = cv2.getAffineTransform(anchor_points(source_face), anchor_points(target_face))
    height, width = target.shape[:2]
    warped = cv2.warpAffine(source, transform, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    source_mask = face_mask(source.shape, source_face)
    warped_mask = cv2.warpAffine(source_mask, transform, (width, height), flags=cv2.INTER_LINEAR)
    warped = match_color(warped, target, warped_mask)
    center = (int(target_face[0] + target_face[2] * 0.5), int(target_face[1] + target_face[3] * 0.5))
    try:
        return cv2.seamlessClone(warped, target, warped_mask, center, cv2.NORMAL_CLONE)
    except cv2.error:
        alpha = (warped_mask.astype(np.float32) / 255.0)[:, :, None]
        return np.clip(warped * alpha + target * (1.0 - alpha), 0, 255).astype(np.uint8)


def main() -> None:
    args = parse_args()
    detector_path = Path(args.detector_model).resolve()
    if not detector_path.is_file() or detector_path.stat().st_size < 100_000:
        raise RuntimeError(f"YuNet detector model is missing or invalid: {detector_path}")

    source = cv2.imread(str(Path(args.source).resolve()))
    if source is None:
        raise RuntimeError("Source image could not be read")

    detector = cv2.FaceDetectorYN.create(str(detector_path), "", (320, 320), 0.5, 0.3, 5000)
    source_face = detect_largest(detector, source)
    if source_face is None:
        raise RuntimeError("No source face detected")

    capture = cv2.VideoCapture(str(Path(args.target).resolve()))
    if not capture.isOpened():
        raise RuntimeError("Target video could not be opened")
    fps = float(capture.get(cv2.CAP_PROP_FPS)) or 25.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    if not writer.isOpened():
        raise RuntimeError("Proof video writer could not be opened")

    previous_face = None
    processed = 0
    swapped = 0
    try:
        while processed < max(1, args.max_frames):
            ok, frame = capture.read()
            if not ok:
                break
            detected = detect_largest(detector, frame)
            if detected is not None:
                previous_face = detected if previous_face is None else previous_face * 0.7 + detected * 0.3
            if previous_face is not None:
                frame = composite(source, source_face, frame, previous_face)
                swapped += 1
            writer.write(frame)
            processed += 1
    finally:
        capture.release()
        writer.release()

    if processed == 0 or swapped == 0:
        raise RuntimeError("No target frames contained a detectable face")
    print(json.dumps({
        "engine": "opencv-yunet-geometric",
        "opencvVersion": cv2.__version__,
        "frames": processed,
        "swappedFrames": swapped,
        "fps": fps,
        "width": width,
        "height": height,
    }))


if __name__ == "__main__":
    main()
