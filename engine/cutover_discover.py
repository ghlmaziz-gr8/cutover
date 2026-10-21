#!/usr/bin/env python3
"""Cutover discovery engine, v0.1.

Reads an application (a GitHub repository or a local folder) and writes
structured findings plus a readable report. Every finding lists the files it
came from and says whether it was verified (found directly in a file) or
inferred (a heuristic that a reviewer should confirm).

Built-in safety rules:
- The source is read, never modified. Clones go to a temporary folder that is
  deleted afterwards.
- Tokens are passed to git as an HTTP header. They never appear in URLs,
  output files, or error messages.
- HL7 patient identifier values are never written to output. Only file paths
  and counts are recorded.
- Nothing is built, executed, or connected to. Analysis is static only.

Standard library only. Requires Python 3.9+ and git.

Usage:
  python3 engine/cutover_discover.py --repo owner/name [--ref main] --out reports
  python3 engine/cutover_discover.py --path ./some-app --out reports
  GITHUB_TOKEN=... python3 engine/cutover_discover.py --repo owner/private-repo
"""
from __future__ import annotations

import argparse
import base64
import copy
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path

import deeper_docs
import file_inventory
import age
import filetypes
import inventory
import languages
import legacy

SCHEMA_VERSION = "0.1"
MAX_FILE_BYTES = 2_000_000
EVIDENCE_LIMIT = 15
SKIP_DIRS = {
    ".git", "node_modules", "target", "build", "dist", ".gradle", "vendor",
    ".idea", "__pycache__", ".terraform",
}
TEXT_EXTS = (
    ".java", ".kt", ".kts", ".gradle", ".xml", ".properties", ".yml", ".yaml",
    ".json", ".sql", ".html", ".htm", ".jsp", ".xhtml", ".cshtml", ".py", ".js",
    ".ts", ".tsx", ".jsx", ".vue", ".cs", ".csproj", ".go", ".mod", ".tf",
    ".bicep", ".sh", ".md", ".txt", ".hl7", ".toml", ".cfg", ".ini", ".conf", ".env",
) + legacy.LEGACY_TEXT_EXTS + languages.ALL_EXTS
LIMITATIONS = [
    "Static analysis only. Nothing is built, run, or connected to.",
    "Database files are identified by their signature. Their contents are not opened. Tables and fields come only from metadata files written by the read-only script.",
    "Tier 3 languages are counted by file extension and not read.",
    "Route annotations are counted but not joined with class-level prefixes, so full URL paths are not rebuilt.",
    "Screens are counted from template and page files. Fragments and email templates are included in that count.",
    "Roles that exist only in an identity provider or a database are not visible.",
    "Live cloud infrastructure is not inventoried. Use the read-only cloud role or the inventory script for that.",
    "Runtime versions are reported but not checked against vendor end-of-support dates.",
    "Git dates are commit timestamps and can be wrong if history was rewritten or imported.",
]
DRIVER_HINTS = [
    ("mssql-jdbc", "SQL Server"),
    ("mysql-connector", "MySQL"),
    ("postgresql", "PostgreSQL"),
    ("ojdbc", "Oracle"),
    ("com.h2database", "H2"),
]
ENGINE_NAMES = {"sqlserver": "SQL Server", "mysql": "MySQL", "postgresql": "PostgreSQL", "oracle": "Oracle", "h2": "H2"}
SQL_DIALECT_HINTS = {"mysql": "MySQL", "postgres": "PostgreSQL", "h2": "H2", "mssql": "SQL Server", "sqlserver": "SQL Server", "oracle": "Oracle"}
MAPPING_RX = r"@(?:Get|Post|Put|Delete|Patch|Request)Mapping\b"
EPIC_SPECIFIC = r"interconnect-fhir-oauth|fhir\.epic\.com|/api/FHIR/R\d"
SMART_SIGNALS = r"client_assertion|backend-services|jwt-bearer|\bSMART\b|smart-on-fhir|launch_ehr"
FHIR_URL = r"https?://[^\s\"'<>]*/api/FHIR/[^\s\"'<>]*"
HL7_MSG = r"\b(ADT|ORU|ORM|SIU|MDM|DFT)\^([A-Z]\d{2})\b"
CI_RX = (r"(^|/)(\.github/workflows/[^/]+\.ya?ml|azure-pipelines\.ya?ml|Jenkinsfile"
         r"|\.gitlab-ci\.yml|bitbucket-pipelines\.yml|\.circleci/config\.yml)$")


# --------------------------------------------------------------------------
# Git access
# --------------------------------------------------------------------------

def _redact(text: str, token: str | None) -> str:
    return text.replace(token, "***") if token else text


def _run(cmd: list[str], token: str | None = None) -> str:
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if res.returncode != 0:
        raise RuntimeError(_redact((res.stderr or res.stdout).strip(), token))
    return res.stdout


def _auth_args(token: str | None) -> list[str]:
    if not token:
        return []
    raw = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    return ["-c", f"http.extraheader=Authorization: Basic {raw}"]


def git(root: Path, *args: str) -> str:
    return _run(["git", "-C", str(root), *args])


def is_repo_root(root: Path) -> bool:
    try:
        top = git(root, "rev-parse", "--show-toplevel").strip()
    except RuntimeError:
        return False
    return Path(top).resolve() == root.resolve()


def clone_repo(url: str, dest: Path, ref: str | None, token: str | None) -> None:
    try:
        _run(["git", *_auth_args(token), "clone", "--quiet", url, str(dest)], token)
    except RuntimeError as first_error:
        if not token:
            raise
        # A stale or invalid token can block even public repositories, so retry anonymously once.
        shutil.rmtree(dest, ignore_errors=True)
        try:
            _run(["git", "clone", "--quiet", url, str(dest)])
        except RuntimeError:
            raise RuntimeError(
                "Clone failed with GITHUB_TOKEN and without it. Check that the token is valid "
                f"and has access to the repository. Details: {first_error}"
            ) from None
    if ref:
        try:
            _run(["git", "-C", str(dest), "checkout", "--quiet", "--detach", ref], token)
        except RuntimeError:
            _run(["git", "-C", str(dest), "checkout", "--quiet", "--detach", f"origin/{ref}"], token)


def resolve_url(arg: str) -> str:
    if re.fullmatch(r"[\w.-]+/[\w.-]+", arg):
        return f"https://github.com/{arg}.git"
    if re.match(r"https://[^/]*@", arg):
        raise SystemExit("Do not put credentials in the URL. Set the GITHUB_TOKEN environment variable instead.")
    if arg.startswith(("https://", "git@")):
        return arg
    raise SystemExit("Use owner/name or an https clone URL.")


# --------------------------------------------------------------------------
# Repository reader
# --------------------------------------------------------------------------

def _is_text_name(name: str) -> bool:
    low = name.lower()
    return (low.endswith(TEXT_EXTS) or name == "Dockerfile" or name.startswith("Dockerfile.")
            or name in ("Jenkinsfile", "Makefile"))


class Repo:
    """All file paths, plus the text of readable text files."""

    def __init__(self, root: Path):
        self.root = root
        self.paths: list[str] = []
        self.files: dict[str, str] = {}
        self.too_large: list[str] = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                full = Path(dirpath) / name
                if full.is_symlink():
                    continue
                rel = full.relative_to(root).as_posix()
                self.paths.append(rel)
                if not _is_text_name(name):
                    continue
                try:
                    if full.stat().st_size > MAX_FILE_BYTES:
                        self.too_large.append(rel)
                        continue
                    self.files[rel] = full.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
        self.paths.sort()


