"""Stage 3 runner step: converts one file with the workspace's language model and posts the result to the API.

Run from the convert workflow, after the repository is checked out at the analysed commit. The model key is released
for one run with the one-time token (see model_purposes.exchange_token). The key is never printed or stored.
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

from model_convert import convert_file
from model_purposes import ReleaseError, call_provider, exchange_token, make_source_reader
from model_purposes import ProviderError, ProviderStopped

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SAFE_PATH = re.compile(r"^[A-Za-z0-9_./-]{1,300}$")


def result_payload(path: str, template: str, result: dict) -> dict:
    """What the API receives for one file. Only the outcome, the proposal and the reason; never the key."""
    return {
        "path": path,
        "template": template,
        "status": result.get("status", "failed"),
        "proposed": result.get("proposed"),
        "reason": result.get("reason"),
        "kinds": result.get("kinds", []),
        "stage": result.get("stage"),
    }


def post_result(callback: str, analysis_id: str, secret: str, payload: dict,
                opener=urllib.request.urlopen) -> int:
    """Sends one result to the API. Returns the HTTP status (201 when saved), or 0 when it could not be reached."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/conversion"
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


def run(path: str, template: str, source: Path, provider_ask: Callable[[str], str], language: str = "") -> dict:
    """Reads the one file and converts it. Returns the result, without any key in it."""
    if not SAFE_PATH.match(path) or ".." in path.split("/"):
        return {"path": path, "template": template, "status": "refused", "reason": "The file name is not allowed."}
    read = make_source_reader(source)
    code = read(path)
    if code is None:
        return {"path": path, "template": template, "status": "refused", "reason": "The file could not be read."}
    return convert_file(path, code, template, provider_ask, language=language)


def main(argv=None, opener=urllib.request.urlopen) -> int:
    ap = argparse.ArgumentParser(description="Convert one file with the chosen language model.")
    ap.add_argument("--path", required=True, help="The file, relative to the checkout")
    ap.add_argument("--template", required=True)
    ap.add_argument("--language", required=True, help="The target language name, for example Python with FastAPI")
    ap.add_argument("--source", required=True, help="The checkout folder")
    ap.add_argument("--callback", required=True)
    ap.add_argument("--analysis-id", required=True)
    args = ap.parse_args(argv)
    if not UUID.match(args.analysis_id):
        ap.error("--analysis-id must be a UUID")

    token = os.environ.get("MODEL_TOKEN", "")
    secret = os.environ.get("RUNNER_SECRET", "")
    if not token or not secret:
        print("The model or the runner secret is missing. Nothing was converted.", file=sys.stderr)
        return 2
    try:
        release = exchange_token(args.callback, args.analysis_id, secret, token, opener=opener)
    except ReleaseError as err:
        print(f"The model could not be released (HTTP {err.status}). Nothing was converted.")
        return 0

    provider, model, api_key = release["provider"], release["model"], release["api_key"]
    base_url, token_field = release.get("base_url"), release.get("token_field", "max_tokens")
    try:
        result = run(args.path, args.template, Path(args.source),
                     lambda text: call_provider(provider, model, api_key, text, opener=opener,
                                                base_url=base_url, token_field=token_field, max_tokens=4000),
                     language=args.language)
    except (ProviderStopped, ProviderError):
        result = {"status": "failed", "reason": "The language model did not answer. Nothing was kept."}
    status = post_result(args.callback, args.analysis_id, secret, result_payload(args.path, args.template, result),
                         opener=opener)
    del api_key, release
    print(f"Conversion of {args.path}: {result.get('status')}. Saved: HTTP {status}.")
    return 0 if status == 201 else 1


if __name__ == "__main__":
    raise SystemExit(main())
