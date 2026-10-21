"""Estimate when a legacy application was first written, with the workspace's own language model.

The rule-based estimate (engine/age.py) reads the years written in each file. This module gives the model that
same evidence, plus file names and the git dates, and asks for one answer. The answer is merged into the
history.origin block of findings.json as "model_estimate". The rule-based block is never replaced.

Rules this file keeps:
- The model sees only file names, the lines of eligible files that contain a year, and the rule-based summary.
  Each line is cut to LINE_CHARS characters, and the whole evidence to EVIDENCE_CHARS characters.
- The reply must be one JSON object with a valid earliest and typical year, a known confidence and short reasons.
  Anything else is dropped, and the rule-based estimate stays.
- A reason that repeats a run of the evidence text is dropped, so the reasons cannot quote the code.
- Git dates are shown to the model as weak evidence only: they say when this copy was committed.
Stdlib only.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

from age import MIN_YEAR, years_in_text

MODEL_CATEGORIES = {"source", "template", "database", "integration"}
MAX_EVIDENCE_FILES = 400
MAX_NAMES = 80
MAX_YEAR_LINES = 60
LINE_CHARS = 160
EVIDENCE_CHARS = 9_000
MAX_REASONS = 5
REASON_CHARS = 240
COPY_WINDOW = 30
CONFIDENCE = {"low", "medium", "high"}
ORIGIN_MAX_TOKENS = 600

ORIGIN_SYSTEM = (
    "You estimate when a legacy software application was first written, for a migration assessment. "
    "You are given evidence from its files: the years written in the code, the file names, and the git dates. "
    "Years in copyright lines and file headers usually show when the code was written. "
    "Git dates show when this copy was committed, so weigh them lightly. "
    "Reply with only one JSON object and no markdown, in this form: "
    '{"earliest_year": 2004, "typical_year": 2011, "confidence": "low", "reasons": ["short sentence"]}. '
    "confidence is low, medium or high. Give at most 5 reasons, each one short plain sentence. "
    "Do not quote code, names, values or data from the files."
)


def gather_evidence(records: list[dict], read_source: Callable[[str], str | None], now_year: int,
                    history: dict) -> str:
    """The text the model reads. Built only from the records, the rule-based origin and the git summary."""
    origin = history.get("origin") if isinstance(history.get("origin"), dict) else {}
    lines: list[str] = []
    if origin.get("earliest_year"):
        lines.append(f"Rule-based reading: earliest {origin['earliest_year']}, typical {origin['typical_year']}, "
                     f"latest {origin['latest_year']}, from {origin['files_with_years']} of "
                     f"{origin['files_scanned']} text files.")
    else:
        lines.append("Rule-based reading: no year is written in the text files.")
    if history.get("available"):
        lines.append(f"Git: first commit {history.get('first_commit')}, {history.get('total_commits')} commit(s). "
                     "This is when this copy was committed, not necessarily when the application was built.")
    else:
        lines.append("Git: no usable history.")

    eligible = [r for r in records if r.get("category") in MODEL_CATEGORIES][:MAX_EVIDENCE_FILES]
    names = [str(r.get("path", "")) for r in records if r.get("path")][:MAX_NAMES]
    lines.append("File names:")
    lines.extend(f"- {name}" for name in names)

    year_lines: list[str] = []
    for record in eligible:
        path = str(record.get("path", ""))
        text = read_source(path)
        if not text:
            continue
        for line in text[:20_000].splitlines():
            if years_in_text(line, now_year):
                year_lines.append(f"- {path}: {' '.join(line.split())[:LINE_CHARS]}")
                if len(year_lines) >= MAX_YEAR_LINES:
                    break
        if len(year_lines) >= MAX_YEAR_LINES:
            break
    lines.append("Lines with a year:")
    lines.extend(year_lines or ["- none"])
    return "\n".join(lines)[:EVIDENCE_CHARS]


def _copies(text: str, evidence: str) -> bool:
    """True if the text repeats a run of COPY_WINDOW characters from the evidence, ignoring case and spacing."""
    squashed = " ".join(evidence.lower().split())
    flat = " ".join(text.lower().split())
    return any(flat[i:i + COPY_WINDOW] in squashed for i in range(max(0, len(flat) - COPY_WINDOW + 1)))


def parse_reply(reply: str, now_year: int, evidence: str) -> dict | None:
    """Checks the model's reply. Returns the estimate, or None if it is not usable."""
    found = re.search(r"\{.*\}", reply or "", re.S)
    if not found:
        return None
    try:
        data = json.loads(found.group(0))
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    earliest, typical = data.get("earliest_year"), data.get("typical_year")
    if not all(isinstance(y, int) and not isinstance(y, bool) for y in (earliest, typical)):
        return None
    if not MIN_YEAR <= earliest <= typical <= now_year:
        return None
    confidence = data.get("confidence")
    if confidence not in CONFIDENCE:
        return None
    reasons: list[str] = []
    raw = data.get("reasons")
    for item in (raw if isinstance(raw, list) else [])[:MAX_REASONS]:
        if not isinstance(item, str):
            continue
        text = " ".join(item.split())[:REASON_CHARS]
        if text and not _copies(text, evidence):
            reasons.append(text)
    return {"earliest_year": earliest, "typical_year": typical, "confidence": confidence, "reasons": reasons}


def merge_into_findings(findings: Path, estimate: dict, provider: str) -> bool:
    """Writes the estimate into history.origin.model_estimate. Returns False if there is no origin block to merge into."""
    with open(findings, encoding="utf-8") as fh:
        report = json.load(fh)
    history = report.get("history") if isinstance(report, dict) else None
    if not isinstance(history, dict) or not isinstance(history.get("origin"), dict):
        return False
    history["origin"]["model_estimate"] = {**estimate, "provider": provider}
    with open(findings, "w", encoding="utf-8") as fh:
        json.dump(report, fh, separators=(",", ":"))
    return True


def run_origin(findings: Path, records: list[dict], read_source: Callable[[str], str | None], now_year: int,
               ask: Callable[[str], str], provider: str) -> str:
    """Runs the estimate and merges it. Returns a line for the log; never raises, and never prints the key."""
    try:
        with open(findings, encoding="utf-8") as fh:
            history = json.load(fh).get("history") or {}
        evidence = gather_evidence(records, read_source, now_year, history)
        estimate = parse_reply(ask(evidence), now_year, evidence)
    except Exception:  # The estimate is optional. Any failure leaves the rule-based estimate in place.
        return "The AI origin estimate failed. The rule-based estimate stays."
    if estimate is None:
        return "The AI origin estimate was not usable. The rule-based estimate stays."
    if not merge_into_findings(findings, estimate, provider):
        return "No origin block to merge the AI estimate into."
    return f"{provider}: AI origin estimate written (typical {estimate['typical_year']}, {estimate['confidence']} confidence)."
