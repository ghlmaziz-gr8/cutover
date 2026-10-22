"""Stage 3: converts one file to the chosen target design, with the workspace's own language model.

Rules this file keeps:
- Only one file goes to the model, with the design name. Its text is checked first; if it holds a pattern that looks
  like personal data, nothing is sent and only the kinds found are reported.
- The reply is cleaned (no code fences, no commentary). It is checked again; a reply that holds such a pattern is
  dropped. The proposal is never merged or deployed here: it is written to a branch for review.
- Nothing here raises. Any failure gives a status and a plain reason.
Stdlib only.
"""
from __future__ import annotations

import re
from typing import Callable

from privacy_scan import scan

MAX_SOURCE_CHARS = 40_000
MAX_REPLY_CHARS = 60_000
CONVERT_MAX_TOKENS = 4000
TEMPLATES = {
    "web-modern": "a modern web front end over an API, one page per screen and one route per endpoint",
    "services-data": "services over a modern database, with the business rules moved into services",
    "lift-contain": "the same application in containers, with its dependencies upgraded",
}

CONVERT_SYSTEM = (
    "You convert one file of a legacy application to the design named in the request. "
    "Reply with only the converted file: no explanation, no markdown fences, no commentary. "
    "Keep the same behaviour and the same steps. "
    "Where the file holds a real value (a name, a number, an address, a record, a secret), write a placeholder such as "
    "EXAMPLE_VALUE instead, and never invent a real-looking one. "
    "If the file cannot be converted safely, reply with exactly: CANNOT_CONVERT"
)


def build_user_text(path: str, code: str, template: str) -> str:
    design = TEMPLATES.get(template, template)
    return f"Target design: {design}.\nFile name: {path}\n\nFile:\n{code}"


def clean_reply(reply: str) -> str | None:
    """The converted file without fences or a preface. None if the reply is empty or says it cannot convert."""
    text = (reply or "").strip()
    fenced = re.match(r"^```[a-zA-Z0-9_-]*\n(.*?)\n?```\s*$", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    if not text or text == "CANNOT_CONVERT" or len(text) > MAX_REPLY_CHARS:
        return None
    return text


def convert_file(path: str, code: str, template: str, ask: Callable[[str], str]) -> dict:
    """One converted file, or a reason it could not be kept. Never raises."""
    base = {"path": path, "template": template}
    if template not in TEMPLATES:
        return {**base, "status": "refused", "reason": "The design is not one of the three options."}
    if not code or not code.strip():
        return {**base, "status": "refused", "reason": "The file is empty."}
    if len(code) > MAX_SOURCE_CHARS:
        return {**base, "status": "refused", "reason": "The file is too large to convert in one step."}
    kinds = scan(code)
    if kinds:
        return {**base, "status": "blocked", "stage": "request", "kinds": kinds,
                "reason": "The file holds text that looks like personal data, so nothing was sent."}
    try:
        reply = ask(build_user_text(path, code, template))
    except Exception:  # The provider may be down or the key stopped working; the reason stays generic.
        return {**base, "status": "failed", "reason": "The language model did not answer. Nothing was kept."}
    text = clean_reply(reply)
    if text is None:
        return {**base, "status": "unusable", "reason": "The model could not convert this file safely."}
    kinds = scan(text)
    if kinds:
        return {**base, "status": "blocked", "stage": "reply", "kinds": kinds,
                "reason": "The proposal held text that looks like personal data, so it was not kept."}
    return {**base, "status": "ok", "proposed": text}
