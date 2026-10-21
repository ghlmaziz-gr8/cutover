"""Legacy code and database detection: classic ASP, VBScript, Visual Basic 6, COBOL, Delphi, Perl, PHP,
PowerBuilder, FoxPro, and the databases an older application often sits on (Access, SQLite, dBase, and others).

Static and read-only. Nothing is connected to. Database files are identified by their file signature
(the first bytes of the file), and their contents are not read here. Access table and field names come
from the read-only metadata script (access_metadata.py), run inside the client's environment.

Tiers:
  1  Read as source. Table names and screens are taken from the code.
  2  Read as source where the text is plain. Languages are reported, with fewer details.
  3  Detected by file extension only. The files are counted and listed, not read.
"""
import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote_plus

# Extensions whose text is read for screens and SQL (tiers 1 and 2).
LEGACY_TEXT_EXTS = (
    ".asp", ".asa", ".inc", ".vbs", ".frm", ".bas", ".cls", ".ctl", ".vbp",
    ".cbl", ".cob", ".cpy", ".pas", ".dpr", ".dfm", ".pl", ".pm", ".cgi",
    ".php", ".pbl", ".srw", ".prg", ".vb", ".aspx", ".ascx",
)

# Extension -> (language, tier). Tier 3 entries are counted and listed, never read.
LEGACY_LANGUAGES = {
    ".asp": ("Classic ASP", 1), ".asa": ("Classic ASP", 1), ".inc": ("Classic ASP include", 1),
    ".vbs": ("VBScript", 1),
    ".frm": ("Visual Basic 6", 1), ".bas": ("Visual Basic 6", 1), ".cls": ("Visual Basic 6", 1),
    ".ctl": ("Visual Basic 6", 1), ".vbp": ("Visual Basic 6", 1),
    ".cbl": ("COBOL", 1), ".cob": ("COBOL", 1), ".cpy": ("COBOL", 1),
    ".pas": ("Delphi or Pascal", 2), ".dpr": ("Delphi or Pascal", 2), ".dfm": ("Delphi or Pascal", 2),
    ".pl": ("Perl", 2), ".pm": ("Perl", 2), ".cgi": ("Perl", 2),
    ".php": ("PHP", 2),
    ".pbl": ("PowerBuilder", 2), ".srw": ("PowerBuilder", 2),
    ".prg": ("FoxPro or Clipper", 2),
    ".vb": ("Visual Basic .NET", 2), ".aspx": ("ASP.NET", 2), ".ascx": ("ASP.NET", 2),
    ".rpg": ("RPG", 3), ".rpgle": ("RPG", 3), ".sqlrpgle": ("RPG", 3),
    ".nsp": ("Natural", 3), ".nsn": ("Natural", 3), ".nss": ("Natural", 3),
    ".cfm": ("ColdFusion", 3), ".cfc": ("ColdFusion", 3),
    ".scx": ("Visual FoxPro forms", 3), ".mac": ("Macro code (not identified)", 3),
}

# Database files: (engine, tier, extensions, signature offset, signatures or None, note).
# With a signature, the file must start with one of the byte strings; without one, the extension alone decides
# and the finding says so.
DATABASE_RULES = [
    ("Microsoft Access", 1, (".mdb", ".accdb", ".mde", ".accde"), 4, (b"Standard Jet DB", b"Standard ACE DB"), ""),
    ("SQLite", 1, (".db", ".sqlite", ".sqlite3", ".db3"), 0, (b"SQLite format 3\x00",), ""),
    ("SQL Server database file", 1, (".mdf",), None, None, "Identified by extension only."),
    ("SQL Server backup", 1, (".bak",), None, None, "Identified by extension only. Could also be another backup."),
    ("dBase or Visual FoxPro table", 2, (".dbf",), None, None, "Identified by extension only."),
    ("Visual FoxPro database", 2, (".dbc",), None, None, "Identified by extension only."),
    ("Firebird or InterBase", 2, (".fdb", ".gdb"), None, None, "Identified by extension only."),
    ("Oracle export", 2, (".dmp",), None, None, "Identified by extension only."),
    ("Btrieve file", 2, (".btr",), None, None, "Identified by extension only."),
]

