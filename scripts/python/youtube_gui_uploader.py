"""Bounded, private-only YouTube Studio upload using trained screenshot crops.

Login and challenges remain manual. No API upload or fixed-coordinate fallback.
The driver is injectable so tests never touch the desktop or upload media.
"""
import argparse
import contextlib
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

from gui_references import ReferenceError, locate, validate


def video_url(value):
    match = re.fullmatch(r"https://(?:youtu\.be/|(?:www\.)?youtube\.com/watch\?v=)([\w-]{11})(?:[?&].*)?", value.strip())
    if not match:
        raise RuntimeError("Studio did not return a valid YouTube video link")
    return "https://www.youtube.com/watch?v=" + match.group(1)


class Desktop:
    def __init__(self, directory, audit):
        import pyautogui
        import pyperclip
        self.gui, self.clipboard = pyautogui, pyperclip
        self.gui.FAILSAFE = True
        self.gui.PAUSE = .15
        self.directory, self.audit = directory, audit
        self.modifier = "command" if sys.platform == "darwin" else "ctrl"

    def find(self, key):
        return locate(self.directory, key, self.gui.screenshot(), tuple(self.gui.size()))

    def wait(self, key, timeout=45):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            found = self.find(key)
            if found:
                # Verify a stable target on a second capture before clicking.
                time.sleep(.2)
                confirmed = self.find(key)
                if confirmed and all(abs(a-b) < 3 for a,b in zip(found["point"], confirmed["point"])):
                    self.audit("matched", confirmed)
                    return confirmed
            time.sleep(.5)
        raise RuntimeError("Timed out waiting for " + key + "; inspect Studio before retrying")

    def click(self, key, timeout=45):
        found = self.wait(key, timeout)
        self.gui.click(*found["point"])
        self.audit("clicked", {"key": key, "point": found["point"]})

    def reveal(self, key, direction=-1, attempts=15):
        for _ in range(attempts):
            if self.find(key):
                return
            # Scroll inside the last observed Details pane, not at a stale pointer.
            pane = self.wait("details")
            self.gui.moveTo(*pane["point"])
            self.gui.scroll(4 * direction)
            time.sleep(.4)
        raise RuntimeError("Cannot reveal " + key)

    def paste(self, text):
        self.clipboard.copy(text)
        self.gui.hotkey(self.modifier, "v")

    def copied(self, action):
        self.clipboard.copy("")
        action()
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            value = self.clipboard.paste().strip()
            if value:
                return value
            time.sleep(.1)
        raise RuntimeError("Clipboard copy did not produce a value")

    def text(self, key, value):
        self.click(key)
        self.gui.hotkey(self.modifier, "a")
        self.paste(value)
        self.gui.hotkey(self.modifier, "a")
        actual = self.copied(lambda: self.gui.hotkey(self.modifier, "c"))
        if actual.replace("\r\n", "\n") != value.replace("\r\n", "\n"):
            raise RuntimeError("Input verification failed for " + key)
        self.gui.press("right")

    def open_channel(self, channel_id):
        # Use the foreground browser; do not change profiles or automate sign-in.
        self.gui.hotkey(self.modifier, "l")
        self.paste("https://studio.youtube.com/channel/" + channel_id)
        self.gui.press("enter")
        self.wait("create")
        self.gui.hotkey(self.modifier, "l")
        url = self.copied(lambda: self.gui.hotkey(self.modifier, "c"))
        self.gui.press("escape")
        if not re.fullmatch(r"https://studio\.youtube\.com/channel/" + re.escape(channel_id) + r"(?:[/?#].*)?", url):
            raise RuntimeError("Wrong channel or sign-in required; refusing to upload")

    def choose_file(self, file_path):
        if sys.platform != "darwin":
            raise RuntimeError("Native file chooser is currently validated for macOS only")
        self.gui.hotkey("command", "shift", "g")
        time.sleep(.4)
        self.paste(str(file_path))
        self.gui.press("enter")
        time.sleep(.5)
        self.gui.press("enter")

    def copy_link(self):
        return self.copied(lambda: self.click("copy_link"))


