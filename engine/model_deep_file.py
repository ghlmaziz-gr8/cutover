"""Deep assessment of one source file: what it does, its functions, what they call, and user stories.

The model replies with JSON of fixed fields. Every function name and every called name must appear word for word in
the file, as the code writes it. Any name that does not is dropped, and the drop is counted. A file's account is never
kept with names the file does not contain. The file is checked for personal data before it is sent, and the reply is
checked again before it is kept. Results from this path are marked model_read, with lower confidence than a rule pack.
Stdlib only, plus the engine's own checks.
"""
from __future__ import annotations

import json
import re
from typing import Callable

from model_convert import MAX_SOURCE_CHARS
from model_purposes import explain_failure
from privacy_scan import scan

CONFIDENCE = "model_read"
MAX_FUNCTIONS = 200
MAX_CALLS = 100
MAX_STORIES = 8
MAX_NAME = 120
MAX_STORY = 300
MAX_PURPOSE = 600

INSTRUCTIONS = (
    "You describe one source file of a legacy application, in plain language for a non-engineer. "
    "Reply with JSON only and no other text, with these keys: "
    "file_purpose (one sentence on what the file does for the business), "
    "file_user_stories (short user stories, as 'As a <role> I can <action> so that <result>'), "
    "functions (a list; each item has: name, the function or procedure name exactly as the code writes it, "
    "purpose (one sentence), user_stories (short user stories for this function), "
    "calls (names of the functions, procedures or programs it calls, exactly as the code writes them)). "
    "Use only names that appear in the code. Never include code, names of people, or real values such as IDs, "
    "addresses or keys."
)

FENCE = re.compile(r"^```[A-Za-z]*\s*\n|\n?```\s*$")


def build_user_text(path: str, code: str) -> str:
    return f"{INSTRUCTIONS}\n\nFile: {path}\n\n```\n{code}\n```"


def appears_in(name: str, code: str) -> bool:
    """True when the name occurs in the code as a whole name, ignoring case, as legacy code often does."""
    if not name:
        return False
    pattern = r"(?<![A-Za-z0-9_])" + re.escape(name) + r"(?![A-Za-z0-9_])"
    return re.search(pattern, code, re.IGNORECASE) is not None


def _stories(value, limit_count: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out = [str(item).strip()[:MAX_STORY] for item in value if isinstance(item, str)]
    return [item for item in out if item][:limit_count]


def parse_object(text: str) -> dict | None:
    """The JSON object in a reply. A reply may put a sentence before or after the object; the object is still used."""
    try:
        data = json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            data = json.loads(text[start:end + 1])
        except ValueError:
            return None
    return data if isinstance(data, dict) else None


def reply_shape(reply) -> str:
    """What a reply looks like, without its text: its length and where a JSON object starts. Written to the log
    so a reply that could not be read can be explained, without copying the file's code or the reply into the log."""
    if not isinstance(reply, str):
        return f"not text ({type(reply).__name__})"
    stripped = reply.strip()
    first = stripped[:1] or "(empty)"
    return f"chars={len(reply)} first={first!r} has_object={'{' in stripped and '}' in stripped}"


def clean_reply(reply, code: str) -> tuple[dict, int] | None:
    """The account with only the names the code contains, and how many names were dropped. None when the reply
    does not have the form needed."""
    if not isinstance(reply, str):
        return None
    text = FENCE.sub("", reply.strip()).strip()
    data = parse_object(text)
    if data is None:
        return None
    purpose = data.get("file_purpose")
    if not isinstance(purpose, str) or not purpose.strip():
        return None
    # A file with no functions may leave the list out or send it empty.
    raw = data.get("functions", [])
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        return None

    dropped = 0
    functions: list[dict] = []
    seen: set[str] = set()
    for item in raw[:MAX_FUNCTIONS]:
        if not isinstance(item, dict):
            dropped += 1
            continue
        name = str(item.get("name") or "").strip()[:MAX_NAME]
        if not appears_in(name, code) or name.lower() in seen:
            dropped += 1
            continue
        seen.add(name.lower())
        calls: list[str] = []
        for call in (item.get("calls") if isinstance(item.get("calls"), list) else [])[:MAX_CALLS]:
            call_name = str(call or "").strip()[:MAX_NAME] if isinstance(call, str) else ""
            if call_name and appears_in(call_name, code) and call_name.lower() != name.lower() and call_name not in calls:
                calls.append(call_name)
            elif call_name:
                dropped += 1
        functions.append({
            "name": name,
            "purpose": str(item.get("purpose") or "").strip()[:MAX_STORY],
            "user_stories": _stories(item.get("user_stories"), MAX_STORIES),
            "calls": calls,
        })

    return {
        "file_purpose": purpose.strip()[:MAX_PURPOSE],
        "file_user_stories": _stories(data.get("file_user_stories"), MAX_STORIES),
        "functions": functions,
    }, dropped


def assess_file(path: str, code: str, ask: Callable[[str], str]) -> dict:
    """One deep assessment, or a reason it was not kept. Never raises."""
    base = {"path": path, "confidence": CONFIDENCE}
    if not code or not code.strip():
        return {**base, "status": "refused", "reason": "The file is empty."}
    if len(code) > MAX_SOURCE_CHARS:
        return {**base, "status": "refused", "reason": "The file is too large to assess in one step."}
    kinds = scan(code)
    if kinds:
        return {**base, "status": "blocked", "stage": "request", "kinds": kinds,
                "reason": "The file holds text that looks like personal data, so nothing was sent."}
    try:
        reply = ask(build_user_text(path, code))
    except Exception as err:  # The provider may be down, cut the reply short, or refuse the key. The reason says which.
        return {**base, "status": "failed", "reason": explain_failure(err)}
    cleaned = clean_reply(reply, code)
    if cleaned is None:
        return {**base, "status": "unusable", "reason": "The model did not reply in the form needed, so nothing was kept.",
                "shape": reply_shape(reply)}
    content, dropped = cleaned
    kinds = scan(json.dumps(content, ensure_ascii=False))
    if kinds:
        return {**base, "status": "blocked", "stage": "reply", "kinds": kinds,
                "reason": "The reply held text that looks like personal data, so it was not kept."}
    return {**base, "status": "ok", "content": content, "dropped": dropped}