# Files that look like databases by name but are not: Windows thumbnail caches, lock files, source-control files.
NOT_A_DATABASE = {"thumbs.db", "desktop.ini"}

VIEW_RX = re.compile(r"""controlname\s*=\s*["']([A-Za-z0-9][A-Za-z0-9 _.\-]{0,59})["']""", re.I)
VIEW_QUERY_RX = re.compile(r"""[?&]controlname=([A-Za-z0-9][A-Za-z0-9%+ _.\-]{0,59})(?=[&"'\s<]|$)""", re.I)
# A string literal in VBScript or classic ASP that holds SQL.
SQL_LITERAL_RX = re.compile(r'"([^"\r\n]*)"')
SQL_START_RX = re.compile(r"^\s*(select|insert\s+into|update|delete)\b", re.I)
SQL_VERB_RX = re.compile(r"\b(select|insert|update|delete)\b", re.I)
TABLE_RX = re.compile(r"\b(?:from|into|update|join)\s+\[?([A-Za-z_][A-Za-z0-9_]*)\]?", re.I)
# Words that can follow "from" or "join" and are not table names.
NOT_TABLES = {
    "select", "where", "set", "values", "as", "on", "and", "or", "not", "inner", "left", "right", "outer",
    "order", "group", "by", "having", "top", "distinct", "the", "a", "an", "your", "this", "that", "dual",
    "nolock", "with", "union", "case", "when", "then", "else", "end", "null", "is", "in", "like",
}
# Lines that are never about a view, however they are written.
INCLUDE_NAME_RX = re.compile(r"(^|/)(inc_[^/]*|includefiles/[^/]*|include/[^/]*)$", re.I)


def language_of(path: str, text: str | None) -> tuple[str, int] | None:
    """The legacy language a file belongs to, and its tier, or None."""
    name = path.rsplit("/", 1)[-1].lower()
    ext = Path(name).suffix
    if ext == ".inc":
        # An include is ASP only when it holds ASP script blocks.
        return ("Classic ASP include", 1) if text and "<%" in text else None
    return LEGACY_LANGUAGES.get(ext)


def views_in(text: str) -> set[str]:
    """Screen names the code switches on, from ControlName=... in code and in links."""
    found = set()
    for m in VIEW_RX.finditer(text):
        found.add(m.group(1).strip())
    for m in VIEW_QUERY_RX.finditer(text):
        found.add(unquote_plus(m.group(1)).strip())
    return {v for v in found if v}


def asp_views(files: dict[str, str]) -> dict[str, str]:
    """Each distinct view name (keeping the first spelling found) with the file it came from."""
    seen: dict[str, str] = {}
    for path in sorted(files):
        if not path.lower().endswith((".asp", ".inc", ".asa")):
            continue
        for view in sorted(views_in(files[path]), key=str.lower):
            key = view.lower()
            if not any(k.lower() == key for k in seen):
                seen[view] = path
    return seen


def asp_pages(paths: list[str]) -> list[str]:
    """ASP pages a visitor can open. Includes and global files are not pages."""
    return [p for p in paths if p.lower().endswith(".asp") and not INCLUDE_NAME_RX.search(p)]


def sql_tables_in(text: str) -> set[str]:
    """Table names used in SQL written as string literals (classic ASP and VBScript)."""
    names = set()
    for m in SQL_LITERAL_RX.finditer(text):
        literal = m.group(1)
        if not (SQL_START_RX.search(literal) or SQL_VERB_RX.search(literal)):
            continue
        for t in TABLE_RX.finditer(literal):
            name = t.group(1)
            if name.lower() not in NOT_TABLES and not name.isdigit():
                names.add(name)
    return names


def sql_tables(files: dict[str, str]) -> dict[str, list[str]]:
    """Table name -> the files that use it, from SQL in legacy source. Names that differ only in case are one table,
    shown with the spelling used most often."""
    spellings: dict[str, Counter] = {}
    used_in: dict[str, set[str]] = {}
    for path in sorted(files):
        if not path.lower().endswith(LEGACY_TEXT_EXTS):
            continue
        for name in sql_tables_in(files[path]):
            key = name.lower()
            spellings.setdefault(key, Counter())[name] += 1
            used_in.setdefault(key, set()).add(path)
    out = {}
    for key in sorted(spellings):
        shown = spellings[key].most_common(1)[0][0]
        out[shown] = sorted(used_in[key])
    return out


