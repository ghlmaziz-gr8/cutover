#!/usr/bin/env python3
"""Write file purposes with the workspace's own language model, when one was chosen for the analysis.

Usage (in the analysis workflow, after the engine has run):
  MODEL_TOKEN=... RUNNER_SECRET=... python3 engine/model_purposes.py \
      --records reports/target/files.json --source <checkout> \
      --callback https://api.example.com --analysis-id <uuid>

Rules this file keeps:
- It runs only when MODEL_TOKEN is set. Without a token, the rule-based purposes stay.
- The token is exchanged once, for the key, in this process's memory. The key is never printed,
  never written to a file, and never put in an error message. Only status codes are printed.
- Only the code of eligible files is sent to the provider: source, template, database and integration
  files, at most MAX_MODEL_FILES of them, each cut to MAX_FILE_CHARS characters.
- A reply is used only if it is one short plain paragraph that copies no long line of the file.
  Otherwise the rule-based purpose stays.
- If the provider refuses the key or rate-limits, model use stops and the rest stay rule-based.
Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

from model_screens import (SCREEN_MAX_TOKENS, SCREEN_PROMPT, ScreenError, StopDrawing, draw_screens, post_screens)

MODEL_CATEGORIES = {"source", "template", "database", "integration"}
MAX_MODEL_FILES = 200
MAX_FILE_CHARS = 20_000
MAX_PURPOSE_CHARS = 400
MIN_COPIED_LINE = 25
COPY_WINDOW = 30
PROVIDERS = {"anthropic", "google"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
MODEL_NAME = re.compile(r"^[A-Za-z0-9._-]{1,80}$")

SYSTEM = (
    "You describe one file from a healthcare software application, for a migration assessment. "
    "Reply with one or two short, plain sentences saying what the file is for. "
    "Do not quote, copy or paraphrase code, names, values, addresses, identifiers or data from the file. "
    "Do not use markdown, lists or headings."
)


class ReleaseError(Exception):
    """The token could not be exchanged. The status is the HTTP status, or None."""

    def __init__(self, status):
        super().__init__("model key not released")
        self.status = status


class ProviderStopped(Exception):
    """The provider refused the key or limited requests. Model use stops for this analysis."""

    def __init__(self, status):
        super().__init__("provider stopped")
        self.status = status


class ProviderError(Exception):
    """One file's request failed. Only that file keeps its rule-based purpose."""


def choose_files(records: list[dict], limit: int = MAX_MODEL_FILES) -> list[dict]:
    eligible = [r for r in records if r.get("category") in MODEL_CATEGORIES]
    return eligible[:limit]


def build_user_text(path: str, code: str) -> str:
    return f"File path: {path}\n\n<file>\n{code}\n</file>"


def build_request(provider: str, model: str, api_key: str, user_text: str,
                  system: str = SYSTEM, max_tokens: int = 160) -> tuple[str, dict, bytes]:
    """Returns the URL, headers and body for one request. The key only ever goes in a header."""
    if provider == "anthropic":
        url = "https://api.anthropic.com/v1/messages"
        headers = {"content-type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"}
        body = {"model": model, "max_tokens": max_tokens, "system": system,
                "messages": [{"role": "user", "content": user_text}]}
    elif provider == "google":
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {"content-type": "application/json", "x-goog-api-key": api_key}
        body = {"systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user_text}]}],
                "generationConfig": {"maxOutputTokens": max_tokens}}
    else:
        raise ProviderError(f"unknown provider {provider}")
    return url, {**headers, "user-agent": "cutover-runner"}, json.dumps(body).encode("utf-8")


