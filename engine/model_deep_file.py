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
MAX_RULES = 60
MAX_EXAMPLES = 120
MAX_DATA_ITEMS = 40
MAX_VALUES = 30
MAX_RULE_TEXT = 300
MAX_TABLES = 40
MAX_QUERIES = 60
MAX_FIELDS = 60
OPERATIONS = ("SELECT", "INSERT", "UPDATE", "DELETE")

INSTRUCTIONS = (
    "You describe one source file of a legacy application, in plain language for a non-engineer. "
    "Reply with JSON only and no other text, with these keys: "
    "file_purpose (one sentence on what the file does for the business), "
    "file_user_stories (short user stories, as 'As a <role> I can <action> so that <result>'), "
    "functions (a list; each item has: name, the function or procedure name exactly as the code writes it, "
    "purpose (one sentence), user_stories (short user stories for this function), "
    "calls (names of the functions, procedures or programs it calls, exactly as the code writes them)), "
    "rules (the business rules the code decides or enforces; each has: id 'R1', 'R2' and so on; statement (one sentence "
    "in plain words); condition (when it applies); outcome (what happens); values (literal values the rule uses, such as "
    "allowed file types, exactly as the code writes them); data (table or field names the rule reads or writes, exactly "
    "as the code writes them); function (the function it is in, exactly as the code writes it, or empty); lines (the "
    "first and last line numbers of the code for this rule, counted from 1)), "
    "examples (for each rule, up to two cases; each has: rule (the rule's id), given (the input or state), expect (the "
    "result)), "
    "data_access (for each function that reads or writes data; each has: function, reads (names), writes (names), "
    "exactly as the code writes them), "
    "database (the database tables the code uses, and the queries it runs. tables: each has name (the table, exactly as "
    "the code writes it), operations (any of SELECT, INSERT, UPDATE, DELETE), fields (the column names the code uses, "
    "exactly as written). queries: each has function (exactly as the code writes it, or empty), operation (one of SELECT, "
    "INSERT, UPDATE, DELETE), tables (names), purpose (one sentence on what the query does for the business). Use empty "
    "lists when the file has no database access). "
    "Use only names and values that appear in the code. Never include code, names of people, or real values such as "
    "IDs, addresses or keys."
)

FENCE = re.compile(r"^```[A-Za-z]*\s*\n|\n?```\s*$")


def _names(value, code: str, limit_count: int) -> tuple[list[str], int]:
    """The names in a list that the code contains, and how many were dropped."""
    if not isinstance(value, list):
        return [], 0
    kept: list[str] = []
    dropped = 0
    for item in value[:limit_count * 2]:
        name = str(item or "").strip()[:MAX_NAME] if isinstance(item, str) else ""
        if not name:
            continue
        if appears_in(name, code) and name not in kept:
            kept.append(name)
        else:
            dropped += 1
    return kept[:limit_count], dropped


def _rules(value, code: str, function_names: set[str]) -> tuple[list[dict], int]:
    """The business rules, with values and data names the code contains, and line ranges inside the file."""
    if not isinstance(value, list):
        return [], 0
    line_count = code.count("\n") + 1
    rules: list[dict] = []
    dropped = 0
    for item in value[:MAX_RULES * 2]:
        if not isinstance(item, dict):
            dropped += 1
            continue
        statement = str(item.get("statement") or "").strip()[:MAX_RULE_TEXT]
        if not statement:
            dropped += 1
            continue
        rule_id = str(item.get("id") or f"R{len(rules) + 1}").strip()[:12] or f"R{len(rules) + 1}"
        values, dropped_values = _names(item.get("values"), code, MAX_VALUES)
        data, dropped_data = _names(item.get("data"), code, MAX_DATA_ITEMS)
        dropped += dropped_values + dropped_data
        function = str(item.get("function") or "").strip()[:MAX_NAME]
        if function and not appears_in(function, code):
            function = ""
            dropped += 1
        lines = None
        raw_lines = item.get("lines")
        if isinstance(raw_lines, list) and len(raw_lines) == 2 and all(isinstance(n, int) for n in raw_lines):
            first, last = raw_lines
            if 1 <= first <= last <= line_count:
                lines = [first, last]
        rules.append({
            "id": rule_id,
            "statement": statement,
            "condition": str(item.get("condition") or "").strip()[:MAX_RULE_TEXT],
            "outcome": str(item.get("outcome") or "").strip()[:MAX_RULE_TEXT],
            "values": values,
            "data": data,
            "function": function,
            "lines": lines,
        })
    return rules[:MAX_RULES], dropped