def upload(driver, file_path, title, description, tags, channel_id, audit, timeout=900):
    driver.open_channel(channel_id)
    driver.click("create")
    driver.click("upload_menu")
    driver.click("select_files")
    driver.choose_file(file_path)
    driver.wait("details", 90)
    driver.text("title", title)
    if description:
        driver.text("description", description)
    driver.reveal("audience_no")
    driver.click("audience_no")
    driver.wait("audience_no_selected")
    if tags:
        driver.reveal("show_more")
        driver.click("show_more")
        driver.reveal("tags")
        driver.text("tags", tags)
    driver.click("next")
    driver.wait("elements")
    driver.click("next")
    driver.wait("checks")
    driver.wait("checks_complete", timeout)
    driver.click("next")
    driver.wait("visibility")
    driver.click("private")
    driver.wait("private_selected")
    audit("save_started", {"privacyStatus": "private"})
    driver.click("save", timeout)
    driver.wait("upload_complete", timeout)
    url = video_url(driver.copy_link())
    result = {"url": url, "remoteId": url.rsplit("=", 1)[1], "channelId": channel_id,
              "privacyStatus": "private", "method": "gui", "title": title}
    audit("confirmed", result)
    return result


def file_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@contextlib.contextmanager
def desktop_lock(directory):
    # OS advisory locks are released on timeout/kill, unlike a stale sentinel file.
    import fcntl
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "desktop.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another GUI upload owns the desktop")
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def run(args, driver_factory=Desktop):
    path = Path(args.video_path).expanduser().resolve()
    if not path.is_file() or path.stat().st_size == 0 or path.suffix.lower() not in {".mp4", ".mov", ".mkv", ".webm"}:
        raise RuntimeError("A nonempty local video file is required")
    if not re.fullmatch(r"UC[\w-]{22}", args.channel_id):
        raise RuntimeError("An exact YouTube UC channel ID is required")
    if not 1 <= len(args.title.strip()) <= 100 or len(args.description) > 5000:
        raise RuntimeError("Title must be 1–100 characters; description at most 5000")
    if len(args.tags) > 500:
        raise RuntimeError("Tags exceed 500 characters")
    if args.privacy != "private":
        raise RuntimeError("This GUI workflow supports private uploads only")
    validate(args.references, tags=bool(args.tags))
    run_root = Path(args.runs)
    run_root.mkdir(parents=True, exist_ok=True)
    digest = file_digest(path)
    receipt_path = run_root / (args.channel_id + "-" + digest + ".json")
    with desktop_lock(run_root):
        if receipt_path.exists():
            previous = json.loads(receipt_path.read_text())
            if previous.get("status") == "confirmed":
                return previous["result"]
            raise RuntimeError("An earlier attempt may have created a draft. Review its receipt and Studio before retrying: " + str(receipt_path))
        receipt = {"status": "started", "filePath": str(path), "sha256": digest,
                   "channelId": args.channel_id, "events": []}
        def audit(event, detail):
            receipt["events"].append({"time": time.time(), "event": event, "detail": detail})
            if event == "confirmed":
                receipt["status"], receipt["result"] = "confirmed", detail
            temporary = receipt_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(receipt, indent=2) + "\n")
            temporary.replace(receipt_path)
        audit("started", {"title": args.title})
        driver = None
        clipboard = None
        try:
            driver = driver_factory(args.references, audit)
            if hasattr(driver, "clipboard"):
                clipboard = driver.clipboard.paste()
            return upload(driver, path, args.title, args.description, args.tags,
                          args.channel_id, audit, args.timeout)
        except Exception as error:
            receipt["status"] = "needs_review"
            audit("failed", {"error": str(error)})
            raise
        finally:
            if driver and clipboard is not None:
                driver.clipboard.copy(clipboard)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video_path")
    parser.add_argument("title")
    parser.add_argument("description", nargs="?", default="")
    parser.add_argument("tags", nargs="?", default="")
    parser.add_argument("--channel-id", default=os.getenv("YOUTUBE_CHANNEL_ID", ""))
    parser.add_argument("--privacy", default="private")
    parser.add_argument("--references", default=os.getenv("YOUTUBE_GUI_REFERENCES", "config/gui-references/youtube"))
    parser.add_argument("--runs", default="video-work/gui-uploads")
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()
    try:
        print(json.dumps({"ok": True, **run(args)}))
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
