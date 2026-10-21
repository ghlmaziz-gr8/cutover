"""Language packs for legacy code. Each pack says how to recognise a language and what it can extract.

A pack gives, for one file:
  screens    names of screens, forms, maps, windows or pages the file defines
  tables     table names the file uses in SQL (inferred from the code, never from a database)
  depends    other programs, modules or libraries the file calls or uses

Adding a language is one Pack entry, and a test with sample code in tests/fixtures. A language with no pack is
reported as detected and not analysed. Its files are never guessed at.

Packs read text only. Nothing is connected to, executed or compiled.
"""
import re
from collections import namedtuple
from pathlib import PurePosixPath

import legacy

Pack = namedtuple("Pack", "name tier exts requires hints screens tables depends")
Result = namedtuple("Result", "screens tables depends")

PACKS: list[Pack] = []


def _rx(pattern: str, flags: int = re.I | re.M):
    return re.compile(pattern, flags)


def _stem(path: str) -> str:
    return PurePosixPath(path).stem


# ---- shared helpers -------------------------------------------------------------------------------------

def sql_from_strings(text: str, quotes: str = '"') -> list[str]:
    """SQL held in string literals. `quotes` is the quote character the language uses for strings."""
    body = r"([^\n\r]*)"
    if quotes == '"':
        rx = re.compile(r'"' + body + r'"')
    else:
        rx = re.compile(r"'" + body + r"'")
    return [m.group(1) for m in rx.finditer(text) if legacy.SQL_VERB_RX.search(m.group(1))]


def tables_in_sql(sql: str) -> set[str]:
    names = set()
    for m in legacy.TABLE_RX.finditer(sql):
        name = m.group(1)
        if name.lower() not in legacy.NOT_TABLES and not name.isdigit():
            names.add(name)
    return names


def _tables_from_literals(text: str, quotes: str = '"') -> set[str]:
    names: set[str] = set()
    for sql in sql_from_strings(text, quotes):
        names |= tables_in_sql(sql)
    return names


def _tables_from_statements(text: str, keyword_blocks: list[str] | None = None) -> set[str]:
    """Tables from SQL written in the code itself (not in string literals), within the given blocks."""
    blocks = [text]
    for pattern in keyword_blocks or []:
        blocks = [m.group(0) for b in blocks for m in re.finditer(pattern, b, re.I | re.S)]
    names: set[str] = set()
    for b in blocks:
        names |= tables_in_sql(b)
    return names


def _none(_path, _text):
    return set()


def _dfm_form(path, text):
    """A .dfm file describes one form: its first object. Source files (.pas) describe no screen of their own."""
    if PurePosixPath(path).suffix.lower() != ".dfm":
        return set()
    m = re.search(r"^object\s+(\w+)\s*:", text, re.M)
    return {m.group(1)} if m else set()


def _asp_screens(path, text):
    return set(legacy.views_in(text))


def _asp_tables(path, text):
    return set(legacy.sql_tables_in(text))


def _register(pack: Pack) -> None:
    PACKS.append(pack)


# ---- packs ----------------------------------------------------------------------------------------------

_register(Pack(
    name="Classic ASP", tier=1, exts=(".asp", ".asa"), requires=(), hints=(),
    screens=lambda path, text: _asp_screens(path, text) or {_stem(path)},
    tables=_asp_tables, depends=lambda path, text: set(re.findall(r'<!--\s*#include\s+file="([^"]+)"', text, re.I)),
))

_register(Pack(
    name="Classic ASP include", tier=1, exts=(".inc",), requires=(_rx(r"<%"),), hints=(),
    screens=lambda path, text: set(legacy.views_in(text)),
    tables=_asp_tables, depends=_none,
))

_register(Pack(
    name="Visual Basic 6", tier=1, exts=(".frm", ".bas", ".cls", ".ctl", ".vbp"),
    requires=(), hints=(_rx(r"^VERSION 5\.00"), _rx(r"Begin VB\.\w+")),
    screens=lambda path, text: {m.group(2) for m in re.finditer(r"Begin VB\.(Form|MDIForm|UserControl)\s+(\w+)", text, re.I)},
    tables=lambda path, text: _tables_from_literals(text, '"'),
    depends=lambda path, text: {m.group(1) for m in re.finditer(r'Declare\s+(?:Function|Sub)\s+\w+\s+Lib\s+"([^"]+)"', text, re.I)},
))