def hits(repo: Repo, pattern: str, flags: int = 0) -> set[str]:
    rx = re.compile(pattern, flags)
    return {p for p, t in repo.files.items() if rx.search(t)}


def F(fid, category, title, value, confidence, evidence=(), note=None, severity=None) -> dict:
    ev = sorted(set(evidence))
    item = {
        "id": fid, "category": category, "title": title, "value": value,
        "confidence": confidence, "evidence_count": len(ev), "evidence": ev[:EVIDENCE_LIMIT],
    }
    if note:
        item["note"] = note
    if severity:
        item["severity"] = severity
    return item


# --------------------------------------------------------------------------
# Git history
# --------------------------------------------------------------------------

def _day(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d")


def history(root: Path, now: dt.datetime) -> dict:
    if not is_repo_root(root):
        return {"available": False, "reason": "This folder is not the root of a git repository, so history is not read."}
    try:
        stamps = [int(s) for s in git(root, "log", "--format=%ct").split()]
    except RuntimeError:
        return {"available": False, "reason": "The repository has no readable commits."}
    if not stamps:
        return {"available": False, "reason": "The repository has no commits."}
    shallow = git(root, "rev-parse", "--is-shallow-repository").strip() == "true"
    tag_rows = [r.split() for r in git(root, "for-each-ref", "--format=%(refname:short) %(creatordate:unix)", "refs/tags").splitlines()]
    tags = [(r[0], int(r[1])) for r in tag_rows if len(r) == 2 and r[1].isdigit()]
    first, last = min(stamps), max(stamps)
    now_ts = now.timestamp()
    years: dict[int, int] = defaultdict(int)
    for _, ts in tags:
        years[dt.datetime.fromtimestamp(ts, dt.timezone.utc).year] += 1
    commit_years: dict[int, int] = defaultdict(int)
    for s in stamps:
        commit_years[dt.datetime.fromtimestamp(s, dt.timezone.utc).year] += 1
    latest = max(tags, key=lambda t: t[1])[0] if tags else None
    return {
        "available": True,
        "history_truncated": shallow,
        "head_commit": git(root, "rev-parse", "HEAD").strip(),
        "first_commit": _day(first),
        "last_commit": _day(last),
        "application_age_years": round((now_ts - first) / (365.25 * 86400), 1),
        "days_since_last_commit": int((now_ts - last) // 86400),
        "total_commits": len(stamps),
        "commits_last_12_months": sum(1 for s in stamps if s >= now_ts - 365 * 86400),
        "release_tag_count": len(tags),
        "latest_release_tag": latest,
        "release_tags_per_year": dict(sorted(years.items())),
        "commits_per_year": dict(sorted(commit_years.items())),
    }


# --------------------------------------------------------------------------
# Detectors. Each one adds findings to `out`, keyed by finding id.
# --------------------------------------------------------------------------

PURPOSE_SKIP_HEADINGS = {"installation", "install", "usage", "license", "licence", "contributing", "development",
                         "setup", "getting started", "testing", "tests", "deployment", "roadmap", "changelog",
                         "authors", "credits", "acknowledgements", "table of contents", "contents"}


def _first_paragraph(md: str) -> str:
    """The first plain paragraph of a README, skipping headings, badges, lists, tables and code."""
    md = re.sub(r"```.*?```", "", md, flags=re.S)
    md = re.sub(r"<[^>]+>", " ", md)
    for block in re.split(r"\n\s*\n", md):
        lines = [l.strip() for l in block.splitlines() if l.strip()]
        if not lines or any(l.startswith(("#", "!", "[", "|", "-", "*", ">", "=")) for l in lines):
            continue
        text = " ".join(lines)
        if len(text) >= 40:
            return text[:400]
    return ""


def detect_purpose(repo: Repo, out: dict) -> None:
    """What the project says it is, in its own words: name, description, README and home page. Nothing is written by Cutover."""
    name = ""
    summary = ""
    source = ""
    features: list[str] = []
    pkg = repo.files.get("package.json")
    if pkg:
        try:
            data = json.loads(pkg)
            name = str(data.get("name") or "")
            if data.get("description"):
                summary, source = str(data["description"]), "package.json"
        except ValueError:
            pass
    pyproject = repo.files.get("pyproject.toml")
    if pyproject:
        m = re.search(r'^name\s*=\s*"([^"]+)"', pyproject, re.M)
        if m and not name:
            name = m.group(1)
        d = re.search(r'^description\s*=\s*"([^"]+)"', pyproject, re.M)
        if d and not summary:
            summary, source = d.group(1), "pyproject.toml"
    readme = next((p for p in repo.paths if re.fullmatch(r"(?i)readme(\.md|\.rst|\.txt)?", p)), None)
    if readme:
        text = repo.files.get(readme, "")
        heading = re.search(r"^#\s+(.+)$", text, re.M)
        if heading and not name:
            name = heading.group(1).strip()[:120]
        para = _first_paragraph(text)
        if para and not summary:
            summary, source = para, readme
        features = [h.strip()[:60] for h in re.findall(r"^##\s+(.+)$", text, re.M)
                    if h.strip().lower() not in PURPOSE_SKIP_HEADINGS][:8]
    home = next((p for p in repo.paths if p.lower() in ("index.html", "public/index.html", "src/index.html")), None)
    if home:
        t = repo.files.get(home, "")
        meta = re.search(r"<meta\s+name=[\"']description[\"']\s+content=[\"']([^\"']+)", t, re.I)
        if meta and not summary:
            summary, source = " ".join(meta.group(1).split())[:400], home
        title = re.search(r"<title>(.*?)</title>", t, re.I | re.S)
        if title and not name:
            name = " ".join(title.group(1).split())[:120]
        h1 = re.search(r"<h1\b[^>]*>(.*?)</h1>", t, re.I | re.S)
        if h1 and not summary:
            headline = " ".join(re.sub(r"<[^>]+>", " ", h1.group(1)).split())[:200]
            if headline:
                summary, source = f"Home page headline: {headline}", home
    if not summary and not name:
        return
    out["app.purpose"] = F(
        "app.purpose", "ui_portal", "What the project says it is",
        {"name": name, "summary": summary, "source": source, "features": features},
        "verified", [source] if source else [],
        note="Taken from the project's own name, description, README or home page. Cutover does not write this text.",
    )


def detect_stack(repo: Repo, out: dict) -> None:
    poms = [p for p in repo.paths if p == "pom.xml" or p.endswith("/pom.xml")]
    gradles = [p for p in repo.paths if p.endswith(("build.gradle", "build.gradle.kts"))]

    langs = []
    if poms or gradles:
        langs.append("Java/JVM")
    if any(p.endswith(".kt") for p in repo.paths):
        langs.append("Kotlin")
    if any(p.endswith("package.json") for p in repo.paths):
        langs.append("JavaScript/TypeScript")
    if any(p.endswith(("requirements.txt", "pyproject.toml", "setup.py")) for p in repo.paths):
        langs.append("Python")
    if any(p.endswith("go.mod") for p in repo.paths):
        langs.append("Go")
    if any(p.endswith(".csproj") for p in repo.paths):
        langs.append(".NET")
    out["stack.languages"] = F("stack.languages", "stack", "Languages detected", langs or ["none found"], "verified", poms + gradles)

    for p in poms:
        t = repo.files.get(p, "")
        if "runtime.spring_boot" not in out:
            m = re.search(r"<artifactId>spring-boot-starter-parent</artifactId>\s*<version>([^<]+)</version>", t)
            if m:
                out["runtime.spring_boot"] = F("runtime.spring_boot", "stack", "Spring Boot version", m.group(1).strip(), "verified", [p])
        if "runtime.java" not in out:
            m = (re.search(r"<java\.version>\s*([^<\s]+)\s*</java\.version>", t)
                 or re.search(r"<maven\.compiler\.(?:release|source)>\s*([^<\s]+)", t))
            if m:
                out["runtime.java"] = F("runtime.java", "stack", "Java version", m.group(1), "verified", [p])

    for p in gradles:
        t = repo.files.get(p, "")
        if "runtime.spring_boot" not in out:
            m = re.search(r"org\.springframework\.boot['\"]\)?\s*version\s*['\"]([\d.]+)", t)
            if m:
                out["runtime.spring_boot"] = F("runtime.spring_boot", "stack", "Spring Boot version", m.group(1), "verified", [p])
        if "runtime.java" not in out:
            m = re.search(r"jvmToolchain\((\d+)\)|sourceCompatibility\s*=\s*['\"]?([\d.]+)|JavaVersion\.VERSION_(\d+)", t)
            if m:
                value = next(g for g in m.groups() if g)
                out["runtime.java"] = F("runtime.java", "stack", "Java version", value, "verified", [p])

    modules: set[str] = set()
    for p in poms + gradles:
        modules |= set(re.findall(r"(spring-boot-starter-[a-z0-9-]+)", repo.files.get(p, "")))
    modules.discard("spring-boot-starter-parent")
    if modules:
        out["stack.spring_modules"] = F("stack.spring_modules", "stack", "Spring Boot starters declared",
                                        sorted(modules), "verified", poms + gradles)

    engines: dict[str, set[str]] = defaultdict(set)
    for p, t in repo.files.items():
        for m in re.finditer(r"jdbc:(sqlserver|mysql|postgresql|oracle|h2):", t, re.I):
            engines[ENGINE_NAMES[m.group(1).lower()]].add(p)
    for p in poms + gradles:
        t = repo.files.get(p, "")
        for artifact, name in DRIVER_HINTS:
            if artifact in t:
                engines[name].add(p)
    ev = set().union(*engines.values()) if engines else set()
    out["data.database_engines"] = F("data.database_engines", "data", "Database engines",
                                     sorted(engines) or ["none found"], "verified", ev,
                                     note="From JDBC URLs and database driver dependencies.")

    frontend = set()
    for p in repo.paths:
        if p.endswith("package.json") and p in repo.files:
            try:
                data = json.loads(repo.files[p])
            except ValueError:
                continue
            deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
            if any(k in deps for k in ("react", "@angular/core", "vue", "next")):
                frontend.add(p)
    if frontend:
        out["stack.frontend"] = F("stack.frontend", "stack", "Frontend framework package",
                                  "yes", "verified", frontend)


def screen_structure(text: str) -> dict:
    """What one screen's markup contains. Only counts and heading text are kept; nothing is invented."""
    t = text or ""
    heads = []
    for h in re.findall(r"<h[1-3]\b[^>]*>(.*?)</h[1-3]>", t, re.I | re.S):
        label = " ".join(re.sub(r"<[^>]+>|\{[^}]*\}", " ", h).split())
        if label:
            heads.append(label[:60])
    submits = len(re.findall(r"<input\b[^>]*type=[\"']submit[\"']", t, re.I))
    sections = []
    for m in re.finditer(r"<section\b[^>]*>(.*?)</section>", t, re.I | re.S):
        body = m.group(1)
        h = re.search(r"<h[1-3]\b[^>]*>(.*?)</h[1-3]>", body, re.I | re.S)
        sections.append({
            "title": " ".join(re.sub(r"<[^>]+>", " ", h.group(1)).split())[:60] if h else "",
            "inputs": min(len(re.findall(r"<(?:input|select|textarea)\b", body, re.I)), 20),
            "buttons": min(len(re.findall(r"<button\b", body, re.I)), 20),
            "images": min(len(re.findall(r"<(?:img|video)\b", body, re.I)), 20),
        })
    table = re.search(r"<table\b.*?</table>", t, re.I | re.S)
    return {
        "sections": sections[:8],
        "section_count": min(len(sections), 50),
        "headings": heads[:3],
        "forms": min(len(re.findall(r"<form\b", t, re.I)), 50),
        "inputs": min(max(len(re.findall(r"<(?:input|select|textarea)\b", t, re.I)) - submits, 0), 50),
        "buttons": min(len(re.findall(r"<button\b", t, re.I)) + submits, 50),
        "tables": min(len(re.findall(r"<table\b", t, re.I)), 50),
        "table_columns": min(len(re.findall(r"<th\b", table.group(0), re.I)) if table else 0, 12),
        "lists": min(len(re.findall(r"<(?:ul|ol)\b", t, re.I)), 50),
        "images": min(len(re.findall(r"<img\b", t, re.I)), 50),
    }


CLIENT_FILE_HINT = re.compile(r"portal|patient|client|customer|member|self.?service", re.I)


# ---- Page previews: a simple element tree per static HTML page, with sample values for dynamic ones.
PREVIEW_TAGS = {
    "h1", "h2", "h3", "h4", "p", "a", "button", "label", "nav", "header", "footer", "main", "section",
    "form", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "img", "input", "select",
    "textarea", "div", "span", "strong", "em", "small", "figure", "figcaption", "video", "article", "aside",
}
PREVIEW_SKIP = {"script", "style", "noscript", "template", "svg", "iframe", "object", "head", "title"}
PREVIEW_IGNORE = {"html", "body", "meta", "link", "base"}
PREVIEW_VOID = {"img", "input", "br", "hr", "source", "meta", "link", "base"}
PREVIEW_TEXT_MAX = 140
PREVIEW_MAX_NODES = 250
PREVIEW_SAMPLE = "Sample value"
TEMPLATE_RX = re.compile(r"\$\{[^}]*\}|\{\{.*?\}\}|<%.*?%>|\{%.*?%\}|th:[\w:-]+=\"[^\"]*\"", re.S)
LOOP_RX = re.compile(r"th:each|\{%\s*for\s|\.map\(|v-for=|ng-repeat=|\*ngFor", re.I)
FETCH_RX = re.compile(r"\bfetch\(|\baxios\.|\bXMLHttpRequest\b|\buseEffect\(|\bgetServerSideProps\b|\.from\(['\"]", re.I)


def clean_preview_text(s: str) -> str:
    """Visible text only. Template expressions become sample values."""
    s = TEMPLATE_RX.sub(PREVIEW_SAMPLE, s or "")
    return " ".join(s.split())[:PREVIEW_TEXT_MAX]


class _PreviewParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root: dict = {"tag": "div", "children": []}
        self.stack = [self.root]
        self.skip = 0
        self.nodes = 0
        self.truncated = False

    def handle_starttag(self, tag, attrs):
        if tag in PREVIEW_SKIP:
            self.skip += 1
            return
        if self.skip or tag in PREVIEW_IGNORE:
            return
        if self.nodes >= PREVIEW_MAX_NODES:
            self.truncated = True
            return
        self.nodes += 1
        a = {k: (v or "") for k, v in attrs}
        node: dict = {"tag": tag if tag in PREVIEW_TAGS else "div", "children": []}
        if node["tag"] == "input":
            node["type"] = (re.sub(r"[^a-z]", "", a.get("type", "text").lower())[:20]) or "text"
        if a.get("placeholder"):
            node["placeholder"] = clean_preview_text(a["placeholder"])
        if tag == "img":
            node["alt"] = clean_preview_text(a.get("alt", ""))
        if LOOP_RX.search(" ".join(f"{k}={v}" for k, v in attrs)):
            node["loop"] = True
        if any(k.startswith("th:text") or k.startswith("th:utext") for k in a):
            node["children"].append(PREVIEW_SAMPLE)
            node["replaced"] = True
        self.stack[-1]["children"].append(node)
        if tag not in PREVIEW_VOID:
            self.stack.append(node)

    def handle_endtag(self, tag):
        if tag in PREVIEW_SKIP:
            self.skip = max(0, self.skip - 1)
            return
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i]["tag"] == tag:
                node = self.stack[i]
                del self.stack[i:]
                if node.get("loop"):
                    # A repeated block: show three sample rows or items.
                    parent = self.stack[-1]
                    idx = parent["children"].index(node)
                    copies = []
                    for _ in range(3):
                        c = copy.deepcopy(node)
                        c.pop("loop", None)
                        copies.append(c)
                    parent["children"][idx:idx + 1] = copies
                return

    def handle_data(self, data):
        if self.skip or self.nodes >= PREVIEW_MAX_NODES:
            return
        if self.stack[-1].get("replaced"):
            return
        text = clean_preview_text(data)
        if text:
            self.stack[-1]["children"].append(text)


def page_preview(text: str):
    """What a static or dynamic HTML page shows, as text and layout. None if the file has no markup."""
    if not text or not re.search(r"<[a-zA-Z]", text):
        return None
    reasons = []
    if TEMPLATE_RX.search(text):
        reasons.append("Values come from template expressions")
    if LOOP_RX.search(text):
        reasons.append("Lists are built from data in a loop")
    if FETCH_RX.search(text):
        reasons.append("Data is loaded by the page script")
    parser = _PreviewParser()
    parser.feed(text)
    parser.close()
    return {
        "kind": "dynamic" if reasons else "static",
        "reasons": reasons,
        "tree": parser.root["children"],
        "truncated": parser.truncated,
    }


def detect_ui(repo: Repo, out: dict) -> None:
    code = {p: t for p, t in repo.files.items() if p.endswith((".java", ".kt"))}
    controllers = [p for p, t in code.items() if re.search(r"@(?:Rest)?Controller\b", t)]
    endpoints = sum(len(re.findall(MAPPING_RX, code[p])) for p in controllers)
    out["ui.endpoints"] = F(
        "ui.endpoints", "ui_portal", "Endpoints declared in controllers",
        {"controllers": len(controllers), "endpoint_annotations": endpoints},
        "verified", controllers,
        note="Counts mapping annotations. Class-level prefixes are not joined, so this is not a list of full URLs.",
    )

    screens = [
        p for p in repo.paths
        if re.search(r"(^|/)templates/.*\.(html?|jsp|xhtml|cshtml)$", p, re.I)
        or re.search(r"(^|/)static/.*\.html?$", p, re.I)
        or re.search(r"(^|/)(src/)?(app|pages|views|screens)/.*\.(tsx|jsx|vue)$", p)
        or re.search(r"(^|/)(src/)?(pages|routes)/.*\.(astro|svelte)$", p)
        or re.search(r"^[^/]+\.html?$", p, re.I)
    ]
    out["ui.screens"] = F(
        "ui.screens", "ui_portal", "Screens (templates and page components)", len(screens),
        "inferred", screens,
        note="Each template or page component counts as one screen. Fragments and email templates are included, so confirm the count with the team.",
    )

    # Screen names come from the file names, so the client can draw a preview. Roles are listed only
    # where the code names them in a security annotation; nothing is guessed.
    names = {}
    for p in screens:
        base = re.sub(r"\.[A-Za-z]+$", "", p.rsplit("/", 1)[-1])
        label = " ".join(w.capitalize() for w in re.split(r"[-_.\s]+", base) if w)
        title = re.search(r"<title>(.*?)</title>", repo.files.get(p, ""), re.I | re.S)
        if title and " ".join(title.group(1).split()):
            label = " ".join(title.group(1).split())[:90]
        if label:
            names.setdefault(label, p)
    if names:
        out["ui.screen_names"] = F(
            "ui.screen_names", "ui_portal", "Screen names from file names",
            {"count": len(names), "screens": [{"name": n, "path": names[n], **screen_structure(repo.files.get(names[n], ""))} for n in sorted(names)][:60]},
            "inferred", [names[n] for n in sorted(names)][:EVIDENCE_LIMIT],
            note="Each name is taken from a template or page file name, so it shows what the screen is called in the code.",
        )

    label_for = {path: label for label, path in names.items()}
    previews = []
    for p in sorted(screens):
        if not re.search(r"\.html?$", p, re.I):
            continue
        pv = page_preview(repo.files.get(p, ""))
        if pv is None:
            continue
        previews.append({"name": label_for.get(p, p.rsplit("/", 1)[-1]), "path": p, **pv})
        if len(previews) == 4:
            break
    if previews:
        out["ui.page_preview"] = F(
            "ui.page_preview", "ui_portal", "Pages drawn from the code",
            {"count": len(previews), "pages": previews},
            "inferred", [x["path"] for x in previews],
            note="Each page is drawn from its markup. Source code is not stored: only visible text, layout and sample values are kept.",
        )

    roles: dict[str, int] = defaultdict(int)
    role_files: set[str] = set()
    for p, t in repo.files.items():
        if not p.endswith((".java", ".kt", ".html", ".tsx", ".jsx", ".vue", ".cs")):
            continue
        # Only client-facing code counts toward the portal. Staff-only roles are left out.
        if not CLIENT_FILE_HINT.search(p.rsplit("/", 1)[-1]):
            continue
        for m in re.finditer(r"hasRole\(\s*['\"](\w+)['\"]\s*\)|hasAuthority\(\s*['\"](\w+)['\"]\s*\)|@RolesAllowed\(\s*\{?\s*['\"](\w+)['\"]", t):
            role = next(g for g in m.groups() if g)
            roles[role] += 1
            role_files.add(p)
    if roles:
        out["ui.roles"] = F(
            "ui.roles", "ui_portal", "Roles named in access rules",
            {"count": len(roles), "roles": dict(sorted(roles.items()))},
            "verified", sorted(role_files)[:EVIDENCE_LIMIT],
            note="Only roles written into access rules in client-facing code are listed. Staff-only roles are left out.",
        )

    portal_terms = {
        p for p, t in repo.files.items()
        if p.endswith((".java", ".kt", ".html", ".tsx", ".jsx", ".vue", ".cs"))
        and re.search(r"\b(patient|portal|appointment|guardian|proxy)\b", t, re.I)
    }
    likely_client = bool(screens) and bool(portal_terms)
    out["ui.client_facing"] = F(
        "ui.client_facing", "ui_portal", "Client-facing portal likely", "yes" if likely_client else "not indicated",
        "inferred", portal_terms if likely_client else [],
        note="Inferred from UI files plus patient or portal vocabulary. Confirm with the application owner.",
    )

    roles: dict[str, set[str]] = defaultdict(set)

    def add(name: str, path: str) -> None:
        roles[re.sub(r"^ROLE_", "", name).upper()].add(path)

    for p, t in repo.files.items():
        if not p.endswith((".java", ".kt", ".xml", ".yml", ".yaml", ".properties", ".ts", ".tsx", ".js", ".jsx", ".py", ".cs")):
            continue
        for m in re.finditer(r"hasRole\(\s*['\"]([A-Za-z0-9_]+)['\"]", t):
            add(m.group(1), p)
        for m in re.finditer(r"hasAuthority\(\s*['\"]([^'\"]+)['\"]", t):
            add(m.group(1), p)
        for m in re.finditer(r"hasAnyRole\(([^)]*)\)|@(?:RolesAllowed|Secured)\(([^)]*)\)", t):
            for q in re.findall(r"['\"]([A-Za-z0-9_]+)['\"]", m.group(1) or m.group(2) or ""):
                add(q, p)
        for m in re.finditer(r"\bROLE_[A-Z][A-Z0-9_]*\b", t):
            add(m.group(0), p)
    ev = set().union(*roles.values()) if roles else set()
    out["security.roles"] = F(
        "security.roles", "security", "Roles found in code", sorted(roles), "verified", ev,
        note="Taken from authorization annotations and role constants. Roles defined only in the identity provider or database are not visible.",
    )


def detect_data(repo: Repo, out: dict) -> None:
    sql = [p for p in repo.paths if p.lower().endswith(".sql") and p in repo.files]
    tables: dict[str, set[str]] = defaultdict(set)
    for p in sql:
        for m in re.finditer(r'create\s+table\s+(?:if\s+not\s+exists\s+)?[`"\[]?([A-Za-z_][\w$]*)', repo.files[p], re.I):
            tables[m.group(1).lower()].add(p)
    ev = set().union(*tables.values()) if tables else set()
    out["data.tables"] = F(
        "data.tables", "data", "Tables in SQL scripts", {"count": len(tables), "names": sorted(tables)},
        "verified", ev,
        note="Read from CREATE TABLE statements. Names are merged across database engines and deduplicated.",
    )

    flyway = [p for p in repo.paths if re.search(r"(^|/)V\d+[^/]*__[^/]*\.sql$", p)]
    liquibase = [p for p, t in repo.files.items() if "databaseChangeLog" in t]
    tool = "Flyway" if flyway else "Liquibase" if liquibase else "none found"
    out["data.migrations"] = F("data.migrations", "data", "Schema migration tool",
                               {"tool": tool, "scripts": len(flyway)}, "verified", flyway or liquibase)

    entities = sorted(p for p, t in repo.files.items() if re.search(r"^\s*@Entity\b", t, re.M))
    mapped = sorted({n for p in entities for n in re.findall(r'@Table\(\s*name\s*=\s*"([^"]+)"', repo.files[p])})
    out["data.entities"] = F("data.entities", "data", "JPA entities",
                             {"count": len(entities), "table_names": mapped}, "verified", entities)

    dialects = sorted({SQL_DIALECT_HINTS[k] for p in sql for k in SQL_DIALECT_HINTS if k in p.lower()})
    if dialects:
        out["data.sql_dialects"] = F("data.sql_dialects", "data", "Database-specific SQL scripts",
                                     dialects, "verified", sql)


def detect_epic(repo: Repo, out: dict) -> None:
    fhir_versions: dict[str, set[str]] = defaultdict(set)
    url_files: dict[str, set[str]] = defaultdict(set)
    for p, t in repo.files.items():
        for m in re.finditer(r"/api/FHIR/(R\d)\b", t):
            fhir_versions[m.group(1)].add(p)
        for u in re.findall(FHIR_URL, t):
            url_files[u].add(p)

    if fhir_versions:
        out["epic.fhir_versions"] = F("epic.fhir_versions", "epic", "FHIR API versions referenced",
                                      sorted(fhir_versions), "verified", set().union(*fhir_versions.values()),
                                      note="FHIR is a standard. Confirm the vendor is Epic using the Epic-specific signals below.")
    if url_files:
        out["epic.fhir_endpoints"] = F("epic.fhir_endpoints", "epic", "Distinct FHIR endpoint URLs",
                                       len(url_files), "verified", set().union(*url_files.values()),
                                       note="URL hosts are counted but not written to output.")

    specific = hits(repo, EPIC_SPECIFIC)
    out["epic.epic_specific"] = F("epic.epic_specific", "epic", "Epic-specific endpoints or hosts",
                                  "yes" if specific else "no", "verified", specific)

    smart = hits(repo, SMART_SIGNALS)
    out["epic.smart_auth_signals"] = F("epic.smart_auth_signals", "epic", "SMART or OAuth backend-auth signals",
                                       "yes" if smart else "no", "verified", smart)

    bridges = hits(repo, r"\bBridges\b")
    if bridges:
        out["epic.bridges_references"] = F("epic.bridges_references", "epic", "References to Bridges configuration",
                                           len(bridges), "inferred", bridges,
                                           note="The word Bridges can be unrelated. Confirm against an Epic export.")

    msg_types: dict[str, set[str]] = defaultdict(set)
    for p, t in repo.files.items():
        for m in re.finditer(HL7_MSG, t):
            msg_types[f"{m.group(1)}^{m.group(2)}"].add(p)
    msh = hits(repo, r"^MSH\|", re.M)
    if msh or msg_types:
        out["epic.hl7_message_types"] = F(
            "epic.hl7_message_types", "epic", "HL7 v2 message types in files",
            sorted(msg_types) or ["none found"], "verified",
            set().union(*msg_types.values()) if msg_types else msh,
        )

    pid = hits(repo, r"^PID\|", re.M)
    if pid:
        out["privacy.hl7_patient_segments"] = F(
            "privacy.hl7_patient_segments", "privacy", "Files with HL7 patient identifier (PID) segments",
            len(pid), "verified", pid, severity="high",
            note="Identifier values are not recorded. Redact these files before they are stored or sent to any model.",
        )


def _image(path: str, ref: str, source: str) -> dict:
    base = ref.split("@")[0]
    last = base.rsplit("/", 1)[-1]
    tag = last.split(":", 1)[1] if ":" in last else None
    return {
        "file": path, "source": source, "image": ref, "tag": tag or "none",
        "pinned_by_digest": "@sha256:" in ref,
        "uses_latest_or_no_tag": tag in (None, "latest"),
    }


def detect_containers(repo: Repo, out: dict) -> None:
    images: list[dict] = []
    for p in repo.paths:
        if p not in repo.files:
            continue
        name = p.rsplit("/", 1)[-1]
        t = repo.files[p]
        if name == "Dockerfile" or name.startswith("Dockerfile."):
            aliases = {a.lower() for a in re.findall(r"\bAS\s+(\S+)", t, re.I)}
            for m in re.finditer(r"^\s*FROM\s+(?:--\S+\s+)*([^\s$][^\s]*)", t, re.M | re.I):
                ref = m.group(1)
                if ref.lower() in aliases or ref.lower() == "scratch":
                    continue
                images.append(_image(p, ref, "Dockerfile"))
        elif re.search(r"(^|[-_])compose[^/]*\.ya?ml$", name, re.I):
            for m in re.finditer(r"^\s*image:\s*['\"]?([^\s'\"#]+)", t, re.M):
                images.append(_image(p, m.group(1), "compose"))

    severity = None
    if any(i["uses_latest_or_no_tag"] for i in images):
        severity = "high"
    elif any(not i["pinned_by_digest"] for i in images):
        severity = "medium"
    out["containers.images"] = F(
        "containers.images", "containers", "Container base and service images", images,
        "verified", [i["file"] for i in images],
        note="A tag can change after you test it. Pin by digest before migrating.",
        severity=severity,
    )


def detect_delivery(repo: Repo, out: dict) -> None:
    ci = [p for p in repo.paths if re.search(CI_RX, p)]

    def name(p: str) -> str:
        if ".github/workflows/" in p:
            return "GitHub Actions"
        if "azure-pipelines" in p:
            return "Azure Pipelines"
        if p.endswith("Jenkinsfile"):
            return "Jenkins"
        if "gitlab-ci" in p:
            return "GitLab CI"
        if "bitbucket-pipelines" in p:
            return "Bitbucket Pipelines"
        return "CircleCI"

    systems = sorted({name(p) for p in ci})
    out["delivery.ci"] = F("delivery.ci", "delivery", "CI/CD pipelines", systems or ["none found"], "verified", ci)


def detect_infrastructure(repo: Repo, out: dict) -> None:
    tf = [p for p in repo.paths if p.endswith(".tf")]
    providers = sorted({m for p in tf for m in re.findall(r'provider\s+"(\w+)"', repo.files.get(p, ""))})
    bicep = [p for p in repo.paths if p.endswith(".bicep")]
    helm = [p for p in repo.paths if p.endswith("Chart.yaml")]
    cfn = sorted(hits(repo, r"AWSTemplateFormatVersion"))
    k8s = sorted(p for p, t in repo.files.items()
                 if p.endswith((".yml", ".yaml")) and re.search(r"^apiVersion:", t, re.M) and re.search(r"^kind:", t, re.M))
    kube_kinds = sorted({k for p in k8s for k in re.findall(r"^kind:\s*(\w+)", repo.files[p], re.M)})
    compose = [p for p in repo.paths if re.search(r"(^|[-_/])compose[^/]*\.ya?ml$", p, re.I)]

    summary = {
        "terraform_files": len(tf), "terraform_providers": providers,
        "bicep_files": len(bicep), "helm_charts": len(helm),
        "cloudformation_templates": len(cfn), "kubernetes_manifests": len(k8s),
        "kubernetes_kinds": kube_kinds, "compose_files": len(compose),
    }
    has_iac = bool(tf or bicep or helm or cfn or k8s)
    out["infrastructure.as_code"] = F(
        "infrastructure.as_code", "infrastructure", "Infrastructure defined as code", summary, "verified",
        tf + bicep + helm + cfn + k8s + compose,
        note=None if has_iac else "No infrastructure-as-code found. The live environment must be inventoried through read-only cloud access or the inventory script.",
        severity=None if has_iac else "medium",
    )


def detect_legacy(repo: Repo, root: Path, out: dict, metadata: list[dict]) -> None:
    """Legacy languages, screens in classic ASP, tables used in legacy SQL, database files, and the metadata
    from the read-only script. Tier 3 files are counted, not read."""
    langs: dict[str, dict] = {}
    lang_files: dict[str, set[str]] = defaultdict(set)
    pack_screens: set[str] = set()
    pack_tables: dict[str, set[str]] = defaultdict(set)
    depends: dict[str, set[str]] = defaultdict(set)
    for p in repo.paths:
        text = repo.files.get(p)
        lang = inventory.language_for(p, text)
        if not lang:
            continue
        row = langs.setdefault(lang["name"], {"tier": lang["tier"], "files": 0, "status": lang["status"]})
        row["files"] += 1
        lang_files[lang["name"]].add(p)
        pack = lang["pack"]
        if pack is None or text is None or pack.name in ("Classic ASP", "Classic ASP include"):
            continue  # classic ASP is read by the ASP functions below
        result = languages.extract(pack, p, text)
        pack_screens |= {f"{name} ({p})" for name in result.screens}
        for t in result.tables:
            pack_tables[t].add(p)
        for d in result.depends:
            depends[d].add(p)
    if langs:
        rows = [f"{name} (tier {v['tier']}): {v['files']} files, {v['status']}"
                for name, v in sorted(langs.items(), key=lambda kv: (kv[1]["tier"], kv[0]))]
        out["legacy.languages"] = F("legacy.languages", "stack", "Legacy languages detected", rows, "verified",
                                    set().union(*lang_files.values()),
                                    note="Tier 1 and 2 are read as source. Tier 3 is counted by file extension only.")
    if depends:
        out["legacy.dependencies"] = F("legacy.dependencies", "stack", "Programs and modules the legacy code calls or uses",
                                       {"count": len(depends), "names": sorted(depends, key=str.lower)[:200]}, "inferred",
                                       set().union(*depends.values()),
                                       note="Names as the code writes them, taken from calls, uses and includes. Not checked against the systems they name.")

    views = legacy.asp_views(repo.files)
    pages = legacy.asp_pages(repo.paths)
    pages_without_views = [p for p in pages if p in repo.files and not legacy.views_in(repo.files[p])]
    if pack_screens and not (views or pages):
        prior = out.get("ui.screens", {}).get("value") or 0
        out["ui.screens"] = F("ui.screens", "ui_portal", "Screens (templates, page components and legacy forms)",
                              (prior if isinstance(prior, int) else 0) + len(pack_screens), "inferred", set(),
                              note="Each template, page component, form, map or window counts as one screen. Confirm the count with the team.")
    if views or pages:
        out["legacy.views"] = F("legacy.views", "ui_portal", "Screens switched in classic ASP code",
                                {"count": len(views), "names": sorted(views, key=str.lower)[:200]}, "verified",
                                set(views.values()),
                                note="Each distinct ControlName value is one screen. Names come from the code and are capped at 200.")
        # Screens: each view, plus each page that does not switch views. Pages that switch views are not counted twice.
        prior = out.get("ui.screens", {}).get("value") or 0
        if not isinstance(prior, int):
            prior = 0
        total = prior + len(views) + len(pages_without_views) + len(pack_screens)
        out["ui.screens"] = F("ui.screens", "ui_portal", "Screens (templates, page components, ASP views and legacy forms)", total,
                              "inferred", set(views.values()) | set(pages_without_views),
                              note="Each template or page component counts as one screen, and each classic ASP view counts as one. Fragments and email templates are included, so confirm the count with the team.")

    code_tables: dict[str, set[str]] = defaultdict(set)
    spelled: dict[str, Counter] = defaultdict(Counter)
    for key, files_using in legacy.sql_tables(repo.files).items():
        spelled[key.lower()][key] += 1
        code_tables[key.lower()] |= set(files_using)
    for key, files_using in pack_tables.items():
        spelled[key.lower()][key] += 1
        code_tables[key.lower()] |= files_using
    if code_tables:
        shown = {k: spelled[k].most_common(1)[0][0] for k in code_tables}
        names = [shown[k] for k in sorted(code_tables)]
        out["data.tables_in_code"] = F("data.tables_in_code", "data", "Tables used in SQL in legacy code",
                                       {"count": len(names), "names": names}, "inferred",
                                       set().union(*code_tables.values()),
                                       note="Read from SQL in legacy code, in string literals and in statements. The database itself is not opened, so these are the names the code uses, not a schema.")

    routine_names = legacy.routines(repo.files)
    out["data.routines_in_code"] = F("data.routines_in_code", "data", "Views, stored procedures and functions in code",
                                     {"views": len(routine_names["views"]), "procedures": len(routine_names["procedures"]),
                                      "functions": len(routine_names["functions"]),
                                      "names": {k: sorted(v.values(), key=str.lower)[:200] for k, v in routine_names.items()}},
                                     "verified", set(),
                                     note="Read from CREATE statements in the code. Objects that exist only inside a database, such as Access saved queries, appear once a structure file lists them.")

    dbs = legacy.database_files(root, repo.paths)
    if dbs:
        out["legacy.databases"] = F("legacy.databases", "data", "Database files found",
                                    [f"{d['engine']} (tier {d['tier']}): {d['path']} ({d['identified']})" for d in dbs],
                                    "verified", [d["path"] for d in dbs],
                                    note="Identified from the first bytes of each file where possible. The contents are not opened here.")
        engines = sorted({d["engine"] for d in dbs if d["tier"] < 3})
        current = out.get("data.database_engines")
        if current is not None and engines:
            names = [v for v in (current.get("value") or []) if v != "none found"]
            ev = set(current.get("evidence") or []) | {d["path"] for d in dbs}
            out["data.database_engines"] = F("data.database_engines", "data", "Database engines",
                                             sorted(set(names) | set(engines)), "verified", ev,
                                             note="From JDBC URLs, driver dependencies and database file signatures.")

    if metadata:
        tables = [t for doc in metadata for t in doc["tables"]]
        detail = [{"name": t["name"], "row_count": t.get("row_count"),
                   "fields": [{"name": c["name"], "type": c["type"], "nullable": c["nullable"]} for c in t["columns"]]}
                  for t in sorted(tables, key=lambda t: t["name"].lower())][:300]
        out["data.database_metadata"] = F(
            "data.database_metadata", "data", "Tables and fields from metadata files",
            {"databases": len(metadata), "tables": len(tables), "fields": sum(len(t["columns"]) for t in tables),
             "table_names": sorted({t["name"] for t in tables}, key=str.lower)[:300], "detail": detail},
            "verified", [doc["database"] for doc in metadata],
            note="From the read-only metadata script: names, types, nullability and row counts. No row values are included.")

    skipped = [{"path": r["path"], "reason": r["reason"]} for r in legacy.not_read_yet(repo.files, repo.paths, 0)]
    skipped += [{"path": p, "reason": "Over the 2 MB limit, so not read."} for p in repo.too_large]
    if skipped:
        out["legacy.not_read"] = F("legacy.not_read", "stack", "Files listed but not read",
                                   {"count": len(skipped), "files": [r["path"] for r in skipped][:100]},
                                   "verified", [r["path"] for r in skipped],
                                   note="Each file is listed with the reason it was not read. Confirm these by hand.")


def git_dates_for(root: Path) -> dict:
    """First and last commit date per path. Empty when the folder is not a git repository, and when the history is
    shallow: a shallow clone holds only the newest commits, so every file would look new."""
    if not is_repo_root(root):
        return {}
    try:
        if git(root, "rev-parse", "--is-shallow-repository").strip() == "true":
            return {}
    except RuntimeError:
        return {}
    try:
        return age.git_dates(git(root, "log", "--name-only", "--format=%ad", "--date=short", "-n", "20000"))
    except RuntimeError:
        return {}


def analyze(repo: Repo, root: Path, now: dt.datetime, source: dict, metadata: list[dict] | None = None) -> dict:
    out: dict = {}
    detect_stack(repo, out)
    detect_purpose(repo, out)
    detect_ui(repo, out)
    detect_data(repo, out)
    detect_legacy(repo, root, out, metadata or [])
    records, summary = inventory.build(root, repo.paths, repo.files, git_dates_for(root), now)
    out["legacy.inventory"] = F("legacy.inventory", "stack", "Every file, by kind and language", summary, "verified",
                                [r["path"] for r in records if r["identified_by"] == "none"][:EVIDENCE_LIMIT],
                                note="Each file is listed in inventory.json with its kind, language, age range and encoding. Unidentified files are named, never guessed at.")
    detect_epic(repo, out)
    detect_containers(repo, out)
    detect_delivery(repo, out)
    detect_infrastructure(repo, out)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
        "history": history(root, now),
        "findings": out,
        "flags": sorted(k for k, v in out.items() if v.get("severity")),
        "limitations": LIMITATIONS,
        "inventory": records,
    }


