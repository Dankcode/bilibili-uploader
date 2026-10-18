"""Private subprocess protocol: stdout goes only to the Video Ops parent.

Read Bilibili cookies from local Chrome profiles. Never run this helper in a
terminal to display credentials; the Node adapter verifies and saves them.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import re
import sys
import time


def chrome_cookie_files():
    home = Path.home()
    if sys.platform == "darwin":
        roots = [home / "Library/Application Support/Google/Chrome"]
    elif sys.platform == "win32":
        roots = [Path(os.environ.get("LOCALAPPDATA", str(home))) / "Google/Chrome/User Data"]
    else:
        roots = [home / ".config/google-chrome", home / ".config/chromium"]
    for root in roots:
        if not root.is_dir():
            continue
        profiles = [root / "Default"] + sorted(root.glob("Profile [0-9]*"))
        for profile in profiles[:10]:
            for relative in ("Network/Cookies", "Cookies"):
                cookie_file = profile / relative
                if cookie_file.is_file():
                    yield profile.name, cookie_file
                    break


def load_sessions():
    try:
        import browser_cookie3
    except ImportError:
        return {"sessions": [], "reason": "dependency_missing"}
    sessions = []
    had_error = False
    for profile, cookie_file in chrome_cookie_files():
        try:
            # Suppress third-party diagnostics; neither exceptions nor cookie
            # values belong in server logs. The domain filter limits SQL reads.
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                jar = browser_cookie3.chrome(cookie_file=str(cookie_file), domain_name=".bilibili.com")
            cookies = []
            for cookie in jar:
                if not re.search(r"(^|\.)bilibili\.com$", cookie.domain, re.I):
                    continue
                if cookie.expires and cookie.expires <= time.time():
                    continue
                cookies.append({
                    "name": cookie.name, "value": cookie.value, "domain": cookie.domain,
                    "path": cookie.path or "/", "expires": cookie.expires or -1,
                    "secure": bool(cookie.secure), "httpOnly": cookie.has_nonstandard_attr("HttpOnly"),
                    "sameSite": "Lax",
                })
            if any(cookie["name"] == "SESSDATA" and cookie["value"] for cookie in cookies):
                sessions.append({"profile": profile, "cookies": cookies})
        except Exception:
            had_error = True
    return {"sessions": sessions, "reason": "browser_access_unavailable" if had_error and not sessions else "no_signed_in_cookie" if not sessions else ""}


if __name__ == "__main__":
    print(json.dumps(load_sessions(), ensure_ascii=True))
