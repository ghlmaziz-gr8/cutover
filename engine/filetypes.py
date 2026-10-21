"""Identify what kind of file each file is, from its first bytes and its extension.

Works on any file, in any language: text, binary, images, documents, archives and databases. A file is named only
when a known signature or extension matches. Anything else is reported as "unidentified", never guessed.
Reads at most the first 4 KB of each file. Stdlib only.
"""
from pathlib import PurePosixPath

HEAD_BYTES = 4096

# (kind, format, signature, offset). The first match wins.
SIGNATURES = [
    ("database", "Microsoft Access", b"Standard Jet DB", 4),
    ("database", "Microsoft Access", b"Standard ACE DB", 4),
    ("database", "SQLite", b"SQLite format 3\x00", 0),
    ("document", "PDF", b"%PDF-", 0),
    ("archive", "ZIP (also Office Open XML, JAR, Excel and Word 2007+)", b"PK\x03\x04", 0),
    ("archive", "gzip", b"\x1f\x8b", 0),
    ("archive", "7-Zip", b"7z\xbc\xaf\x27\x1c", 0),
    ("document", "OLE compound file (Word, Excel, Access 97, Thumbs.db and others)", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", 0),
    ("image", "PNG image", b"\x89PNG\r\n\x1a\n", 0),
    ("image", "JPEG image", b"\xff\xd8\xff", 0),
    ("image", "GIF image", b"GIF8", 0),
    ("image", "BMP image", b"BM", 0),
    ("image", "TIFF image", b"II*\x00", 0),
    ("image", "TIFF image", b"MM\x00*", 0),
    ("executable", "Windows executable", b"MZ", 0),
    ("executable", "ELF executable", b"\x7fELF", 0),
    ("executable", "Java class file", b"\xca\xfe\xba\xbe", 0),
    ("document", "Windows help (HLP)", b"?_\x03\x00", 0),
    ("document", "Compiled HTML help (CHM)", b"ITSF", 0),
]

# Extension -> (kind, format). Used when no signature matches. Text kinds are checked against the content.
EXTENSIONS = {
    ".txt": ("text", "plain text"), ".md": ("text", "Markdown"), ".rtf": ("document", "Rich Text"),
    ".doc": ("document", "Word document (older format)"), ".docx": ("document", "Word document"),
    ".xls": ("document", "Excel workbook (older format)"), ".xlsx": ("document", "Excel workbook"),
    ".ppt": ("document", "PowerPoint (older format)"), ".pptx": ("document", "PowerPoint"),
    ".csv": ("data", "comma-separated values"), ".tsv": ("data", "tab-separated values"),
    ".json": ("data", "JSON"), ".xml": ("data", "XML"), ".yml": ("data", "YAML"), ".yaml": ("data", "YAML"),
    ".ini": ("configuration", "settings file"), ".cfg": ("configuration", "settings file"),
    ".conf": ("configuration", "settings file"), ".properties": ("configuration", "settings file"),
    ".dat": ("data", "data file"), ".ctl": ("configuration", "control file"),
    ".sql": ("database", "SQL script (dialect not identified)"),
    ".mdb": ("database", "Microsoft Access (by extension)"), ".accdb": ("database", "Microsoft Access (by extension)"),
    ".dbf": ("database", "dBase or Visual FoxPro table"), ".dbc": ("database", "Visual FoxPro database"),
    ".mdf": ("database", "SQL Server database file"), ".ldf": ("database", "SQL Server log file"),
    ".bak": ("database", "database backup"), ".dmp": ("database", "database export"),
    ".gif": ("image", "GIF image"), ".jpg": ("image", "JPEG image"), ".jpeg": ("image", "JPEG image"),
    ".png": ("image", "PNG image"), ".bmp": ("image", "BMP image"), ".ico": ("image", "icon"),
    ".psp": ("image", "Paint Shop Pro image"), ".psd": ("image", "Photoshop image"),
    ".swf": ("media", "Flash animation"), ".mp4": ("media", "video"), ".mp3": ("media", "audio"),
    ".zip": ("archive", "ZIP archive"), ".rar": ("archive", "RAR archive"), ".tar": ("archive", "tar archive"),
    ".exe": ("executable", "Windows executable"), ".dll": ("executable", "Windows library"),
    ".ocx": ("executable", "ActiveX control"), ".class": ("executable", "Java class file"),
    ".jar": ("archive", "Java archive"), ".war": ("archive", "web archive"),
    ".scc": ("tool", "Visual SourceSafe control file"), ".swi": ("tool", "installer file"),
    ".sbk": ("tool", "backup file"), ".tmp": ("tool", "temporary file"), ".log": ("text", "log file"),
    ".css": ("web", "stylesheet"), ".js": ("web", "JavaScript"), ".htm": ("web", "HTML page"),
    ".html": ("web", "HTML page"),
}

# Names that are never the thing their extension suggests.
NAMED = {"thumbs.db": ("tool", "Windows thumbnail cache"), "desktop.ini": ("tool", "Windows folder settings")}


def _looks_text(head: bytes) -> bool:
    if not head:
        return True
    if head.startswith((b"\xff\xfe", b"\xfe\xff")):
        return True
    if b"\x00" in head:
        return False
    try:
        head.decode("utf-8")
        return True
    except UnicodeDecodeError:
        # Legacy 8-bit text (for example Windows-1252 from 1990s systems) has no NUL bytes and is still text.
        printable = sum(1 for b in head if b in (9, 10, 13) or 32 <= b < 127 or b >= 160)
        return printable / len(head) > 0.9


def encoding_of(head: bytes) -> str:
    if head.startswith(b"\xff\xfe") or head.startswith(b"\xfe\xff"):
        return "utf-16"
    if head.startswith(b"\xef\xbb\xbf"):
        return "utf-8 with byte order mark"
    try:
        head.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        return "8-bit (legacy)"


def identify(path: str, head: bytes) -> dict:
    """{kind, format, method} for a file. `method` says how it was identified: signature, extension, content, or none."""
    name = PurePosixPath(path).name.lower()
    if name in NAMED:
        kind, fmt = NAMED[name]
        return {"kind": kind, "format": fmt, "method": "name"}
    for kind, fmt, sig, offset in SIGNATURES:
        if head[offset:offset + len(sig)] == sig:
            return {"kind": kind, "format": fmt, "method": "signature"}
    ext = PurePosixPath(name).suffix
    if ext in EXTENSIONS:
        kind, fmt = EXTENSIONS[ext]
        return {"kind": kind, "format": fmt, "method": "extension"}
    if _looks_text(head):
        return {"kind": "text", "format": "text, type not identified", "method": "content"}
    return {"kind": "binary", "format": "binary, type not identified", "method": "none"}
