"""Draw screens of the application from its code, with the workspace's own model.

Each screen is one self-contained HTML page that shows what the code's template looks like,
filled with sample data only. The drawing is checked before it is sent, and the Cutover API checks
it again. Stdlib only.

Rules this file keeps:
- A drawing may not run code, load anything from another site, or send a form. Those drawings are refused.
- At most SCREEN_MAX drawings of template files, and SCREEN_CONTROL_MAX drawings of classic ASP screen branches, per analysis.
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
# A classic ASP page with a ControlName switch is one screen per branch. These are capped separately, and the
# whole analysis never draws more than SCREEN_TOTAL_MAX (the Worker accepts the same total in one upload).
SCREEN_CONTROL_MAX = 70
SCREEN_TOTAL_MAX = 80
CONTROL_CODE_MAX = 12_000
SCREEN_CATEGORIES = {"template"}
SCREEN_MIN_CHARS = 50
SCREEN_MAX_CHARS = 40_000
# A whole page of HTML plus the model's own reasoning can pass 8,000 tokens, so the reply was cut off.
SCREEN_MAX_TOKENS = 16_000

SCREEN_PROMPT = (
    "You draw one screen of a software application as a single self-contained HTML page, "
    "so people can see what it looks like. Keep the layout, headings, labels and buttons from the file, in the "
    "application's own words. The other files listed with the screen show what the application is for: keep "
    "to that subject and never invent a different kind of business or system. "
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


# Classic ASP pages are screens too, but include files and copies of the pages are not.
ASP_SKIP = re.compile(r"(^|/)(original|includefiles|test|tests)/|(^|/)inc[_a-z]*\.asp$|commonfunctions", re.I)


def is_screen_file(record: dict) -> bool:
    path = record.get("path", "")
    if record.get("category") in SCREEN_CATEGORIES:
        return True
    return path.lower().endswith(".asp") and not ASP_SKIP.search(path)


def choose_screen_files(records: list[dict], limit: int = SCREEN_MAX) -> list[dict]:
    files = [r for r in records if is_screen_file(r) and "control" not in r][:limit]
    controls = [r for r in records if "control" in r][:SCREEN_CONTROL_MAX]
    return files + controls


# A branch of the dispatch: an If or ElseIf that compares ControlName, or a Case of a Select Case on it.
BRANCH_IF = re.compile(r"(?im)^[ \t]*(?:if|elseif|else\s+if)\b[^\n]*?controlname\s*=\s*\"[^\"]+\"[^\n]*$")
BRANCH_CASE = re.compile(r"(?im)^[ \t]*case\s+\"[^\"]+\"(?:\s*,\s*\"[^\"]+\")*[ \t]*$")
NAME_IN_IF = re.compile(r"controlname\s*=\s*\"([^\"]+)\"", re.I)
NAME_IN_CASE = re.compile(r"\"([^\"]+)\"")
ROUTINE = re.compile(r"(?ims)^[ \t]*((?:public\s+|private\s+)?(?:function|sub)\s+(\w+)\b.*?^[ \t]*end\s+(?:function|sub)\b)")
ROUTINE_START = re.compile(r"(?im)^[ \t]*(?:public\s+|private\s+)?(?:function|sub)\s+\w+")
CALL = re.compile(r"\b(?:call\s+)?([A-Za-z_]\w*)\s*\(", re.I)


def split_control_screens(code: str) -> list[tuple[str, str]]:
    """One (screen name, code) for each ControlName branch that writes output. The code is the branch, plus the
    functions it calls, cut to CONTROL_CODE_MAX characters. A name that appears twice keeps its first branch."""
    starts = sorted([(m.start(), m.group(0)) for m in BRANCH_IF.finditer(code)] +
                    [(m.start(), m.group(0)) for m in BRANCH_CASE.finditer(code)])
    routines = {m.group(2).lower(): m.group(1) for m in ROUTINE.finditer(code)}
    # A branch ends at the next branch or the next function, whichever comes first.
    boundaries = sorted([pos for pos, _ in starts] + [m.start() for m in ROUTINE_START.finditer(code)])
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for pos, line in starts:
        later = [b for b in boundaries if b > pos]
        end = later[0] if later else len(code)
        body = code[pos:end]
        names = NAME_IN_IF.findall(line) if BRANCH_IF.match(line.strip()) or re.match(r"\s*(?:if|elseif)", line, re.I) else NAME_IN_CASE.findall(line)
        if not names:
            continue
        helpers: list[str] = []
        for call in CALL.findall(body):
            text = routines.get(call.lower())
            if text and text not in helpers:
                helpers.append(text)
            if len(helpers) >= 3:
                break
        writes = re.search(r"response\.write", body, re.I) or any(re.search(r"response\.write", h, re.I) for h in helpers)
        if not writes:
            continue
        text = body + ("\n\n' Functions this branch calls:\n" + "\n\n".join(helpers) if helpers else "")
        for name in names:
            if name not in seen:
                seen.add(name)
                found.append((name, text[:CONTROL_CODE_MAX]))
    return found


def expand_control_screens(records: list[dict], read_source: Callable[[str], str | None]):
    """Replaces each classic ASP page that switches on ControlName with one record per branch. Returns the new
    records and a reader that gives each branch its own code."""
    bodies: dict[str, dict[str, str]] = {}
    out: list[dict] = []
    for r in records:
        if is_screen_file(r) and "control" not in r and r.get("path", "").lower().endswith(".asp"):
            code = read_source(r["path"])
            branches = split_control_screens(code) if code else []
            if branches:
                bodies[r["path"]] = dict(branches)
                for name, _ in branches:
                    out.append({"path": f"{r['path']}?ControlName={name}", "category": "template",
                                "name": screen_label(name), "control": name, "source": r["path"]})
                continue
        out.append(r)

    def read(path: str) -> str | None:
        if "?ControlName=" in path:
            source, _, name = path.partition("?ControlName=")
            return bodies.get(source, {}).get(name)
        return read_source(path)

    return out, read


def screen_label(name: str) -> str:
    words = re.sub(r"[_]+", " ", name).strip()
    return words[:1].upper() + words[1:]


def screen_problem(html: str) -> str | None:
    """Returns why a drawing is refused, or None when it may be sent."""
    if not isinstance(html, str) or len(html) < SCREEN_MIN_CHARS or len(html) > SCREEN_MAX_CHARS:
        return "Each screen must be HTML of 50 to 40,000 characters."
    if not re.search(r"<html|<body|<!doctype", html, re.I):
        return "Each screen must be a complete HTML page."
    if any(rx.search(html) for rx in REFUSED):
        return "A screen used something a drawing may not use: scripts, links to other sites, forms or frames."
    return None


def screen_context(records: list[dict], path: str, limit: int = 12, path_limit: int = 60) -> str:
    """What the application is about, from the other files: their names and the purposes recorded for them.
    The names often say most (Projects, Tickets, Login), so a drawing stays in the application's subject."""
    purposes: list[str] = []
    seen: set[str] = set()
    names: list[str] = []
    for r in records:
        if r.get("path") == path:
            continue
        if len(names) < path_limit:
            names.append(r["path"])
        purpose = r.get("purpose")
        if purpose and purpose not in seen and len(purposes) < limit and "not yet classified" not in purpose:
            seen.add(purpose)
            purposes.append(f"- {r['path']}: {purpose}")
    parts = ["Files in the application: " + (", ".join(names) or "none")]
    if purposes:
        parts.append("What some of them are for:\n" + "\n".join(purposes))
    return "\n".join(parts)


