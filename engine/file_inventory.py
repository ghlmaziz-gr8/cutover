"""File-level inventory for the deeper assessment: one record per file in the repository.

Each record holds the file's path, a category, a short purpose, and suggestions.
Purposes and suggestions are written from fixed wording and simple facts about the file
(its name, its type, how many lines, how many TODO markers). They never copy a line of
the code, so no real values from the code, configuration or data appear in the output.
Every record is marked sample_only. Stdlib only, and it makes no network calls.
"""
from __future__ import annotations

import os
import re
from pathlib import PurePosixPath

MAX_SUGGESTIONS = 4
LARGE_FILE_LINES = 800

CATEGORY_BY_EXT = {
    ".java": "source", ".kt": "source", ".cs": "source", ".go": "source", ".py": "source",
    ".js": "source", ".ts": "source", ".tsx": "source", ".jsx": "source", ".rb": "source", ".php": "source",
    ".html": "template", ".htm": "template", ".jsp": "template", ".xhtml": "template",
    ".cshtml": "template", ".vue": "template", ".svelte": "template", ".astro": "template",
    ".sql": "database", ".hl7": "integration",
    ".yml": "configuration", ".yaml": "configuration", ".properties": "configuration",
    ".json": "configuration", ".xml": "configuration", ".toml": "configuration",
    ".cfg": "configuration", ".ini": "configuration", ".conf": "configuration", ".env": "configuration",
    ".tf": "infrastructure", ".bicep": "infrastructure",
    ".md": "documentation", ".txt": "documentation",
    ".sh": "scripts", ".gradle": "build", ".kts": "build", ".mod": "build", ".csproj": "build",
}

TEST_PATTERNS = (re.compile(r"(^|/)(test|tests|spec|__tests__)/", re.I),
                 re.compile(r"(Test|Tests|Spec)\.(java|kt|cs|ts|js|tsx)$"),
                 re.compile(r"(^|/)test_[^/]+\.py$|_test\.(py|go)$|\.spec\.(ts|js|tsx)$", re.I))

# Patterns for suggestions. Each one only sets a flag. The text of a suggestion never includes the matched text.
URL_RX = re.compile(r"https?://(?!localhost|127\.0\.0\.1|example\.(com|org|test))[\w.-]+", re.I)
SECRET_RX = re.compile(r"(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['\"][^'\"]{4,}['\"]", re.I)
TODO_RX = re.compile(r"\b(TODO|FIXME|HACK)\b")
PRINT_STACK_RX = re.compile(r"\.printStackTrace\(")
SELECT_STAR_RX = re.compile(r"\bselect\s+\*", re.I)
CONTROLLER_RX = re.compile(r"@(RestController|Controller)\b|@app\.route|@router\.|app\.(get|post|put|delete)\(|\[ApiController\]|MapGet\(|MapPost\(", re.I)
SQL_CHANGE_RX = re.compile(r"\b(create|alter|drop)\s+(table|index|view|function|procedure)\b", re.I)


def category_of(path: str) -> str:
    name = PurePosixPath(path).name
    if name == "Dockerfile" or name.startswith("Dockerfile.") or name in ("docker-compose.yml", "docker-compose.yaml"):
        return "infrastructure"
    if name in ("Jenkinsfile", "Makefile", "pom.xml", "package.json", "build.gradle", "Cargo.toml", "go.mod"):
        return "build"
    if any(rx.search(path) for rx in TEST_PATTERNS):
        return "test"
    if name.upper().startswith("README"):
        return "documentation"
    return CATEGORY_BY_EXT.get(os.path.splitext(name)[1].lower(), "other")


def _purpose(path: str, category: str, text: str | None) -> str:
    name = PurePosixPath(path).name
    if text is None:
        return "Binary or unreadable file. Its contents were not read."
    if path.startswith(".github/workflows/"):
        return "Automated pipeline that builds, tests or checks the project."
    if category == "test":
        return f"Automated tests for the code in this part of the repository ({name})."
    if category == "source":
        if CONTROLLER_RX.search(text):
            return "Handles HTTP requests and passes them on to the rest of the code."
        return "Application code. Its role is inferred from its name and structure."
    if category == "template":
        return "Page or view template shown to users, built from markup and placeholders."
    if category == "database":
        if SQL_CHANGE_RX.search(text):
            return "Database schema change script."
        return "Database query or data script."
    if category == "configuration":
        return "Configuration settings read when the application starts or runs."
    if category == "infrastructure":
        return "Describes how the application's environment is built or run."
    if category == "build":
        return "Build and dependency definition for the project."
    if category == "documentation":
        return "Project documentation."
    if category == "integration":
        return "Message definition or interface data for connected systems."
    if category == "scripts":
        return "Script for running or maintaining the project."
    return "File of a type not yet classified."


def _suggestions(path: str, category: str, text: str | None, test_names: set[str]) -> list[dict]:
    if text is None:
        return []
    out: list[dict] = []
    if SECRET_RX.search(text):
        out.append({"text": "A credential appears to be written into the source. Move it to a secret store and rotate it.", "severity": "high"})
    if URL_RX.search(text):
        out.append({"text": "An address is written into the file. Move it into configuration so it can change per environment.", "severity": "medium"})
    todos = len(TODO_RX.findall(text))
    if todos:
        out.append({"text": f"{todos} open TODO or FIXME marker{'s' if todos != 1 else ''} in this file. Resolve or record them.", "severity": "low"})
    if PRINT_STACK_RX.search(text):
        out.append({"text": "Stack traces are printed directly. Send them to the logging framework instead.", "severity": "low"})
    if category == "database" and SELECT_STAR_RX.search(text):
        out.append({"text": "A query selects all columns. List the columns it needs.", "severity": "low"})
    lines = text.count("\n") + 1
    if lines > LARGE_FILE_LINES:
        out.append({"text": f"This file is {lines} lines long. Consider splitting it by responsibility.", "severity": "low"})
    if category == "source" and "/main/" in f"/{path}" and not _has_test(path, test_names):
        out.append({"text": "No test file was found for this code. Add tests for its main paths.", "severity": "medium"})
    return out[:MAX_SUGGESTIONS]


def _has_test(path: str, test_names: set[str]) -> bool:
    stem = PurePosixPath(path).stem
    return stem in test_names or f"{stem}Test" in test_names or f"{stem}Tests" in test_names or f"test_{stem}" in test_names


def _test_stems(paths: list[str]) -> set[str]:
    stems: set[str] = set()
    for p in paths:
        if category_of(p) == "test":
            stem = PurePosixPath(p).stem
            stems.add(stem)
            if stem.startswith("test_"):
                stems.add(stem[len("test_"):])
    return stems


def file_records(paths: list[str], files: dict[str, str]) -> list[dict]:
    """One record per file. `paths` is every file path, and `files` maps the readable ones to their text."""
    tests = _test_stems(paths)
    records = []
    for path in paths:
        text = files.get(path)
        category = category_of(path)
        records.append({
            "path": path,
            "category": category,
            "purpose": _purpose(path, category, text),
            "suggestions": _suggestions(path, category, text, tests),
            "sample_only": True,
        })
    return records
