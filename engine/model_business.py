"""Business assessment of one source file, in plain language, for the portal.

The model replies with JSON of fixed short fields. Anything else is unusable, and nothing is kept.
The file is checked for personal data before it is sent, and the reply is checked again before it is kept.
Stdlib only, plus the engine's own checks.
"""
from __future__ import annotations

import json
import re
from typing import Callable

from model_convert import MAX_SOURCE_CHARS
from privacy_scan import scan

# The text fields, with their length limit.
TEXT_FIELDS = {"purpose": 600}
# The list fields, with the most items and the length of each item.
LIST_FIELDS = {
    "business_rules": (12, 300),
    "workflows": (8, 200),
    "data_used": (12, 120),
    "risks": (8, 200),
    "questions": (8, 200),
}

INSTRUCTIONS = (
    "You describe what one source file does for the business, in plain language for a non-engineer. "
    "Reply with JSON only and no other text, with these keys: "
    "purpose (one sentence), "
    "business_rules (short statements of rules the code enforces), "
    "workflows (business processes the file takes part in), "
    "data_used (kinds of information it reads or writes, never values), "
    "risks (things a modernization must keep safe), "
    "questions (things this file alone does not show). "
    "Never include code, file contents, names of people, or real values such as IDs, addresses or keys."
)

FENCE = re.compile(r"^```[A-Za-z]*\s*\n|\n?```\s*$")


def build_user_text(path: str, code: str) -> str:
    return f"{INSTRUCTIONS}\n\nFile: {path}\n\n```\n{code}\n```"


def clean_reply(reply) -> dict | None:
    """The reply as the fixed fields, or None when it does not have the form needed."""
    if not isinstance(reply, str):
        return None
    text = FENCE.sub("", reply.strip()).strip()
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    out: dict = {}
    for key, limit in TEXT_FIELDS.items():
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            return None
        out[key] = value.strip()[:limit]
    for key, (count, limit) in LIST_FIELDS.items():
        value = data.get(key)
        if not isinstance(value, list):
            return None
        items = [str(item).strip()[:limit] for item in value if isinstance(item, (str, int, float))]
        out[key] = [item for item in items if item][:count]
    return out


def assess_file(path: str, code: str, ask: Callable[[str], str]) -> dict:
    """One business assessment, or a reason it was not kept. Never raises."""
    base = {"path": path}
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
    except Exception:  # The provider may be down or the key stopped working; the reason stays generic.
        return {**base, "status": "failed", "reason": "The language model did not answer. Nothing was kept."}
    content = clean_reply(reply)
    if content is None:
        return {**base, "status": "unusable", "reason": "The model did not reply in the form needed, so nothing was kept."}
    kinds = scan(json.dumps(content, ensure_ascii=False))
    if kinds:
        return {**base, "status": "blocked", "stage": "reply", "kinds": kinds,
                "reason": "The reply held text that looks like personal data, so it was not kept."}
    return {**base, "status": "ok", "content": content}
