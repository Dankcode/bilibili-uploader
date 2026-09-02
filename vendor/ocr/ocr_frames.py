#!/usr/bin/env python3
"""Read a frame manifest from stdin and emit normalized RapidOCR readings."""

import json
import sys

from rapidocr_onnxruntime import RapidOCR


def main():
    payload = json.load(sys.stdin)
    minimum = float(payload.get("minConfidence", 0.5))
    engine = RapidOCR()
    readings = []
    for frame in payload.get("frames", []):
        result, _ = engine(frame["path"])
        lines = []
        confidences = []
        for item in result or []:
            text = str(item[1]).strip()
            confidence = float(item[2])
            if text and confidence >= minimum:
                lines.append(text)
                confidences.append(confidence)
        if lines:
            readings.append({
                "time": float(frame.get("time", 0)),
                "text": " ".join(lines),
                "confidence": max(confidences),
                "lineCount": len(lines),
            })
    json.dump({"readings": readings}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
