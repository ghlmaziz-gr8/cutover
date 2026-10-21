"""The full inventory: one record for every file in the repository, in any language, with its kind, its language
(when a pack exists), its age range and its encoding. Writes names, kinds, counts and years only. No line of the
code is copied into a record.
"""
from pathlib import Path

import age
import filetypes
import languages
import legacy

HEAD = filetypes.HEAD_BYTES


def read_head(root: Path, path: str) -> bytes:
    try:
        with open(root / path, "rb") as fh:
            return fh.read(HEAD)
    except OSError:
        return b""


def language_for(path: str, text: str | None) -> dict | None:
    """The language of a file: a pack (analysed), or a tier 3 language (detected, not read), or None."""
    pack = languages.identify(path, text)
    if pack is not None:
        return {"name": pack.name, "tier": pack.tier, "status": "analysed", "pack": pack}
    lang = legacy.language_of(path, text)
    if lang is not None and lang[1] == 3:
        return {"name": lang[0], "tier": 3, "status": "detected, not analysed", "pack": None}
    return None


def build(root: Path, paths: list[str], files: dict[str, str], git_dates: dict, now) -> tuple[list[dict], dict]:
    """Records for every file, and a summary for the findings."""
    records = []
    for path in paths:
        text = files.get(path)
        head = read_head(root, path) if text is None else text.encode("utf-8", "replace")[:HEAD]
        ident = filetypes.identify(path, head)
        lang = language_for(path, text)
        if lang and ident["method"] in ("content", "none"):
            # The language decides what the file is when its extension or content names no type of its own.
            ident = {"kind": "text", "format": f"{lang['name']} source", "method": "language"}
        rec = {
            "path": path,
            "kind": ident["kind"],
            "format": ident["format"],
            "identified_by": ident["method"],
            "encoding": filetypes.encoding_of(head) if ident["kind"] in ("text", "data", "web", "configuration", "tool") else None,
            "language": lang["name"] if lang else None,
            "language_status": lang["status"] if lang else None,
            "tier": lang["tier"] if lang else None,
            "age": age.range_for(path, text, git_dates, now),
        }
        records.append(rec)

    kinds: dict[str, int] = {}
    for r in records:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    unidentified = [r["path"] for r in records if r["identified_by"] == "none"
                    or (r["identified_by"] == "content" and r["language"] is None)]
    languages_seen: dict[str, dict] = {}
    for r in records:
        if r["language"]:
            row = languages_seen.setdefault(r["language"], {"tier": r["tier"], "status": r["language_status"], "files": 0})
            row["files"] += 1
    earliest = [r["age"]["earliest"] for r in records if r["age"]]
    latest = [r["age"]["latest"] for r in records if r["age"]]
    summary = {
        "files": len(records),
        "kinds": dict(sorted(kinds.items(), key=lambda kv: -kv[1])),
        "unidentified": len(unidentified),
        "unidentified_paths": unidentified[:200],
        "languages": languages_seen,
        "files_with_age": len(earliest),
        "age_earliest": min(earliest) if earliest else None,
        "age_latest": max(latest) if latest else None,
    }
    return records, summary
