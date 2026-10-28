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
from model_deep_file import appears_in
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
    "questions (things this file alone does not show), "
    "rules (the rules the code enforces, each an object: id (R1, R2 and so on), statement (one plain sentence), "
    "function (the function that enforces it, exactly as the code writes it), lines (the first and last line numbers of "
    "that code in the file)). "
    "examples (up to two per rule, each an object: rule (the rule's id), given (a plain input or state, never a real value), "
    "expect (the plain result)). "
    "Never include code, file contents, names of people, or real values such as IDs, addresses or keys."
)

# The rules the statements rest on, and the worked examples for them. Each function name must occur in the file.
MAX_RULES = 10
MAX_EXAMPLES = 20
RULE_TEXT = 240
EXAMPLE_TEXT = 160
FUNCTION_NAME = 120

FENCE = re.compile(r"^```[A-Za-z]*\s*\n|\n?```\s*$")


def build_user_text(path: str, code: str) -> str:
    return f"{INSTRUCTIONS}\n\nFile: {path}\n\n```\n{code}\n```"


def _lines(raw) -> list[int] | None:
    if isinstance(raw, list) and len(raw) == 2 and all(isinstance(n, int) and not isinstance(n, bool) for n in raw):
        first, last = raw
        if 1 <= first <= last:
            return [first, last]
    return None


def _rules(value, code: str) -> tuple[list[dict], int, list[dict]]:
    """The rules whose function the code contains, the count of names dropped, and the functions they name."""
    if not isinstance(value, list):
        return [], 0, []
    kept: list[dict] = []
    functions: list[dict] = []
    seen_ids: set[str] = set()
    seen_functions: set[str] = set()
    dropped = 0
    for item in value[:MAX_RULES * 2]:
        if not isinstance(item, dict):
            dropped += 1
            continue
        function = str(item.get("function") or "").strip()[:FUNCTION_NAME]
        statement = str(item.get("statement") or "").strip()[:RULE_TEXT]
        if not statement:
            continue
        if not function or not appears_in(function, code):
            dropped += 1
            continue
        rule_id = str(item.get("id") or "").strip()[:12] or f"R{len(kept) + 1}"
        if rule_id in seen_ids:
            continue
        seen_ids.add(rule_id)
        lines = _lines(item.get("lines"))
        kept.append({"id": rule_id, "statement": statement, "function": function, "lines": lines})
        if function not in seen_functions:
            seen_functions.add(function)
            functions.append({"name": function, "lines": lines})
        if len(kept) == MAX_RULES:
            break
    return kept, dropped, functions


def _examples(value, rule_ids: set[str]) -> list[dict]:
    """The worked examples for the kept rules. An example for a rule that is not kept is left out."""
    if not isinstance(value, list):
        return []
    kept: list[dict] = []
    for item in value[:MAX_EXAMPLES * 2]:
        if not isinstance(item, dict) or str(item.get("rule") or "") not in rule_ids:
            continue
        given = str(item.get("given") or "").strip()[:EXAMPLE_TEXT]
        expect = str(item.get("expect") or "").strip()[:EXAMPLE_TEXT]
        if given and expect:
            kept.append({"rule": str(item["rule"]), "given": given, "expect": expect})
        if len(kept) == MAX_EXAMPLES:
            break
    return kept


def clean_reply(reply, code: str = "") -> dict | None:
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
    rules, dropped, functions = _rules(data.get("rules"), code)
    out["rules"] = rules
    out["functions"] = functions
    out["examples"] = _examples(data.get("examples"), {rule["id"] for rule in rules})
    out["dropped"] = dropped
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
    content = clean_reply(reply, code)
    if content is None:
        return {**base, "status": "unusable", "reason": "The model did not reply in the form needed, so nothing was kept."}
    kinds = scan(json.dumps(content, ensure_ascii=False))
    if kinds:
        return {**base, "status": "blocked", "stage": "reply", "kinds": kinds,
                "reason": "The reply held text that looks like personal data, so it was not kept."}
    return {**base, "status": "ok", "content": content}