_register(Pack(
    name="COBOL", tier=1, exts=(".cbl", ".cob", ".cpy"),
    requires=(), hints=(_rx(r"^\s{0,8}IDENTIFICATION DIVISION"), _rx(r"\bPROCEDURE DIVISION\b")),
    screens=lambda path, text: {m.group(1) for m in re.finditer(r"SEND\s+MAP\s*\(\s*'?([A-Z0-9-]+)", text, re.I)}
    | {m.group(1) for m in re.finditer(r"^\s*01\s+([A-Z0-9-]+)\s+(?:BLANK|LINE|SCREEN)", text, re.I | re.M)},
    tables=lambda path, text: _tables_from_statements(text, [r"EXEC\s+SQL.*?END-EXEC"]),
    depends=lambda path, text: {m.group(1) for m in re.finditer(r"CALL\s+'([A-Z0-9_-]+)'", text, re.I)},
))

_register(Pack(
    name="Delphi or Pascal", tier=2, exts=(".pas", ".dpr", ".dfm", ".dpk"),
    requires=(), hints=(_rx(r"^\s*unit\s+\w+\s*;"), _rx(r"^object\s+\w+\s*:\s*T\w+")),
    screens=lambda path, text: _dfm_form(path, text),
    tables=lambda path, text: _tables_from_literals(text, "'"),
    depends=lambda path, text: {u.strip() for m in re.finditer(r"\buses\s+([^;]+);", text, re.I)
                                for u in m.group(1).split(",") if u.strip()},
))

_register(Pack(
    name="PL/SQL", tier=2, exts=(".pks", ".pkb", ".prc", ".fnc", ".trg"),
    requires=(), hints=(_rx(r"CREATE\s+(OR\s+REPLACE\s+)?(PACKAGE|PROCEDURE|FUNCTION|TRIGGER)"),),
    screens=_none,
    tables=lambda path, text: {m.group(1) for m in re.finditer(r"\b(?:FROM|JOIN|UPDATE)\s+(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)", text, re.I)
                               if m.group(1).upper() not in legacy.NOT_TABLES},
    depends=lambda path, text: {m.group(1) for m in re.finditer(r"\b(?:CALL|EXECUTE)\s+([A-Za-z_][\w.]*)", text, re.I)},
))

_register(Pack(
    name="T-SQL (SQL Server scripts)", tier=1, exts=(".sql",),
    requires=(_rx(r"^\s*GO\s*$"), _rx(r"CREATE\s+(PROCEDURE|PROC|TRIGGER|FUNCTION)\b"), _rx(r"\[dbo\]\.")),
    hints=(_rx(r"\bIDENTITY\s*\("), _rx(r"\bNVARCHAR\b")),
    screens=_none,
    tables=lambda path, text: tables_in_sql(text) | {m.group(1) for m in re.finditer(r"CREATE\s+TABLE\s+(?:\[?\w+\]?\.)?\[?(\w+)", text, re.I)},
    depends=_none,
))

_register(Pack(
    name="Perl", tier=2, exts=(".pl", ".pm", ".cgi"),
    requires=(), hints=(_rx(r"^#!.*\bperl\b"), _rx(r"^use\s+strict\s*;")),
    screens=lambda path, text: {_stem(path)} if re.search(r"Content-type", text, re.I) else set(),
    tables=lambda path, text: _tables_from_literals(text, '"') | _tables_from_literals(text, "'"),
    depends=lambda path, text: {m.group(1) for m in re.finditer(r"^\s*use\s+([A-Za-z][\w:]*)", text, re.M)},
))

_register(Pack(
    name="PHP (older)", tier=2, exts=(".php", ".php3", ".phtml"),
    requires=(), hints=(_rx(r"<\?php"),),
    screens=lambda path, text: {_stem(path)} if re.search(r"<html|<body|<form", text, re.I) else set(),
    tables=lambda path, text: _tables_from_literals(text, '"') | _tables_from_literals(text, "'"),
    depends=lambda path, text: {m.group(1) for m in re.finditer(r"(?:require|include)(?:_once)?\s*\(?\s*['\"]([^'\"]+)", text, re.I)},
))

