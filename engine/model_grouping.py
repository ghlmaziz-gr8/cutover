"""Feature grouping: the model proposes capabilities, each holding features, from the approved business summaries
of one analysis.

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
MAX_CAPABILITIES = 15
MAX_GROUP_NAME = 80
MAX_SUMMARY = 300

INSTRUCTIONS = (
    "You group approved business descriptions of source files into capabilities, for a non-engineer. "
    "A capability is a named business area, and it holds one or more features. "
    "Reply with JSON only and no other text, in this form: "
    '{"capabilities": [{"name": "short capability name", "summary": "one sentence", "features": ['
    '{"name": "short feature name", "summary": "one sentence", "paths": ["file path", "..."]}]}]}. '
    "Use only the file paths you are given. Every file goes into at least one feature. "
    "A feature belongs to one capability only. A file may appear in more than one feature when it does more than one job. "
    f"No more than {MAX_CAPABILITIES} capabilities and {MAX_GROUPS} features in total. "
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


def _feature(item: dict, allowed: set[str]) -> dict | None:
    name = str(item.get("name") or "").strip()[:MAX_GROUP_NAME]
    summary = str(item.get("summary") or "").strip()[:MAX_SUMMARY]
    paths: list[str] = []
    for path in item.get("paths") or []:
        if isinstance(path, str) and path in allowed and path not in paths:
            paths.append(path)
    return {"name": name, "summary": summary, "paths": paths} if name and paths else None


def clean_grouping(reply, allowed: set[str]) -> tuple[list[dict], list[dict] | None] | None:
    """The features and their capabilities. Each feature is listed once, in one capability; a feature is
    kept only with a name and at least one allowed file. None when the reply has no usable features.
    An older reply with groups and no capabilities gives the features and no capabilities (None)."""
    if not isinstance(reply, str):
        return None
    text = FENCE.sub("", reply.strip()).strip()
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    if isinstance(data.get("capabilities"), list):
        groups: list[dict] = []
        capabilities: list[dict] = []
        for cap in data["capabilities"][:MAX_CAPABILITIES]:
            if not isinstance(cap, dict) or not isinstance(cap.get("features"), list):
                continue
            indexes: list[int] = []
            for item in cap["features"]:
                if not isinstance(item, dict) or len(groups) >= MAX_GROUPS:
                    continue
                feature = _feature(item, allowed)
                if feature:
                    groups.append(feature)
                    indexes.append(len(groups) - 1)
            name = str(cap.get("name") or "").strip()[:MAX_GROUP_NAME]
            summary = str(cap.get("summary") or "").strip()[:MAX_SUMMARY]
            if name and indexes:
                capabilities.append({"name": name, "summary": summary, "features": indexes})
        return (groups, capabilities) if groups else None
    raw = data.get("groups")
    if not isinstance(raw, list):
        return None
    groups = [f for f in (_feature(item, allowed) for item in raw[:MAX_GROUPS] if isinstance(item, dict)) if f]
    return (groups, None) if groups else None


def clean_grouping_reply(reply, allowed: set[str]) -> list[dict] | None:
    """The features only, with only the allowed files. A file may be in more than one feature, and is listed once in each."""
    got = clean_grouping(reply, allowed)
    return got[0] if got else None


def group_features(sources: list[dict], ask: Callable[[str], str]) -> dict:
    """The proposed capabilities and features, or a reason they were not kept. Never raises."""
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
    got = clean_grouping(reply, {item["path"] for item in sources})
    if got is None:
        return {"status": "unusable", "reason": "The model did not group the files in the form needed, so nothing was kept."}
    groups, capabilities = got
    kinds = scan(json.dumps({"groups": groups, "capabilities": capabilities}, ensure_ascii=False))
    if kinds:
        return {"status": "blocked", "stage": "reply", "kinds": kinds,
                "reason": "The grouping held text that looks like personal data, so it was not kept."}
    return {"status": "ok", "groups": groups, "capabilities": capabilities}
