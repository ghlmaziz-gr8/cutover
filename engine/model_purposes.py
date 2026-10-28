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
from collections import Counter
from datetime import datetime, timezone
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable

from model_origin import ORIGIN_MAX_TOKENS, ORIGIN_SYSTEM, run_origin
from model_screens import (SCREEN_MAX_TOKENS, SCREEN_PROMPT, ScreenError, StopDrawing, build_screen_text,
                           draw_screens, expand_control_screens, post_screens, post_screens_done, screen_context)

MODEL_CATEGORIES = {"source", "template", "database", "integration"}
MAX_MODEL_FILES = 200
MAX_FILE_CHARS = 20_000
MAX_PURPOSE_CHARS = 400
# Gemini's internal reasoning uses part of the output budget before the visible reply starts,
# so a small budget can end the reply mid-sentence. Google requests get at least this much room.
GOOGLE_MIN_OUTPUT_TOKENS = 1024
MIN_COPIED_LINE = 25
COPY_WINDOW = 30
# The request shapes the runner knows. "openai" is the chat-completions shape that most providers accept,
# so a new provider in the Worker's list needs no change here.
PROVIDERS = {"anthropic", "google", "openai"}
TOKEN_FIELDS = {"max_tokens", "max_completion_tokens"}
BASE_URL = re.compile(r"^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[A-Za-z0-9._~/-]*)?$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
MODEL_NAME = re.compile(r"^[A-Za-z0-9._/:-]{1,120}$")

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
                  system: str = SYSTEM, max_tokens: int = 160, base_url: str | None = None,
                  token_field: str = "max_tokens", json_reply: bool = False) -> tuple[str, dict, bytes]:
    """Returns the URL, headers and body for one request. The key only ever goes in a header.
    `json_reply` asks the provider to return a JSON object, so a reply is not wrapped in prose."""
    if provider == "openai":
        if not base_url or not BASE_URL.match(base_url):
            raise ProviderError("no secure address for this provider")
        if token_field not in TOKEN_FIELDS:
            raise ProviderError("unknown output limit field")
        url = base_url.rstrip("/") + "/chat/completions"
        headers = {"content-type": "application/json", "authorization": f"Bearer {api_key}"}
        body = {"model": model, token_field: max_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_text}]}
        if json_reply:
            body["response_format"] = {"type": "json_object"}
    elif provider == "anthropic":
        url = "https://api.anthropic.com/v1/messages"
        headers = {"content-type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"}
        body = {"model": model, "max_tokens": max_tokens, "system": system,
                "messages": [{"role": "user", "content": user_text}]}
    elif provider == "google":
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {"content-type": "application/json", "x-goog-api-key": api_key}
        body = {"systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user_text}]}],
                "generationConfig": {"maxOutputTokens": max(max_tokens, GOOGLE_MIN_OUTPUT_TOKENS)}}
        if json_reply:
            body["generationConfig"]["responseMimeType"] = "application/json"
    else:
        raise ProviderError(f"unknown provider {provider}")
    return url, {**headers, "user-agent": "cutover-runner"}, json.dumps(body).encode("utf-8")