# --------------------------------------------------------------------------
# Report rendering
# --------------------------------------------------------------------------

CATEGORY_ORDER = ["stack", "data", "ui_portal", "security", "epic", "privacy", "containers", "delivery", "infrastructure"]
CATEGORY_TITLES = {
    "stack": "Stack", "data": "Data model", "ui_portal": "User interface and portal",
    "security": "Roles and access", "epic": "Epic integration", "privacy": "Privacy",
    "containers": "Images and containers", "delivery": "Delivery", "infrastructure": "Infrastructure",
}


def fmt(v) -> str:
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, dict):
        return "; ".join(f"{k}: {fmt(x)}" for k, x in v.items())
    if isinstance(v, list):
        if v and isinstance(v[0], dict):
            return "; ".join(", ".join(f"{k}={x}" for k, x in d.items()) for d in v)
        return ", ".join(str(x) for x in v) if v else "none"
    return str(v)


def render_md(report: dict, label: str) -> str:
    src = report["source"]
    hist = report["history"]
    lines = [f"# Discovery report: {label}", "",
             f"Generated {report['generated_at']}. Commit: {src.get('commit') or 'not available'}.", "",
             "## Age and history"]
    if hist.get("available"):
        lines += [
            f"- First commit: {hist['first_commit']} (about {hist['application_age_years']} years old)",
            f"- Last commit: {hist['last_commit']} ({hist['days_since_last_commit']} days ago)",
            f"- Commits: {hist['total_commits']} total, {hist['commits_last_12_months']} in the last 12 months",
            f"- Release tags: {hist['release_tag_count']} (latest: {hist['latest_release_tag'] or 'none'})",
            f"- Release tags per year: {fmt(hist['release_tags_per_year']) or 'none'}",
        ]
        if hist.get("history_truncated"):
            lines.append("- Warning: the clone is shallow, so these counts are incomplete.")
    else:
        lines.append(f"- Not available: {hist['reason']}")
    lines.append("")

    if report["flags"]:
        lines += ["## Flags", ""]
        for fid in report["flags"]:
            f = report["findings"][fid]
            lines.append(f"- **{f['severity'].upper()}** {f['title']}: {fmt(f['value'])}")
        lines.append("")

    for cat in CATEGORY_ORDER:
        items = [f for f in report["findings"].values() if f["category"] == cat]
        if not items:
            continue
        lines += [f"## {CATEGORY_TITLES[cat]}", ""]
        for f in items:
            lines.append(f"- **{f['title']}:** {fmt(f['value'])} _({f['confidence']})_")
            if f.get("note"):
                lines.append(f"  - {f['note']}")
            if f["evidence"]:
                lines.append(f"  - Evidence ({f['evidence_count']}): " + ", ".join(f["evidence"][:5]))
        lines.append("")

    lines += ["## Limitations", ""] + [f"- {x}" for x in report["limitations"]] + [""]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Command line
