"""Draw screens of the application from its code, with the workspace's own model.

Each screen is one self-contained HTML page that shows what the code's template looks like,
filled with sample data only. The drawing is checked before it is sent, and the Cutover API checks
it again. Stdlib only.

Rules this file keeps:
- A drawing may not run code, load anything from another site, or send a form. Those drawings are refused.
- At most SCREEN_MAX drawings per analysis, for template files only.
- The model is asked for sample data only. Its drawings are never written to a file in the workspace.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import PurePosixPath
from typing import Callable

SCREEN_MAX = 8
SCREEN_CATEGORIES = {"template"}
SCREEN_MIN_CHARS = 50
SCREEN_MAX_CHARS = 40_000
# A whole page of HTML plus the model's own reasoning can pass 8,000 tokens, so the reply was cut off.
SCREEN_MAX_TOKENS = 16_000

SCREEN_PROMPT = (
    "You draw one screen of a healthcare software application as a single self-contained HTML page, "
    "so people can see what it looks like. Keep the layout, headings, labels and buttons from the file. "
    "Fill every field with sample data only: invented names, numbers and dates. Never copy real values from the code. "
    "Put all styling in one <style> tag. Do not use scripts, links to other sites, images from the web, forms or frames. "
    "Reply with the HTML only, with no commentary and no markdown code fences."
)

# The same refusals as the Worker. A drawing that matches any of them is not sent.
REFUSED = [
    re.compile(r"<\s*(script|iframe|frame|frameset|object|embed|link|meta|base|form|style\s+src)\b", re.I),
    re.compile(r"\son[a-z]+\s*=", re.I),
    re.compile(r"\b(src|href|action|poster|srcset|background|formaction)\s*=\s*[\"']?\s*(https?:|//|data:|javascript:)", re.I),
    re.compile(r"url\(\s*[\"']?\s*(https?:|//|data:)", re.I),
    re.compile(r"@import", re.I),
    re.compile(r"javascript:", re.I),
]


class StopDrawing(Exception):
    """The provider refused the key or limited requests. No more screens are drawn."""

    def __init__(self, status):
        super().__init__("drawing stopped")
        self.status = status


class ScreenError(Exception):
    """One screen could not be drawn. Only that screen is skipped."""


def choose_screen_files(records: list[dict], limit: int = SCREEN_MAX) -> list[dict]:
    return [r for r in records if r.get("category") in SCREEN_CATEGORIES][:limit]


def screen_problem(html: str) -> str | None:
    """Returns why a drawing is refused, or None when it may be sent."""
    if not isinstance(html, str) or len(html) < SCREEN_MIN_CHARS or len(html) > SCREEN_MAX_CHARS:
        return "Each screen must be HTML of 50 to 40,000 characters."
    if not re.search(r"<html|<body|<!doctype", html, re.I):
        return "Each screen must be a complete HTML page."
    if any(rx.search(html) for rx in REFUSED):
        return "A screen used something a drawing may not use: scripts, links to other sites, forms or frames."
    return None


def screen_name(path: str) -> str:
    words = re.sub(r"[-_]+", " ", PurePosixPath(path).stem).strip()
    return (words[:1].upper() + words[1:]) or path


def inspect_reply(reply: str) -> tuple[str | None, str | None]:
    """Returns (the page, None) when the reply holds a usable page, or (None, the reason it was refused)."""
    text = reply.strip()
    fence = re.match(r"^```[a-zA-Z]*\s*\n(.*?)\n?```\s*$", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start = re.search(r"<!doctype|<html|<body", text, re.I)
    if not start:
        return None, "reply had no HTML page"
    html = text[start.start():].strip()
    problem = screen_problem(html)
    return (html, None) if problem is None else (None, problem)


def clean_reply(reply: str) -> str | None:
    """Takes the HTML out of a reply, dropping any fences or chatter around it. None if no usable page is there."""
    return inspect_reply(reply)[0]


def draw_screens(records: list[dict], read_source: Callable[[str], str | None], ask: Callable[[dict, str], str],
                 reasons: list[str] | None = None) -> tuple[list[dict], dict]:
    """Draws one screen per chosen template file. Returns the screens and counts only.
    When a list is given, the reason each screen was refused is added to it (no file names, no code)."""
    screens: list[dict] = []
    stats = {"drawn": 0, "refused": 0, "stopped": None}
    for record in choose_screen_files(records):
        code = read_source(record["path"])
        if code is None:
            stats["refused"] += 1
            if reasons is not None:
                reasons.append("source file could not be read")
            continue
        try:
            reply = ask(record, code)
        except StopDrawing as err:
            stats["stopped"] = err.status
            break
        except ScreenError as err:
            stats["refused"] += 1
            if reasons is not None:
                reasons.append(str(err) or "request failed")
            continue
        html, problem = inspect_reply(reply)
        if html is None:
            stats["refused"] += 1
            if reasons is not None:
                reasons.append(problem or "reply not usable")
            continue
        screens.append({"path": record["path"], "name": screen_name(record["path"]), "html": html})
        stats["drawn"] += 1
    return screens, stats


def post_screens(callback: str, analysis_id: str, secret: str, screens: list[dict], opener=urllib.request.urlopen) -> int:
    """Sends the drawings to the API. Returns the HTTP status (201 when saved)."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/screens"
    req = urllib.request.Request(url, data=json.dumps({"screens": screens}).encode("utf-8"), method="POST", headers={
        "content-type": "application/json",
        "x-runner-secret": secret,
        "user-agent": "cutover-runner",
    })
    try:
        with opener(req, timeout=60) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code
    except (urllib.error.URLError, OSError):
        return 0