def reply_text(provider: str, payload: dict) -> str:
    if provider == "openai":
        choices = payload.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content") if isinstance(message, dict) else None
        return content if isinstance(content, str) else ""
    if provider == "anthropic":
        blocks = payload.get("content") or []
        return "".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
    candidates = payload.get("candidates") or []
    if not candidates or not isinstance(candidates[0], dict):
        return ""
    parts = (candidates[0].get("content") or {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts if isinstance(p, dict))


def reply_cut_off(provider: str, payload: dict) -> bool:
    """True when the provider stopped because it ran out of output room, so the reply may end mid-sentence."""
    if provider == "openai":
        choices = payload.get("choices") or []
        return bool(choices) and isinstance(choices[0], dict) and choices[0].get("finish_reason") == "length"
    if provider == "anthropic":
        return payload.get("stop_reason") == "max_tokens"
    candidates = payload.get("candidates") or []
    return bool(candidates) and isinstance(candidates[0], dict) and candidates[0].get("finishReason") == "MAX_TOKENS"


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


# A server error from the provider is often brief (overload or a restart). The call is tried again after each pause.
RETRY_PAUSES = (3, 8)
RETRY_CODES = (500, 502, 503, 504)


def call_provider(provider: str, model: str, api_key: str, user_text: str, opener=urllib.request.urlopen,
                  system: str = SYSTEM, max_tokens: int = 160, base_url: str | None = None,
                  token_field: str = "max_tokens", json_reply: bool = False) -> str:
    url, headers, body = build_request(provider, model, api_key, user_text, system=system, max_tokens=max_tokens,
                                       base_url=base_url, token_field=token_field, json_reply=json_reply)
    payload = None
    for attempt in range(len(RETRY_PAUSES) + 1):
        req = urllib.request.Request(url, data=body, method="POST", headers=headers)
        try:
            with opener(req, timeout=60) as res:
                payload = json.loads(res.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as err:
            if err.code in (401, 403, 429):
                raise ProviderStopped(err.code)
            if err.code in RETRY_CODES and attempt < len(RETRY_PAUSES):
                time.sleep(RETRY_PAUSES[attempt])
                continue
            raise ProviderError(f"HTTP {err.code}")
        except (urllib.error.URLError, OSError, ValueError):
            raise ProviderError("request failed")
    payload = payload if isinstance(payload, dict) else {}
    if reply_cut_off(provider, payload):
        raise ProviderError("reply cut off")
    return reply_text(provider, payload)


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
        and (body.get("provider") != "openai" or (isinstance(body.get("base_url"), str) and BASE_URL.match(body["base_url"])))
        and body.get("token_field", "max_tokens") in TOKEN_FIELDS
    )
    if not valid:
        raise ReleaseError(None)
    return body


def apply_purposes(records: list[dict], read_source: Callable[[str], str | None], ask: Callable[[dict, str], str],
                   reasons: list[str] | None = None) -> dict:
    """Replaces the purpose of each eligible file the model answers well for. Returns counts only.
    When a list is given, the reason each file kept its rule-based purpose is added to it (no file names, no code)."""
    stats = {"model": 0, "rules": 0, "stopped": None}
    eligible = {r["path"] for r in choose_files(records)}
    for record in records:
        if record["path"] not in eligible:
            continue
        code = read_source(record["path"])
        if code is None:
            stats["rules"] += 1
            if reasons is not None:
                reasons.append("source file could not be read")
            continue
        try:
            reply = ask(record, code)
        except ProviderStopped as err:
            stats["stopped"] = err.status
            stats["rules"] += 1
            if reasons is not None:
                reasons.append(f"provider stopped (HTTP {err.status})")
            break
        except ProviderError as err:
            stats["rules"] += 1
            if reasons is not None:
                reasons.append(str(err) or "request failed")
            continue
        purpose = accept_purpose(reply, code)
        if purpose is None:
            stats["rules"] += 1
            if reasons is not None:
                reasons.append("reply not usable as a purpose")
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
    ap.add_argument("--screens-only", action="store_true",
                    help="Draw the screens only. The file purposes, the origin estimate and the findings stay as they are.")
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
    base_url, token_field = release.get("base_url"), release.get("token_field", "max_tokens")
    read_source = make_source_reader(Path(args.source))

    def screens_on() -> bool:
        # Screens only when the workspace has turned them on. The API sends DRAW_SCREENS with each run; off by default.
        return os.environ.get("DRAW_SCREENS", "").strip().lower() == "true"

    def draw_and_save() -> int:
        # Screens: the same key, the same run. Only when the provider has not refused the key.
        def draw(record, code):
            text = build_screen_text(record["path"], code, screen_context(records, record["path"]))
            try:
                return call_provider(provider, model, api_key, text, opener=opener,
                                     base_url=base_url, token_field=token_field,
                                     system=SCREEN_PROMPT, max_tokens=SCREEN_MAX_TOKENS)
            except ProviderStopped as err:
                raise StopDrawing(err.status)
            except ProviderError as err:
                raise ScreenError(str(err) or "request failed")

        screen_reasons: list[str] = []
        screen_records, screen_source = expand_control_screens(records, read_source)
        screens, screen_stats = draw_screens(screen_records, screen_source, draw, reasons=screen_reasons)
        if screen_stats["stopped"]:
            print(f"The provider refused the key or limited requests while drawing screens (HTTP {screen_stats['stopped']}).")
        if screen_reasons:
            print("Screens refused because: " + "; ".join(f"{n} x {r}" for r, n in Counter(screen_reasons).most_common()))
        if screens:
            status = post_screens(args.callback, args.analysis_id, secret, screens, opener=opener)
            if status == 201:
                print(f"{len(screens)} screens drawn from the code and saved; {screen_stats['refused']} refused.")
            else:
                print(f"The screens could not be saved (HTTP {status}). The analysis continues without them.")
        else:
            print(f"No screens drawn; {screen_stats['refused']} refused.")
        # Always tell the API the run has finished, so the page stops showing it working.
        post_screens_done(args.callback, args.analysis_id, secret, opener=opener)
        return 0

    if args.screens_only:
        # Only the screens are drawn again. Nothing else from the first run is written.
        if not screens_on():
            print("Screens are off for this workspace. No screens drawn.")
            del release, api_key
            return 0
        result = draw_and_save()
        del release, api_key
        return result

    purpose_reasons: list[str] = []
    stats = apply_purposes(
        records,
        read_source,
        lambda record, code: call_provider(provider, model, api_key, build_user_text(record["path"], code), opener=opener,
                                           base_url=base_url, token_field=token_field),
        reasons=purpose_reasons,
    )
    if stats["model"]:
        with open(args.records, "w", encoding="utf-8") as fh:
            json.dump(records, fh, separators=(",", ":"))
    print(f"{provider}: {stats['model']} file purposes written by the model, {stats['rules']} kept rule-based.")
    if purpose_reasons:
        print("Kept rule-based because: " + "; ".join(f"{n} x {r}" for r, n in Counter(purpose_reasons).most_common()))
    if stats["stopped"]:
        print(f"The provider refused the key or limited requests (HTTP {stats['stopped']}). The rest stay rule-based.")
        del release, api_key
        return 0

    # The AI origin estimate: the same key, after the purposes and before the screens. Its failure never stops the run.
    origin_message = run_origin(
        Path(args.records).with_name("findings.json"), records, read_source, datetime.now(timezone.utc).year,
        lambda text: call_provider(provider, model, api_key, text, opener=opener, system=ORIGIN_SYSTEM,
                                   max_tokens=ORIGIN_MAX_TOKENS, base_url=base_url, token_field=token_field),
        provider,
    )
    print(origin_message)

    if not screens_on():
        print("Screens are off for this workspace. Only the file purposes are written.")
        del release, api_key
        return 0
    result = draw_and_save()
    del release, api_key
    return result


if __name__ == "__main__":
    sys.exit(main())


def explain_failure(err: Exception) -> str:
    """A reason an engineer can act on, from a provider error. The provider's messages carry no key, only a status."""
    status = getattr(err, "status", None)  # a stopped provider carries its HTTP status here
    text = str(status) if status is not None else str(err)
    if text == "reply cut off":
        return "The model ran out of room before it finished the answer. Nothing was kept."
    if text in ("401", "403"):
        return f"The model provider refused the key (HTTP {text}). Check the key for this workspace."
    if text == "429":
        return "The model provider is rate-limiting or out of quota (HTTP 429). Check the quota, or try again later."
    if text == "request failed":
        return "The model provider could not be reached. Try again in a minute."
    if "HTTP 402" in text:
        return "The model provider asked for payment (HTTP 402). Check the billing for this workspace's model key."
    if "HTTP 401" in text or "HTTP 403" in text:
        return f"The model provider refused the key ({text}). Check the key for this workspace."
    if text.startswith("HTTP "):
        return f"The model provider answered {text}. Nothing was kept."
    if isinstance(err, (ProviderError, ProviderStopped)):
        return "The language model did not answer. Nothing was kept."
    # Anything else names its kind, so the log says what went wrong.
    return f"The language model did not answer ({type(err).__name__}). Nothing was kept."
