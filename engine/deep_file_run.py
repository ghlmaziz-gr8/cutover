"""Deep file step: assesses one file with the workspace's language model and posts the draft to the API.

Run from the deep-file workflow, after the repository is checked out at the analysed commit. The model key is released
for one run with the one-time token (see model_purposes.exchange_token). The key is never printed or stored.
A failed run is posted too, so the portal clears its running row. Stdlib only.
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

from business_run import SAFE_PATH, UUID, commit_of
from model_deep_file import assess_file
from model_purposes import ReleaseError, call_provider, exchange_token, make_source_reader
from model_purposes import ProviderError, ProviderStopped

# Some models spend part of this budget on reasoning before they write the answer, so it leaves room for both.
MAX_TOKENS = 8000


def result_payload(path: str, commit_sha: str | None, result: dict) -> dict:
    """What the API receives for one file: the outcome, the account and the count of dropped names, never the key."""
    return {
        "path": path,
        "commit_sha": commit_sha,
        "status": result.get("status", "failed"),
        "content": result.get("content"),
        "dropped": result.get("dropped", 0),
        "reason": result.get("reason"),
    }


def post_result(callback: str, analysis_id: str, secret: str, payload: dict,
                opener=urllib.request.urlopen) -> int:
    """Sends one result to the API. Returns the HTTP status, or 0 when it could not be reached."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/deep-file"
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST", headers={
        "content-type": "application/json",
        "x-runner-secret": secret,
        "user-agent": "cutover-runner",
    })
    try:
        with opener(req, timeout=60) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code
    except (urllib.error.URLError, OSError):
        return 0


def explain(err: Exception) -> str:
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
    return "The language model did not answer. Nothing was kept."


def progress_payload(path: str, code: str) -> dict:
    """The size of the file, sent before the model is called, so the portal can show how long it will take."""
    return {"path": path, "lines": code.count("\n") + 1 if code else 0, "chars": len(code)}


def post_progress(callback: str, analysis_id: str, secret: str, payload: dict,
                  opener=urllib.request.urlopen) -> int:
    """Sends the file's size to the API. A failure here does not stop the assessment, so it returns the status only."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/deep-file-progress"
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST", headers={
        "content-type": "application/json",
        "x-runner-secret": secret,
        "user-agent": "cutover-runner",
    })
    try:
        with opener(req, timeout=30) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code
    except (urllib.error.URLError, OSError):
        return 0


def run(path: str, source: Path, ask, report=None) -> dict:
    """Reads the one file and assesses it. Returns the result, without any key in it.
    `report`, when given, receives the file's size once the file is read."""
    if not SAFE_PATH.match(path) or ".." in path.split("/"):
        return {"path": path, "status": "refused", "reason": "The file name is not allowed."}
    code = make_source_reader(source)(path)
    if code is None:
        return {"path": path, "status": "refused", "reason": "The file could not be read."}
    if report is not None:
        report(progress_payload(path, code))
    return assess_file(path, code, ask)


def main(argv=None, opener=urllib.request.urlopen) -> int:
    ap = argparse.ArgumentParser(description="Deep assessment of one file with the chosen language model.")
    ap.add_argument("--path", required=True, help="The file, relative to the checkout")
    ap.add_argument("--source", required=True, help="The checkout folder")
    ap.add_argument("--callback", required=True)
    ap.add_argument("--analysis-id", required=True)
    args = ap.parse_args(argv)
    if not UUID.match(args.analysis_id):
        ap.error("--analysis-id must be a UUID")

    token = os.environ.get("MODEL_TOKEN", "")
    secret = os.environ.get("RUNNER_SECRET", "")
    if not token or not secret:
        print("The model or the runner secret is missing. Nothing was assessed.", file=sys.stderr)
        return 2
    source = Path(args.source)
    commit = commit_of(source)
    try:
        release = exchange_token(args.callback, args.analysis_id, secret, token, opener=opener)
    except ReleaseError as err:
        result = {"status": "failed", "reason": f"The model could not be released (HTTP {err.status})."}
        status = post_result(args.callback, args.analysis_id, secret, result_payload(args.path, commit, result),
                             opener=opener)
        print(f"Deep assessment of {args.path}: failed. Saved: HTTP {status}.")
        return 0 if status in (200, 201) else 1

    provider, model, api_key = release["provider"], release["model"], release["api_key"]
    base_url, token_field = release.get("base_url"), release.get("token_field", "max_tokens")
    try:
        result = run(args.path, source,
                     lambda text: call_provider(provider, model, api_key, text, opener=opener,
                                                base_url=base_url, token_field=token_field, max_tokens=MAX_TOKENS,
                                                json_reply=True),
                     report=lambda payload: post_progress(args.callback, args.analysis_id, secret, payload,
                                                          opener=opener))
    except (ProviderError, ProviderStopped) as err:
        result = {"path": args.path, "status": "failed", "reason": explain(err)}
    status = post_result(args.callback, args.analysis_id, secret, result_payload(args.path, commit, result),
                         opener=opener)
    del api_key, release
    reason = f" {result['reason']}" if result.get("reason") and result.get("status") != "ok" else ""
    shape = f" ({result['shape']})" if result.get("shape") else ""
    print(f"Deep assessment of {args.path}: {result.get('status')}.{reason}{shape} Saved: HTTP {status}.")
    return 0 if status in (200, 201) else 1


if __name__ == "__main__":
    raise SystemExit(main())