def _examples(value, rule_ids: set[str]) -> tuple[list[dict], int]:
    """The worked cases, kept only for rules that exist."""
    if not isinstance(value, list):
        return [], 0
    kept: list[dict] = []
    dropped = 0
    for item in value[:MAX_EXAMPLES * 2]:
        if not isinstance(item, dict):
            dropped += 1
            continue
        rule = str(item.get("rule") or "").strip()
        given = str(item.get("given") or "").strip()[:MAX_RULE_TEXT]
        expect = str(item.get("expect") or "").strip()[:MAX_RULE_TEXT]
        if rule in rule_ids and given and expect:
            kept.append({"rule": rule, "given": given, "expect": expect})
        else:
            dropped += 1
    return kept[:MAX_EXAMPLES], dropped


def _data_access(value, code: str, function_names: set[str]) -> tuple[list[dict], int]:
    """What each function reads and writes, with only the names the code contains."""
    if not isinstance(value, list):
        return [], 0
    kept: list[dict] = []
    dropped = 0
    for item in value[:MAX_FUNCTIONS]:
        if not isinstance(item, dict):
            dropped += 1
            continue
        function = str(item.get("function") or "").strip()[:MAX_NAME]
        if not function or not appears_in(function, code):
            dropped += 1
            continue
        reads, dropped_reads = _names(item.get("reads"), code, MAX_DATA_ITEMS)
        writes, dropped_writes = _names(item.get("writes"), code, MAX_DATA_ITEMS)
        dropped += dropped_reads + dropped_writes
        if reads or writes:
            kept.append({"function": function, "reads": reads, "writes": writes})
    return kept, dropped


def _database(value, code: str, function_names: set[str]) -> tuple[dict, int]:
    """The tables and queries the code contains. A table or column the code does not contain is dropped and counted."""
    empty = {"tables": [], "queries": []}
    if not isinstance(value, dict):
        return empty, 0
    dropped = 0
    tables: list[dict] = []
    known: set[str] = set()
    raw_tables = value.get("tables") if isinstance(value.get("tables"), list) else []
    for item in raw_tables[:MAX_TABLES * 2]:
        if not isinstance(item, dict):
            dropped += 1
            continue
        name = str(item.get("name") or "").strip()[:MAX_NAME]
        if not name or not appears_in(name, code) or name.lower() in known:
            dropped += 1
            continue
        operations = []
        for op in item.get("operations") if isinstance(item.get("operations"), list) else []:
            text = str(op or "").strip().upper()
            if text in OPERATIONS and text not in operations:
                operations.append(text)
            elif text:
                dropped += 1
        fields, dropped_fields = _names(item.get("fields"), code, MAX_FIELDS)
        dropped += dropped_fields
        known.add(name.lower())
        tables.append({"name": name, "operations": operations, "fields": fields})
    queries: list[dict] = []
    raw_queries = value.get("queries") if isinstance(value.get("queries"), list) else []
    for item in raw_queries[:MAX_QUERIES * 2]:
        if not isinstance(item, dict):
            dropped += 1
            continue
        operation = str(item.get("operation") or "").strip().upper()
        function = str(item.get("function") or "").strip()[:MAX_NAME]
        if operation not in OPERATIONS or (function and not appears_in(function, code)):
            dropped += 1
            continue
        query_tables, dropped_tables = _names(item.get("tables"), code, MAX_TABLES)
        dropped += dropped_tables
        if not query_tables:
            dropped += 1
            continue
        queries.append({
            "function": function,
            "operation": operation,
            "tables": query_tables,
            "purpose": str(item.get("purpose") or "").strip()[:MAX_RULE_TEXT],
        })
    return {"tables": tables[:MAX_TABLES], "queries": queries[:MAX_QUERIES]}, dropped


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

    function_names = {f["name"] for f in functions}
    rules, dropped_rules = _rules(data.get("rules"), code, function_names)
    rule_ids = {r["id"] for r in rules}
    examples, dropped_examples = _examples(data.get("examples"), rule_ids)
    data_access, dropped_access = _data_access(data.get("data_access"), code, function_names)
    database, dropped_database = _database(data.get("database"), code, function_names)
    dropped += dropped_rules + dropped_examples + dropped_access + dropped_database

    return {
        "file_purpose": purpose.strip()[:MAX_PURPOSE],
        "file_user_stories": _stories(data.get("file_user_stories"), MAX_STORIES),
        "functions": functions,
        "rules": rules,
        "examples": examples,
        "data_access": data_access,
        "database": database,
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
