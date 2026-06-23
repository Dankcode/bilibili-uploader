import argparse
import json
import os
import random
import sys
import time
import webbrowser
from pathlib import Path

import pyautogui
import pyperclip


PROFILE_PATH = Path(os.getenv("YOUTUBE_PYGUI_PROFILE", "config/pygui_upload_profile.json"))
STUDIO_URL = os.getenv("YOUTUBE_STUDIO_URL", "https://studio.youtube.com")


def load_profile():
    if PROFILE_PATH.exists():
        with PROFILE_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_profile(profile):
    PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with PROFILE_PATH.open("w", encoding="utf-8") as f:
        json.dump(profile, f, indent=2, sort_keys=True)


def human_pause(min_seconds=0.4, max_seconds=1.2):
    time.sleep(random.uniform(min_seconds, max_seconds))


def human_click(point):
    x, y = point
    pyautogui.moveTo(x, y, duration=random.uniform(0.25, 0.8), tween=pyautogui.easeInOutQuad)
    pyautogui.click()
    human_pause()


def capture_point(profile, key, prompt):
    if key in profile:
        return tuple(profile[key])

    input(f"{prompt}\nMove the mouse there, then press Enter here...")
    point = pyautogui.position()
    profile[key] = [point.x, point.y]
    save_profile(profile)
    return tuple(profile[key])


def paste_text(text):
    pyperclip.copy(text or "")
    modifier = "command" if sys.platform == "darwin" else "ctrl"
    pyautogui.hotkey(modifier, "a")
    human_pause(0.1, 0.25)
    pyautogui.hotkey(modifier, "v")
    human_pause()


def choose_file(video_path):
    video_path = str(Path(video_path).expanduser().resolve())

    if sys.platform == "darwin":
        pyautogui.hotkey("command", "shift", "g")
        human_pause()
        pyperclip.copy(video_path)
        pyautogui.hotkey("command", "v")
        pyautogui.press("enter")
        human_pause()
        pyautogui.press("enter")
    else:
        pyperclip.copy(video_path)
        modifier = "ctrl"
        pyautogui.hotkey(modifier, "l")
        pyautogui.hotkey(modifier, "v")
        pyautogui.press("enter")

    human_pause(1.5, 3.0)


def run(video_path, title, description, tags):
    profile = load_profile()
    webbrowser.open(STUDIO_URL)

    input(
        "Complete YouTube Studio login, account selection, and any verification in the browser. "
        "When the Studio dashboard is visible, press Enter here..."
    )

    upload_button = capture_point(
        profile,
        "upload_button",
        "Point at the YouTube Studio upload/create button.",
    )
    human_click(upload_button)

    select_file_button = capture_point(
        profile,
        "select_file_button",
        "Point at the Select files button in the upload dialog.",
    )
    human_click(select_file_button)
    choose_file(video_path)

    input("Wait until the Details dialog is ready, then press Enter here...")

    title_field = capture_point(
        profile,
        "title_field",
        "Point at the title field.",
    )
    human_click(title_field)
    paste_text(title)

    description_field = capture_point(
        profile,
        "description_field",
        "Point at the description field.",
    )
    human_click(description_field)
    paste_text(description)

    if tags:
        print(f"Tags for manual entry: {tags}")

    print(
        "Finish the audience, checks, visibility, and publish/save steps in YouTube Studio. "
        "Do not skip any login or verification prompts."
    )
    uploaded_url = input("Paste the final YouTube URL or video ID here, then press Enter: ").strip()
    print(uploaded_url)


def parse_args():
    parser = argparse.ArgumentParser(description="Guided PyAutoGUI YouTube Studio uploader.")
    parser.add_argument("video_path")
    parser.add_argument("title")
    parser.add_argument("description")
    parser.add_argument("tags", nargs="?", default="")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(args.video_path, args.title, args.description, args.tags)
