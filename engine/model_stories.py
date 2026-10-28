"""Feature user stories: the model drafts stories for one feature from the approved rules of its files.

It sees only approved text: each file's purpose, its user stories, and its business rules with their line numbers.
Every story must cite rules that exist, as a file and rule ID pair. Lines are taken from the rules, not from the
model. Anything else is dropped and counted. Stdlib only, plus the engine's own checks.
"""
from __future__ import annotations

import json
import re
from typing import Callable

from privacy_scan import scan

MAX_STORIES = 12
MAX_STORY = 300
MAX_FILES = 200
MAX_RULES_PER_FILE = 60
MAX_CITES = 20
MAX_SOURCE_CHARS = 60_000

INSTRUCTIONS = (
    "You write user stories for one product feature of a legacy application, for a non-engineer. "
    "Reply with JSON only and no other text, in this form: "
    '{"stories": [{"story": "As a <role> I can <action> so that <result>.", '
    '"rules": [{"file": "file path", "id": "R1"}]}]}. '
    "Each story must cite the rules it is written from, using only the file paths and rule IDs you are given. "
    f"No more than {MAX_STORIES} stories. Never include code, names of people, or real values such as IDs, addresses or keys."
)

FENCE = re.compile(r"^```[A-Za-z]*\s*\n|\n?```\s*$")
STORY_SHAPE = re.compile(r"^As an? .+ I can .+ so that .+", re.IGNORECASE | re.DOTALL)


def _rule_lines(rule: dict) -> str:
    lines = rule.get("lines")
    if isinstance(lines, list) and len(lines) == 2:
        return f"lines {lines[0]}–{lines[1]}"
    return "no line range"


def build_user_text(feature: dict, sources: list[dict]) -> str:
    """The prompt for one feature. Only approved text: purposes, user stories, and rule statements with their lines."""
    out = [INSTRUCTIONS, "", f"Feature: {feature.get('name', '')}"]
    if feature.get("summary"):
        out.append(f"About: {feature['summary']}")
    for item in sources:
        content = item.get("content") or {}
        out.append("")
        out.append(f"File: {item.get('path', '')}")
        if content.get("file_purpose"):
            out.append(f"Purpose: {content['file_purpose']}")
        for story in (content.get("file_user_stories") or [])[:5]:
            out.append(f"Existing user story: {story}")
        for rule in (content.get("rules") or [])[:MAX_RULES_PER_FILE]:
            if not isinstance(rule, dict):
                continue
            text = f"Rule {rule.get('id', '')} ({_rule_lines(rule)}): {rule.get('statement', '')}"
            if rule.get("condition"):
                text += f" When: {rule['condition']}."
            if rule.get("outcome"):
                text += f" Then: {rule['outcome']}."
            out.append(text)
    return "\n".join(out)


def allowed_rules(sources: list[dict]) -> dict[tuple[str, str], list | None]:
    """Every rule the model may cite, keyed by (file, rule ID), with its line range."""
    found: dict[tuple[str, str], list | None] = {}
    for item in sources:
        path = item.get("path", "")
        for rule in (item.get("content") or {}).get("rules") or []:
            if isinstance(rule, dict) and isinstance(rule.get("id"), str):
                lines = rule.get("lines")
                found[(path, rule["id"])] = lines if isinstance(lines, list) and len(lines) == 2 else None
    return found


def clean_story_reply(reply, sources: list[dict]) -> tuple[list[dict], int] | None:
    """The stories that cite rules the model was given, with line ranges from the rules. None when the reply has no usable shape."""
    if not isinstance(reply, str):
        return None
    text = FENCE.sub("", reply.strip()).strip()
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
    raw = data.get("stories") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return None
    rules = allowed_rules(sources)
    stories: list[dict] = []
    dropped = 0
    for item in raw[:MAX_STORIES * 2]:
        if not isinstance(item, dict):
            dropped += 1
            continue
        story = str(item.get("story") or "").strip()[:MAX_STORY]
        cites = []
        for cite in (item.get("rules") if isinstance(item.get("rules"), list) else [])[:MAX_CITES]:
            if not isinstance(cite, dict):
                continue
            key = (str(cite.get("file") or ""), str(cite.get("id") or ""))
            if key in rules and key not in [(c["file"], c["id"]) for c in cites]:
                lines = rules[key]
                cites.append({"file": key[0], "id": key[1], "lines": lines})
        if not STORY_SHAPE.match(story) or not cites:
            dropped += 1
            continue
        stories.append({"story": story, "rules": cites})
    return stories[:MAX_STORIES], dropped


def draft_feature_stories(feature: dict, sources: list[dict], ask: Callable[[str], str]) -> dict:
    """The stories for one feature, or a reason they were not kept. Never raises."""
    if not sources:
        return {"status": "refused", "reason": "No approved rules for these files yet."}
    text = build_user_text(feature, sources[:MAX_FILES])
    if len(text) > MAX_SOURCE_CHARS:
        return {"status": "refused", "reason": "The approved rules for this feature are too large to write in one step."}
    kinds = scan(text)
    if kinds:
        return {"status": "blocked", "stage": "request", "kinds": kinds,
                "reason": "The approved text holds something that looks like personal data, so nothing was sent."}
    try:
        reply = ask(text)
    except Exception as err:  # The provider may be down or refuse the key. The run says why, never the reply.
        return {"status": "failed", "reason": f"The language model did not answer ({type(err).__name__})."}
    cleaned = clean_story_reply(reply, sources)
    if cleaned is None:
        return {"status": "unusable", "reason": "The model did not reply in the form needed, so nothing was kept."}
    stories, dropped = cleaned
    if not stories:
        return {"status": "unusable", "reason": "No story cited rules that exist, so nothing was kept.", "dropped": dropped}
    kinds = scan(json.dumps(stories, ensure_ascii=False))
    if kinds:
        return {"status": "blocked", "stage": "reply", "kinds": kinds,
                "reason": "The reply held something that looks like personal data, so it was not kept."}
    return {"status": "ok", "stories": stories, "dropped": dropped}