def build_screen_text(path: str, code: str, context: str) -> str:
    return (f"Other files in this application, with what each is for:\n{context}\n\n"
            f"File path: {path}\n\n<file>\n{code}\n</file>")


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
    html = tidy_page(text[start.start():].strip())
    problem = screen_problem(html)
    return (html, None) if problem is None else (None, problem)


# Tags that do nothing harmful in a drawing but trip the refusal rules: page metadata, extra links and
# form wrappers the model adds out of habit. They are removed, not refused. Scripts, frames, outside
# links and event handlers are still refused.
TIDY = [
    re.compile(r"<\s*(meta|base|link)\b[^>]*>", re.I),
    re.compile(r"<\s*/?\s*form\b[^>]*>", re.I),
]


def tidy_page(html: str) -> str:
    for rx in TIDY:
        html = rx.sub("", html)
    return html


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
        screens.append({"path": record["path"], "name": record.get("name") or screen_name(record["path"]), "html": html})
        stats["drawn"] += 1
    return screens, stats


def post_screens_done(callback: str, analysis_id: str, secret: str, opener=urllib.request.urlopen) -> int:
    """Tells the API the screens run has finished, with or without screens. Returns the HTTP status (200 when recorded)."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/screens-done"
    req = urllib.request.Request(url, data=b"{}", method="POST", headers={
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


def post_screens(callback: str, analysis_id: str, secret: str, screens: list[dict], opener=urllib.request.urlopen,
                 add: bool = False) -> int:
    """Sends the drawings to the API. Returns the HTTP status (201 when saved).
    add=True keeps the screens already saved and adds only the paths that have none (a redraw)."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/screens"
    mode = "add" if add else "replace"
    req = urllib.request.Request(url, data=json.dumps({"mode": mode, "screens": screens}).encode("utf-8"), method="POST", headers={
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