# --------------------------------------------------------------------------

# ---- Page screenshots: a real browser draws each static page, so the look is the page's own.
SHOT_SIZES = {"desktop": (1280, 900), "phone": (390, 844)}
SHOT_MAX_BYTES = 350_000
SHOT_MAX_HEIGHT = {"desktop": 2400, "phone": 2000}
SHOT_ALLOWED_HOSTS = ("fonts.googleapis.com", "fonts.gstatic.com", "cdn.tailwindcss.com", "cdnjs.cloudflare.com",
                      "cdn.jsdelivr.net", "unpkg.com")


def _allow_page_request(route) -> None:
    """Local files, inline data and a few font and style CDNs load. Everything else is blocked."""
    from urllib.parse import urlparse
    url = route.request.url
    if url.startswith(("file://", "data:")):
        route.continue_()
        return
    host = urlparse(url).hostname or ""
    if urlparse(url).scheme == "https" and host in SHOT_ALLOWED_HOSTS:
        route.continue_()
    else:
        route.abort()


def add_screenshots(report: dict, root: Path) -> None:
    """Keep a JPEG of each static page at desktop and phone width. Dynamic pages are not captured."""
    finding = report["findings"].get("ui.page_preview")
    if not finding:
        return
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        report.setdefault("limitations", []).append("Page screenshots were not taken: the browser library is not installed.")
        return
    chrome = os.environ.get("CUTOVER_CHROME") or None
    pages = [pg for pg in finding["value"]["pages"] if pg.get("kind") == "static"]
    try:
        _capture_pages(sync_playwright, chrome, pages, root)
    except Exception as exc:  # a failed browser must not fail the analysis
        report.setdefault("limitations", []).append(f"Page screenshots were not taken: {type(exc).__name__}.")