def reply_text(provider: str, payload: dict) -> str:
    if provider == "anthropic":
        blocks = payload.get("content") or []
        return "".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
    candidates = payload.get("candidates") or []
    if not candidates or not isinstance(candidates[0], dict):
        return ""
    parts = (candidates[0].get("content") or {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts if isinstance(p, dict))


def copies_code(text: str, code: str) -> bool:
    """True if the reply repeats any run of COPY_WINDOW characters from the file, ignoring case and spacing."""
    haystack = text.lower()
    for line in code.splitlines():
        s = " ".join(line.split()).lower()
        if len(s) < COPY_WINDOW:
            if len(s) >= MIN_COPIED_LINE and s in haystack:
                return True
            continue
        for start in range(len(s) - COPY_WINDOW + 1):
            if s[start:start + COPY_WINDOW] in haystack:
                return True
    return False


def accept_purpose(reply: str, code: str) -> str | None:
    """Returns the purpose to use, or None when the reply is not safe or not usable."""
    text = " ".join(reply.split())
    if not text or len(text) > MAX_PURPOSE_CHARS:
        return None
    if "```" in text or text.startswith("#") or text.startswith("- ") or text.startswith("* "):
        return None
    if copies_code(text, code):
        return None
    return text


def call_provider(provider: str, model: str, api_key: str, user_text: str, opener=urllib.request.urlopen,
                  system: str = SYSTEM, max_tokens: int = 160) -> str:
    url, headers, body = build_request(provider, model, api_key, user_text, system=system, max_tokens=max_tokens)
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with opener(req, timeout=60) as res:
            payload = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        if err.code in (401, 403, 429):
            raise ProviderStopped(err.code)
        raise ProviderError(f"HTTP {err.code}")
    except (urllib.error.URLError, OSError, ValueError):
        raise ProviderError("request failed")
    return reply_text(provider, payload if isinstance(payload, dict) else {})


def exchange_token(callback: str, analysis_id: str, secret: str, token: str, opener=urllib.request.urlopen) -> dict:
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/model-key"
    req = urllib.request.Request(url, data=json.dumps({"token": token}).encode("utf-8"), method="POST", headers={
        "content-type": "application/json",
        "x-runner-secret": secret,
        "user-agent": "cutover-runner",
    })
    try:
        with opener(req, timeout=60) as res:
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raise ReleaseError(err.code)
    except (urllib.error.URLError, OSError, ValueError):
        raise ReleaseError(None)
    valid = (
        isinstance(body, dict)
        and body.get("provider") in PROVIDERS
        and isinstance(body.get("model"), str) and MODEL_NAME.match(body["model"])
        and isinstance(body.get("api_key"), str) and len(body["api_key"]) >= 20
    )
    if not valid:
        raise ReleaseError(None)
    return body


def apply_purposes(records: list[dict], read_source: Callable[[str], str | None], ask: Callable[[dict, str], str]) -> dict:
    """Replaces the purpose of each eligible file the model answers well for. Returns counts only."""
    stats = {"model": 0, "rules": 0, "stopped": None}
    eligible = {r["path"] for r in choose_files(records)}
    for record in records:
        if record["path"] not in eligible:
            continue
        code = read_source(record["path"])
        if code is None:
            stats["rules"] += 1
            continue
        try:
            reply = ask(record, code)
        except ProviderStopped as err:
            stats["stopped"] = err.status
            stats["rules"] += 1
            break
        except ProviderError:
            stats["rules"] += 1
            continue
        purpose = accept_purpose(reply, code)
        if purpose is None:
            stats["rules"] += 1
            continue
        record["purpose"] = purpose
        record["purpose_source"] = "model"
        stats["model"] += 1
    return stats


def make_source_reader(root: Path) -> Callable[[str], str | None]:
    base = root.resolve()

    def read(path: str) -> str | None:
        target = (base / path).resolve()
        if base not in target.parents or not target.is_file():
            return None
        raw = target.read_bytes()[: MAX_FILE_CHARS * 4]
        if b"\x00" in raw:
            return None
        return raw.decode("utf-8", errors="replace")[:MAX_FILE_CHARS]

    return read


def main(argv=None, opener=urllib.request.urlopen) -> int:
    ap = argparse.ArgumentParser(description="Write file purposes with the chosen language model.")
    ap.add_argument("--records", required=True, help="files.json written by the engine")
    ap.add_argument("--source", required=True, help="Folder the records' paths are relative to")
    ap.add_argument("--callback", required=True, help="Base URL of the Cutover API")
    ap.add_argument("--analysis-id", required=True)
    args = ap.parse_args(argv)

    if not UUID.match(args.analysis_id):
        ap.error("--analysis-id must be a UUID")
    token = os.environ.get("MODEL_TOKEN", "")
    if not token:
        print("No model was chosen for this analysis. File purposes stay rule-based.")
        return 0
    secret = os.environ.get("RUNNER_SECRET", "")
    if not secret:
        print("RUNNER_SECRET is not set.", file=sys.stderr)
        return 2

    try:
        release = exchange_token(args.callback, args.analysis_id, secret, token, opener=opener)
    except ReleaseError as err:
        print(f"The model could not be released (HTTP {err.status}). File purposes stay rule-based.")
        return 0

    with open(args.records, encoding="utf-8") as fh:
        records = json.load(fh)
    if not isinstance(records, list):
        print("The file records are not a list. File purposes stay rule-based.", file=sys.stderr)
        return 1

    provider, model, api_key = release["provider"], release["model"], release["api_key"]
    read_source = make_source_reader(Path(args.source))
    stats = apply_purposes(
        records,
        read_source,
        lambda record, code: call_provider(provider, model, api_key, build_user_text(record["path"], code), opener=opener),
    )
    if stats["model"]:
        with open(args.records, "w", encoding="utf-8") as fh:
            json.dump(records, fh, separators=(",", ":"))
    print(f"{provider}: {stats['model']} file purposes written by the model, {stats['rules']} kept rule-based.")
    if stats["stopped"]:
        print(f"The provider refused the key or limited requests (HTTP {stats['stopped']}). The rest stay rule-based.")
        del release, api_key
        return 0

    # Screens: the same key, the same run. Only when the provider has not refused the key.
    def draw(record, code):
        try:
            return call_provider(provider, model, api_key, build_user_text(record["path"], code), opener=opener,
                                 system=SCREEN_PROMPT, max_tokens=SCREEN_MAX_TOKENS)
        except ProviderStopped as err:
            raise StopDrawing(err.status)
        except ProviderError:
            raise ScreenError("request failed")

    screens, screen_stats = draw_screens(records, read_source, draw)
    del release, api_key
    if screen_stats["stopped"]:
        print(f"The provider refused the key or limited requests while drawing screens (HTTP {screen_stats['stopped']}).")
    if screens:
        status = post_screens(args.callback, args.analysis_id, secret, screens, opener=opener)
        if status == 201:
            print(f"{len(screens)} screens drawn from the code and saved; {screen_stats['refused']} refused.")
        else:
            print(f"The screens could not be saved (HTTP {status}). The analysis continues without them.")
    else:
        print(f"No screens drawn; {screen_stats['refused']} refused.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
