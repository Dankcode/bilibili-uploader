import argparse
import getpass
import json
import os
import random
import sys
import time
import webbrowser
from pathlib import Path

import keyring
import pyautogui
import pyperclip


PROFILE_PATH = Path(os.getenv("YOUTUBE_PYGUI_PROFILE", "config/pygui_upload_profile.json"))
STUDIO_URL = os.getenv("YOUTUBE_STUDIO_URL", "https://studio.youtube.com")
KEYRING_SERVICE = os.getenv("YOUTUBE_PYGUI_KEYRING_SERVICE", "bilibili-uploader.youtube")
LOGIN_WAIT_SECONDS = float(os.getenv("YOUTUBE_PYGUI_LOGIN_WAIT_SECONDS", "3"))


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


def keyring_username_key():
    return "designated_account_username"


def save_login_settings(username, password):
    keyring.set_password(KEYRING_SERVICE, keyring_username_key(), username)
    keyring.set_password(KEYRING_SERVICE, username, password)
    print(f"Saved YouTube login settings for {username} in the OS keyring.")


def load_login_settings():
    username = keyring.get_password(KEYRING_SERVICE, keyring_username_key())
    if not username:
        return None, None

    password = keyring.get_password(KEYRING_SERVICE, username)
    return username, password


def clear_login_settings():
    username = keyring.get_password(KEYRING_SERVICE, keyring_username_key())
    if username:
        try:
            keyring.delete_password(KEYRING_SERVICE, username)
        except keyring.errors.PasswordDeleteError:
            pass

    try:
        keyring.delete_password(KEYRING_SERVICE, keyring_username_key())
    except keyring.errors.PasswordDeleteError:
        pass

    print("Cleared saved YouTube login settings from the OS keyring.")


def setup_login_settings():
    username = input("YouTube/Google account email: ").strip()
    if not username:
        raise SystemExit("Username is required.")

    password = getpass.getpass("YouTube/Google account password: ")
    if not password:
        raise SystemExit("Password is required.")

    save_login_settings(username, password)


def auto_login(profile):
    username, password = load_login_settings()
    if not username or not password:
        raise SystemExit("No saved login settings. Run with --setup-login first.")

    email_field = capture_point(
        profile,
        "login_email_field",
        "Point at the Google login email field.",
    )
    human_click(email_field)
    paste_text(username)
    pyautogui.press("enter")
    time.sleep(LOGIN_WAIT_SECONDS)

    password_field = capture_point(
        profile,
        "login_password_field",
        "Point at the Google login password field after it appears.",
    )
    human_click(password_field)
    paste_text(password)
    pyautogui.press("enter")
    time.sleep(LOGIN_WAIT_SECONDS)

    input(
        "Complete any account challenge, 2FA, CAPTCHA, or verification in the browser. "
        "When the YouTube Studio dashboard is visible, press Enter here..."
    )


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


def run(video_path, title, description, tags, auto_login_enabled=False):
    profile = load_profile()
    webbrowser.open(STUDIO_URL)

    if auto_login_enabled:
        auto_login(profile)
    else:
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
    parser.add_argument("video_path", nargs="?")
    parser.add_argument("title", nargs="?")
    parser.add_argument("description", nargs="?")
    parser.add_argument("tags", nargs="?", default="")
    parser.add_argument("--setup-login", action="store_true", help="Save the designated account login in the OS keyring.")
    parser.add_argument("--clear-login", action="store_true", help="Remove the saved designated account login.")
    parser.add_argument("--auto-login", action="store_true", help="Type saved login settings with PyGUI before upload.")
    parser.add_argument("--no-auto-login", action="store_true", help="Disable env-driven auto-login for this run.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.setup_login:
        setup_login_settings()
    elif args.clear_login:
        clear_login_settings()
    else:
        missing = [name for name in ("video_path", "title", "description") if not getattr(args, name)]
        if missing:
            raise SystemExit(f"Missing required upload arguments: {', '.join(missing)}")

        env_auto_login = os.getenv("YOUTUBE_PYGUI_AUTO_LOGIN", "").lower() in {"1", "true", "yes"}
        auto_login_enabled = args.auto_login or (env_auto_login and not args.no_auto_login)
        run(args.video_path, args.title, args.description, args.tags, auto_login_enabled=auto_login_enabled)