def _capture_pages(sync_playwright, chrome, pages, root: Path) -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chrome, args=["--no-sandbox", "--disable-gpu"])
        try:
            for pg in pages:
                shots = {}
                for name, (w, h) in SHOT_SIZES.items():
                    ctx = browser.new_context(viewport={"width": w, "height": h}, java_script_enabled=True)
                    try:
                        page = ctx.new_page()
                        page.route("**/*", _allow_page_request)
                        page.goto((root / pg["path"]).resolve().as_uri(), wait_until="networkidle", timeout=20000)
                        page.wait_for_timeout(1000)
                        tall = page.evaluate("document.documentElement.scrollHeight")
                        height = min(tall, SHOT_MAX_HEIGHT[name])
                        png = page.screenshot(full_page=True, type="jpeg", quality=70,
                                              clip={"x": 0, "y": 0, "width": w, "height": height})
                        if len(png) <= SHOT_MAX_BYTES:
                            shots[name] = base64.b64encode(png).decode("ascii")
                    except Exception:
                        pass
                    finally:
                        ctx.close()
                pg["shots"] = shots
        finally:
            browser.close()


def load_metadata(paths: list[str]) -> list[dict]:
    """Reads and checks each metadata file from the read-only script. A file with anything other than names,
    types, nullability and row counts is refused."""
    docs = []
    for p in paths:
        try:
            docs.append(legacy.validate_metadata(json.loads(Path(p).read_text(encoding="utf-8"))))
        except (OSError, json.JSONDecodeError, ValueError) as error:
            raise RuntimeError(f"{p}: {error}") from error
    return docs