_register(Pack(
    name="PowerBuilder", tier=2, exts=(".srw", ".srd", ".sru", ".srm", ".srf", ".win", ".dw"),
    requires=(), hints=(_rx(r"\$PBExportHeader\$"),),
    screens=lambda path, text: {_stem(path)},
    tables=lambda path, text: _tables_from_literals(text, '"'),
    depends=_none,
))

_register(Pack(
    name="Natural", tier=2, exts=(".nsp", ".nsn", ".nss", ".nsm", ".nsa", ".nsc", ".nsl"),
    requires=(), hints=(_rx(r"\bDEFINE\s+DATA\b"), _rx(r"\bEND-DEFINE\b")),
    screens=lambda path, text: {_stem(path)} if PurePosixPath(path).suffix.lower() == ".nsm" else set(),
    tables=lambda path, text: {m.group(1) for m in re.finditer(r"(?<![\w-])(?:READ|FIND|HISTOGRAM|STORE\s+IN)\s+([A-Za-z]\w*)", text, re.I)
                               if m.group(1).upper() not in ("END", "DATA", "BY", "WHERE")},
    depends=lambda path, text: {m.group(1) for m in re.finditer(r"\b(?:CALLNAT|FETCH\s+(?:RETURN)?)\s+'([^']+)'", text, re.I)},
))

_register(Pack(
    name="Progress 4GL", tier=2, exts=(".p", ".w", ".i"),
    requires=(), hints=(_rx(r"\bDEFINE\s+(VARIABLE|TEMP-TABLE|BUFFER)\b"), _rx(r"\bFOR\s+EACH\s+\w+")),
    screens=lambda path, text: {_stem(path)} if PurePosixPath(path).suffix.lower() == ".w" else set(),
    tables=lambda path, text: {m.group(1) for m in re.finditer(r"\b(?:FOR\s+EACH|FIND\s+(?:FIRST|LAST|NEXT|UNIQUE)?|CREATE)\s+(\w+)", text, re.I)},
    depends=lambda path, text: {m.group(1) for m in re.finditer(r"\bRUN\s+([\w/.\\-]+\.[pw])", text, re.I)},
))

_register(Pack(
    name="RPG", tier=2, exts=(".rpg", ".rpgle", ".sqlrpgle", ".dspf", ".rpt"),
    requires=(), hints=(_rx(r"\bCTL-OPT\b"), _rx(r"\bDCL-(S|F|PR|PI|DS)\b"), _rx(r"\bEXEC\s+SQL\b")),
    screens=lambda path, text: {_stem(path)} if PurePosixPath(path).suffix.lower() == ".dspf" else set(),
    tables=lambda path, text: _tables_from_statements(text, [r"EXEC\s+SQL.*?;"]),
    depends=lambda path, text: {m.group(1) for m in re.finditer(r"\bCALLP?\s+(\w+)", text, re.I)},
))

_register(Pack(
    name="FoxPro or Visual FoxPro", tier=2, exts=(".prg", ".scx", ".frx", ".vcx", ".mnx"),
    requires=(), hints=(_rx(r"^\s*DEFINE\s+CLASS\b"), _rx(r"^\s*USE\s+\w+"), _rx(r"\bENDPROC\b|\bENDDEFINE\b")),
    screens=lambda path, text: {_stem(path)} if PurePosixPath(path).suffix.lower() in (".scx", ".vcx") else set(),
    tables=lambda path, text: {m.group(1) for m in re.finditer(r"^\s*(?:USE|INSERT\s+INTO|SELECT\s+.*?\bFROM)\s+([A-Za-z_]\w*)", text, re.I | re.M)},
    depends=lambda path, text: {m.group(1) for m in re.finditer(r"^\s*DO\s+([\w.]+)", text, re.I | re.M)},
))


# ---- Java, JSP and .NET ----------------------------------------------------------------------------------
# Each JSP or Razor view file is a screen. Controller routes are endpoints, counted in the API findings,
# so a route and its view file are not counted twice.

