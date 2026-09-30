#!/bin/bash
# Mac-side helper for agent-assisted Studio calibration and replay.
# Run once in Terminal from the repo root:  bash scripts/python/studio_capture_watch.sh
# Terminal needs Screen Recording (for captures) and Accessibility (for replay clicks).
# An agent that can only write files in the repo drops request files into
# video-work/studio-watch/; this loop answers them. Only three fixed actions exist:
#   capture  -> full-screen still (native pixels) at shots/<label>.png
#   check    -> uploader --check against the live screen, output in check.log
#   replay   -> uploader --payload "$(cat replay)", output in replay.log
# Stop with Ctrl-C.
cd "$(dirname "$0")/../.." || exit 1
W=video-work/studio-watch
PY=.venv-gui/bin/python
mkdir -p "$W/shots"
"$PY" -c 'import pyautogui,json;s=pyautogui.size();print(json.dumps({"logical":[s.width,s.height]}))' > "$W/screen.json"
echo "watching $W  (screen: $(cat $W/screen.json))"
while true; do
  if [ -f "$W/capture" ]; then
    label=$(tr -cd 'a-zA-Z0-9_-' < "$W/capture"); rm -f "$W/capture"
    screencapture -x -m "$W/shots/${label:-shot}.png" && echo "captured ${label}"
    touch "$W/shots/${label:-shot}.done"
  fi
  if [ -f "$W/check" ]; then
    rm -f "$W/check"
    "$PY" scripts/python/youtube_studio_vision_uploader.py --check > "$W/check.log" 2>&1; echo "check exit $?" >> "$W/check.log"
    echo "check done"
  fi
  if [ -f "$W/replay" ]; then
    payload=$(cat "$W/replay"); rm -f "$W/replay"
    echo "replay started $(date)"
    "$PY" scripts/python/youtube_studio_vision_uploader.py --payload "$payload" > "$W/replay.log" 2>&1; echo "replay exit $?" >> "$W/replay.log"
    echo "replay finished $(date)"
  fi
  sleep 0.3
done