def database_kind(path: str, head: bytes) -> tuple[str, int, str] | None:
    """(engine, tier, how it was identified) for a database file, or None. `head` is the first bytes of the file."""
    name = path.rsplit("/", 1)[-1].lower()
    if name in NOT_A_DATABASE:
        return None
    ext = Path(name).suffix
    for engine, tier, exts, offset, sigs, note in DATABASE_RULES:
        if ext not in exts:
            continue
        if sigs is None:
            return (engine, tier, "by extension")
        if any(head[offset:offset + len(s)] == s for s in sigs):
            return (engine, tier, "by file signature")
        return None
    return None


def database_files(root: Path, paths: list[str]) -> list[dict]:
    """Database files in the repository, with their engine and how they were identified. Only the first bytes are read."""
    rows = []
    for p in paths:
        name = p.rsplit("/", 1)[-1].lower()
        ext = Path(name).suffix
        if name in NOT_A_DATABASE:
            continue
        if ext not in {e for r in DATABASE_RULES for e in r[2]} and ext != ".db":
            continue
        try:
            with open(root / p, "rb") as fh:
                head = fh.read(32)
        except OSError:
            head = b""
        kind = database_kind(p, head)
        if kind is None and ext == ".db":
            rows.append({"path": p, "engine": "Unrecognised .db file", "tier": 3, "identified": "not identified; contents not read"})
            continue
        if kind:
            rows.append({"path": p, "engine": kind[0], "tier": kind[1], "identified": kind[2]})
    return rows


def not_read_yet(files: dict[str, str], paths: list[str], limit: int) -> list[dict]:
    """Files the engine lists but does not read: over the size limit, or tier 3 languages."""
    rows = []
    for p in paths:
        lang = language_of(p, files.get(p))
        if lang and lang[1] == 3:
            rows.append({"path": p, "reason": f"{lang[0]} is detected by extension and is not read (tier 3)."})
    return rows


# ---- Metadata files from the read-only script (access_metadata.py) ----

META_FORMAT = "cutover-db-metadata/1"
_META_KEYS = {"format", "database", "engine", "tables"}
_TABLE_KEYS = {"name", "columns", "row_count"}
_COLUMN_KEYS = {"name", "type", "nullable"}


def validate_metadata(doc: object) -> dict:
    """Checks a metadata document. It may hold only names, types, nullability and row counts. Anything else is
    refused, so a file cannot carry row values into the report."""
    if not isinstance(doc, dict) or set(doc) - _META_KEYS or doc.get("format") != META_FORMAT:
        raise ValueError("Not a Cutover database metadata file.")
    if not isinstance(doc.get("database"), str) or len(doc["database"]) > 260:
        raise ValueError("The metadata file needs a database file name.")
    tables = doc.get("tables")
    if not isinstance(tables, list) or len(tables) > 5000:
        raise ValueError("The metadata file needs a list of tables.")
    for t in tables:
        if not isinstance(t, dict) or set(t) - _TABLE_KEYS:
            raise ValueError("A table entry holds fields that metadata files may not contain.")
        if not isinstance(t.get("name"), str) or not (1 <= len(t["name"]) <= 128):
            raise ValueError("A table needs a name of up to 128 characters.")
        if t.get("row_count") is not None and (not isinstance(t["row_count"], int) or t["row_count"] < 0):
            raise ValueError("A row count must be a whole number or null.")
        cols = t.get("columns")
        if not isinstance(cols, list) or len(cols) > 2000:
            raise ValueError("A table needs a list of fields.")
        for c in cols:
            if not isinstance(c, dict) or set(c) - _COLUMN_KEYS:
                raise ValueError("A field entry holds fields that metadata files may not contain.")
            if not isinstance(c.get("name"), str) or not (1 <= len(c["name"]) <= 128):
                raise ValueError("A field needs a name of up to 128 characters.")
            if not isinstance(c.get("type"), str) or len(c["type"]) > 40:
                raise ValueError("A field needs a type name.")
            if not isinstance(c.get("nullable"), bool):
                raise ValueError("A field's nullable flag must be true or false.")
    return doc
