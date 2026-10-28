"""Business step: assesses one file with the workspace's language model and posts the draft to the API.

Run from the business workflow, after the repository is checked out at the analysed commit. The model key is released
for one run with the one-time token (see model_purposes.exchange_token). The key is never printed or stored.
A failed run is posted too, so the portal clears its running row. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from model_business import assess_file
from model_purposes import ReleaseError, call_provider, exchange_token, make_source_reader
from model_purposes import ProviderError, ProviderStopped, explain_failure

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SAFE_PATH = re.compile(r"^[A-Za-z0-9_./-]{1,300}$")
SHA = re.compile(r"^[0-9a-f]{7,64}$")


def result_payload(path: str, commit_sha: str | None, result: dict) -> dict:
    """What the API receives for one file: the outcome and the assessment, never the key."""
    return {
        "path": path,
        "commit_sha": commit_sha,
        "status": result.get("status", "failed"),
        "content": result.get("content"),
        "reason": result.get("reason"),
    }


def progress_payload(path: str) -> dict:
    """Sent once the model has been reached, so the portal can tick the connection step."""
    return {"path": path, "connected": True}


def post_progress(callback: str, analysis_id: str, secret: str, payload: dict,
                  opener=urllib.request.urlopen) -> int:
    """Tells the API the model was reached. A failure here does not stop the assessment."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/business-progress"
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


def post_result(callback: str, analysis_id: str, secret: str, payload: dict,
                opener=urllib.request.urlopen) -> int:
    """Sends one result to the API. Returns the HTTP status, or 0 when it could not be reached."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/business"
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


def commit_of(source: Path) -> str | None:
    """The commit the checkout is at, or None. It is recorded with the draft so the portal can tell if it is out of date."""
    try:
        out = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], capture_output=True, text=True,
                             timeout=30, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    sha = out.stdout.strip()
    return sha if out.returncode == 0 and SHA.match(sha) else None


def run(path: str, source: Path, ask) -> dict:
    """Reads the one file and assesses it. Returns the result, without any key in it."""
    if not SAFE_PATH.match(path) or ".." in path.split("/"):
        return {"path": path, "status": "refused", "reason": "The file name is not allowed."}
    code = make_source_reader(source)(path)
    if code is None:
        return {"path": path, "status": "refused", "reason": "The file could not be read."}
    return assess_file(path, code, ask)


def main(argv=None, opener=urllib.request.urlopen) -> int:
    ap = argparse.ArgumentParser(description="Assess one file with the chosen language model.")
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
        print(f"Assessment of {args.path}: failed. Saved: HTTP {status}.")
        return 0 if status in (200, 201) else 1

    provider, model, api_key = release["provider"], release["model"], release["api_key"]
    base_url, token_field = release.get("base_url"), release.get("token_field", "max_tokens")
    post_progress(args.callback, args.analysis_id, secret, progress_payload(args.path), opener=opener)
    try:
        result = run(args.path, source,
                     lambda text: call_provider(provider, model, api_key, text, opener=opener,
                                                base_url=base_url, token_field=token_field, max_tokens=1500))
    except (ProviderStopped, ProviderError) as err:
        result = {"path": args.path, "status": "failed", "reason": explain_failure(err)}
    status = post_result(args.callback, args.analysis_id, secret, result_payload(args.path, commit, result),
                         opener=opener)
    del api_key, release
    print(f"Assessment of {args.path}: {result.get('status')}. Saved: HTTP {status}.")
    return 0 if status in (200, 201) else 1


if __name__ == "__main__":
    raise SystemExit(main())
