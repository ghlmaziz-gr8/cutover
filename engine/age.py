"""An age range for each file: the earliest and latest year the evidence supports, with the evidence named.

Evidence, from the strongest to the weakest:
  - the first and last git commit that touched the file (commit dates; they can be wrong if history was rewritten)
  - a year written in the file itself, in a copyright line, a header or a "last modified" line

A year is only accepted between 1980 and the current year. A file with no evidence has no age, and the report says so.
Only years are kept. Nothing else from the file is copied.
"""
import re
from datetime import datetime

MIN_YEAR = 1980

YEAR_RX = re.compile(
    r"(?:copyright|\(c\)|©|created|written|modified|revised|last\s+(?:updated|modified|changed)|date|version\s+\d+\.\d+\s+of)"
    r"[^\n\r]{0,40}?\b(19[89]\d|20[0-3]\d)\b",
    re.I,
)
# Date stamps in headers, such as 03/12/1997, 12-03-98 or 1997-03-12.
DATE_RX = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b|\b(19[89]\d|20[0-3]\d)-\d{2}-\d{2}\b")


def _valid(year: int, now_year: int) -> bool:
    return MIN_YEAR <= year <= now_year


def years_in_text(text: str, now_year: int) -> list[int]:
    """Years a file gives about itself, from copyright lines, headers and dated stamps."""
    found = []
    for m in YEAR_RX.finditer(text[:20000]):
        year = int(m.group(1))
        if _valid(year, now_year):
            found.append(year)
    for m in DATE_RX.finditer(text[:20000]):
        if m.group(4):
            year = int(m.group(4))
        else:
            raw = int(m.group(3))
            year = raw + (1900 if raw >= 80 else 2000) if raw < 100 else raw
        if _valid(year, now_year):
            found.append(year)
    return found


def range_for(path: str, text: str | None, git_dates: dict[str, tuple[str, str]] | None, now: datetime) -> dict | None:
    """{earliest, latest, evidence} for one file, or None when there is no evidence."""
    now_year = now.year
    years: list[int] = []
    evidence: list[str] = []
    dates = (git_dates or {}).get(path)
    if dates:
        first, last = dates
        y1, y2 = int(first[:4]), int(last[:4])
        if _valid(y1, now_year) and _valid(y2, now_year):
            years += [y1, y2]
            evidence.append(f"git history {first[:4]} to {last[:4]}")
    if text:
        in_file = years_in_text(text, now_year)
        if in_file:
            years += [min(in_file), max(in_file)]
            evidence.append(f"years written in the file {min(in_file)} to {max(in_file)}")
    if not years:
        return None
    return {"earliest": min(years), "latest": max(years), "evidence": evidence}


def git_dates(git_output: str) -> dict[str, tuple[str, str]]:
    """Maps each path to (first, last) commit date, from `git log --name-only --format=%ad --date=short` output.
    Git lists the newest commit first, so the first time a path appears is its last change, and the last time
    it appears is its first change."""
    newest: dict[str, str] = {}
    oldest: dict[str, str] = {}
    current = None
    for line in git_output.splitlines():
        line = line.strip()
        if not line:
            continue
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", line):
            current = line
            continue
        if current is None:
            continue
        newest.setdefault(line, current)
        oldest[line] = current
    return {path: (oldest[path], newest[path]) for path in newest}


def origin_estimate(files: dict[str, str], now_year: int, history: dict) -> dict:
    """When the application was probably first written, from the years the code gives about itself (copyright
    lines, headers and dates in each file). Git dates are not used for this: a repository uploaded later has its
    own commit date, which says when this copy was committed, not when the application was built."""
    per_file_min: list[int] = []
    for text in files.values():
        years = years_in_text(text, now_year) if text else []
        if years:
            per_file_min.append(min(years))
    per_file_min.sort()
    evidence: list[str] = []
    if history.get("available"):
        evidence.append(
            f"Git history in this repository starts {history.get('first_commit')} with "
            f"{history.get('total_commits')} commit(s). That is when this copy was committed, not when the application was built.")
    if not per_file_min:
        evidence.insert(0, f"No year is written in the code of the {len(files)} text files read, so no origin is estimated.")
        return {"earliest_year": None, "typical_year": None, "latest_year": None, "files_with_years": 0,
                "files_scanned": len(files), "confidence": "none", "evidence": evidence}
    earliest, typical, latest = per_file_min[0], per_file_min[len(per_file_min) // 2], per_file_min[-1]
    evidence.insert(0, f"Years written in {len(per_file_min)} of the {len(files)} text files read: earliest {earliest}, "
                       f"typical {typical}, latest {latest}.")
    return {"earliest_year": earliest, "typical_year": typical, "latest_year": latest,
            "files_with_years": len(per_file_min), "files_scanned": len(files),
            "confidence": "medium" if len(per_file_min) >= 10 else "low", "evidence": evidence}