def analyze_and_write(root: Path, label: str, out_dir: str, now: dt.datetime, source: dict,
                      shots: bool = False, metadata_paths: list[str] | None = None) -> int:
    repo = Repo(root)
    commit = None
    if is_repo_root(root):
        try:
            commit = git(root, "rev-parse", "HEAD").strip()
        except RuntimeError:
            commit = None
    report = analyze(repo, root, now, {**source, "commit": commit}, load_metadata(metadata_paths or []))
    # The deeper assessment is built from the findings just produced, so it adds no extra reads of the code.
    report["deeper"] = deeper_docs.build(report)
    file_records_all = report.pop("inventory", [])
    if shots:
        add_screenshots(report, root)
    safe_label = re.sub(r"[^\w.-]", "_", label)
    dest = Path(out_dir) / safe_label
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "findings.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (dest / "report.md").write_text(render_md(report, label), encoding="utf-8")
    # One record per file, sent to the API in chunks by post_files.py.
    records = file_inventory.file_records(repo.paths, repo.files)
    (dest / "files.json").write_text(json.dumps(records, separators=(",", ":")), encoding="utf-8")
    (dest / "inventory.json").write_text(json.dumps(file_records_all, separators=(",", ":")), encoding="utf-8")
    print(f"Analyzed {label}: {len(report['findings'])} findings, {len(report['flags'])} flags, {len(records)} files")
    print(f"Wrote {dest / 'findings.json'} and {dest / 'report.md'}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="cutover_discover",
                                 description="Analyze an application repository and write discovery findings.")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--repo", help="GitHub repository as owner/name, or an https clone URL")
    src.add_argument("--path", help="Local folder to analyze (a git repository also gets history)")
    ap.add_argument("--ref", help="Branch, tag or commit to check out (with --repo)")
    ap.add_argument("--out", default="reports", help="Output folder (default: reports)")
    ap.add_argument("--screenshots", action="store_true",
                    help="Keep a picture of each static page (needs Playwright and Chromium)")
    ap.add_argument("--db-metadata", action="append", default=[], metavar="FILE",
                    help="Metadata file from access_metadata.py (table and field names, row counts). Repeatable.")
    args = ap.parse_args(argv)

    now = dt.datetime.now(dt.timezone.utc)
    token = os.environ.get("GITHUB_TOKEN") or None

    if args.repo:
        url = resolve_url(args.repo)
        label = url.rstrip("/").rsplit("/", 1)[-1]
        if label.endswith(".git"):
            label = label[:-4]
        with tempfile.TemporaryDirectory(prefix="cutover-") as tmp:
            root = Path(tmp) / "source"
            clone_repo(url, root, args.ref, token)
            return analyze_and_write(root, label, args.out, now,
                                     {"type": "github", "url": url, "ref": args.ref}, shots=args.screenshots,
                                     metadata_paths=args.db_metadata)

    root = Path(args.path).expanduser().resolve()
    if not root.is_dir():
        ap.error("--path must be an existing folder")
    return analyze_and_write(root, root.name, args.out, now, {"type": "local", "ref": None}, shots=args.screenshots,
                             metadata_paths=args.db_metadata)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(2)
