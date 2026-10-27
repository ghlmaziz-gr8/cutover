"""Feature grouping: the model proposes features from the approved business summaries of one analysis.

It sees only the approved text (purposes, business rules and similar), never source code. The reply must be JSON
of a fixed form and may name only the files it was given. Anything else is unusable, and nothing is kept.
Stdlib only, plus the engine's own checks.
"""
from __future__ import annotations

import json
import re
from typing import Callable

from privacy_scan import scan

MAX_FILES = 300
MAX_SOURCE_CHARS = 60_000
MAX_GROUPS = 30
MAX_GROUP_NAME = 80
MAX_SUMMARY = 300

INSTRUCTIONS = (
    "You group approved business descriptions of source files into product features, for a non-engineer. "
    "Reply with JSON only and no other text, in this form: "
    '{"groups": [{"name": "short feature name", "summary": "one sentence", "paths": ["file path", "..."]}]}. '
    "Use only the file paths you are given, each file in at most one group, and no more than 30 groups. "
    "Never include names of people, real values such as IDs, addresses or keys, or any code."
)

FENCE = re.compile(r"^```[A-Za-z]*\s*\n|\n?```\s*$")


def build_user_text(sources: list[dict]) -> str:
    lines = []
    for item in sources:
        content = item.get("content") or {}
        parts = []
        for key in ("purpose", "business_rules", "workflows"):
            value = content.get(key)
            if isinstance(value, list):
                value = "; ".join(str(v) for v in value)
            if value:
                parts.append(f"{key}: {value}")
        lines.append(f"- {item['path']}: " + " | ".join(parts))
    return f"{INSTRUCTIONS}\n\nFiles:\n" + "\n".join(lines)


def clean_grouping_reply(reply, allowed: set[str]) -> list[dict] | None:
    """The groups, with only the allowed files, each in one group. None when the reply has no usable groups."""
    if not isinstance(reply, str):
        return None
    text = FENCE.sub("", reply.strip()).strip()
    try:
        data = json.loads(text)
    except ValueError:
        return None
    raw = data.get("groups") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return None
    seen: set[str] = set()
    groups: list[dict] = []
    for item in raw[:MAX_GROUPS]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:MAX_GROUP_NAME]
        summary = str(item.get("summary") or "").strip()[:MAX_SUMMARY]
        paths = []
        for path in item.get("paths") or []:
            if isinstance(path, str) and path in allowed and path not in seen:
                seen.add(path)
                paths.append(path)
        if name and paths:
            groups.append({"name": name, "summary": summary, "paths": paths})
    return groups or None


def group_features(sources: list[dict], ask: Callable[[str], str]) -> dict:
    """The proposed features, or a reason they were not kept. Never raises."""
    if not sources:
        return {"status": "refused", "reason": "No approved business assessments to group."}
    if len(sources) > MAX_FILES:
        return {"status": "refused", "reason": f"Too many approved files to group in one step (over {MAX_FILES})."}
    text = build_user_text(sources)
    if len(text) > MAX_SOURCE_CHARS:
        return {"status": "refused", "reason": "The approved summaries are too large to group in one step."}
    kinds = scan(text)
    if kinds:
        return {"status": "blocked", "stage": "request", "kinds": kinds,
                "reason": "The summaries hold text that looks like personal data, so nothing was sent."}
    try:
        reply = ask(text)
    except Exception:  # The provider may be down or the key stopped working; the reason stays generic.
        return {"status": "failed", "reason": "The language model did not answer. Nothing was kept."}
    groups = clean_grouping_reply(reply, {item["path"] for item in sources})
    if groups is None:
        return {"status": "unusable", "reason": "The model did not group the files in the form needed, so nothing was kept."}
    kinds = scan(json.dumps(groups, ensure_ascii=False))
    if kinds:
        return {"status": "blocked", "stage": "reply", "kinds": kinds,
                "reason": "The grouping held text that looks like personal data, so it was not kept."}
    return {"status": "ok", "groups": groups}