def _java_tables(path, text):
    """JPA tables: @Table(name=...), or the entity class name when no @Table is given, plus SQL in string literals."""
    names = set(re.findall(r'@Table\s*\(\s*(?:name\s*=\s*)?"([^"]+)"', text))
    if re.search(r"@Entity\b", text) and not names:
        m = re.search(r"\bclass\s+(\w+)", text)
        if m:
            names.add(m.group(1))
    return names | _tables_from_literals(text, '"')


def _java_depends(path, text):
    return {m.group(1) for m in re.finditer(r"^\s*import\s+(?:static\s+)?([\w.]+)", text, re.M)
            if not m.group(1).startswith(("java.", "javax.", "jakarta."))}


def _jsp_depends(path, text):
    return set(re.findall(r'(?:<jsp:include\s+page\s*=|<%@\s*include\s+file\s*=)\s*"([^"]+)"', text, re.I))


def _cs_tables(path, text):
    """Entity Framework tables: [Table("x")] or DbSet<Entity>, plus SQL in string literals."""
    names = set(re.findall(r'\[Table\s*\(\s*"([^"]+)"', text))
    names |= set(re.findall(r"DbSet<\s*(\w+)\s*>", text))
    return names | _tables_from_literals(text, '"')


def _cs_depends(path, text):
    return {m.group(1) for m in re.finditer(r"^\s*using\s+(?:static\s+)?([\w.]+)\s*;", text, re.M)
            if not m.group(1).startswith("System")}


_register(Pack(
    name="Java and Spring Boot", tier=1, exts=(".java",), requires=(),
    hints=(_rx(r"@SpringBootApplication|@RestController|@Controller\b|@Entity\b|import\s+org\.springframework"),),
    screens=_none, tables=_java_tables, depends=_java_depends,
))

_register(Pack(
    name="JSP", tier=1, exts=(".jsp", ".jspx"), requires=(),
    hints=(_rx(r"<%@\s*page|<%=|<jsp:"),),
    screens=lambda path, text: {_stem(path)},
    tables=lambda path, text: _tables_from_literals(text, '"'),
    depends=_jsp_depends,
))

_register(Pack(
    name="C# and ASP.NET", tier=1, exts=(".cs",), requires=(),
    hints=(_rx(r"\[ApiController\]|\[Route\(|DbContext|:\s*Controller\b|using\s+System"),),
    screens=_none, tables=_cs_tables, depends=_cs_depends,
))

_register(Pack(
    name="ASP.NET Razor and Web Forms", tier=1, exts=(".cshtml", ".razor", ".aspx", ".ascx", ".master"), requires=(),
    hints=(_rx(r"@model\b|@page\b|<asp:|<%@\s*Page"),),
    screens=lambda path, text: {_stem(path)},
    tables=lambda path, text: _tables_from_literals(text, '"'),
    depends=lambda path, text: set(re.findall(r'(?:CodeFile|CodeBehind)="([^"]+)"', text, re.I)),
))


# ---- identification -------------------------------------------------------------------------------------

def identify(path: str, text: str | None) -> Pack | None:
    """The pack for a file, or None. Extension narrows the choice. When several packs share an extension,
    the content decides. A pack with `requires` only applies when one of its patterns is found."""
    ext = PurePosixPath(path).suffix.lower()
    candidates = [p for p in PACKS if ext in p.exts]
    if not candidates:
        return None
    usable = []
    for p in candidates:
        if p.requires and (text is None or not any(rx.search(text) for rx in p.requires)):
            continue
        usable.append(p)
    if not usable:
        return None
    if len(usable) == 1 or text is None:
        return usable[0]
    for p in usable:
        if any(rx.search(text) for rx in p.hints):
            return p
    return usable[0]


def extract(pack: Pack, path: str, text: str) -> Result:
    return Result(
        screens=set(pack.screens(path, text) or ()),
        tables=set(pack.tables(path, text) or ()),
        depends=set(pack.depends(path, text) or ()),
    )


# Every extension a pack reads, so the discovery reads those files as text.
ALL_EXTS = tuple(sorted({e for p in PACKS for e in p.exts}))
