"""Feature grouping step: proposes features from the approved business summaries and posts the draft to the API.

Started by the grouping workflow. The approved summaries are read from the API with the runner secret; no repository
is cloned, and no source code is read. The model key is released for one run with the one-time token. The key is
never printed or stored. A failed run is posted too, so the portal clears its running row. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

from model_grouping import group_features
from model_purposes import ReleaseError, call_provider, exchange_token
from model_purposes import ProviderError, ProviderStopped

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def fetch_sources(callback: str, analysis_id: str, secret: str, opener=urllib.request.urlopen) -> list | None:
    """The approved business summaries of the analysis, or None when they could not be read."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/grouping-sources"
    req = urllib.request.Request(url, method="GET", headers={"x-runner-secret": secret, "user-agent": "cutover-runner"})
    try:
        with opener(req, timeout=60) as res:
            data = json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None
    files = data.get("files") if isinstance(data, dict) else None
    return files if isinstance(files, list) else None


def post_result(callback: str, analysis_id: str, secret: str, payload: dict,
                opener=urllib.request.urlopen) -> int:
    """Sends the grouping to the API. Returns the HTTP status, or 0 when it could not be reached."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/grouping"
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


def payload_for(result: dict) -> dict:
    """What the API receives: the outcome and the features, never the key."""
    if result.get("status") == "ok":
        return {"status": "ok", "groups": result["groups"], "capabilities": result.get("capabilities")}
    return {"status": "failed", "reason": result.get("reason", "The features were not grouped.")}


def main(argv=None, opener=urllib.request.urlopen) -> int:
    ap = argparse.ArgumentParser(description="Propose feature groups from the approved summaries.")
    ap.add_argument("--callback", required=True)
    ap.add_argument("--analysis-id", required=True)
    args = ap.parse_args(argv)
    if not UUID.match(args.analysis_id):
        ap.error("--analysis-id must be a UUID")

    token = os.environ.get("MODEL_TOKEN", "")
    secret = os.environ.get("RUNNER_SECRET", "")
    if not token or not secret:
        print("The model or the runner secret is missing. Nothing was grouped.", file=sys.stderr)
        return 2

    try:
        release = exchange_token(args.callback, args.analysis_id, secret, token, opener=opener)
    except ReleaseError as err:
        result = {"status": "failed", "reason": f"The model could not be released (HTTP {err.status})."}
        status = post_result(args.callback, args.analysis_id, secret, payload_for(result), opener=opener)
        print(f"Feature grouping: failed. Saved: HTTP {status}.")
        return 0 if status in (200, 201) else 1

    sources = fetch_sources(args.callback, args.analysis_id, secret, opener=opener)
    if sources is None:
        result = {"status": "failed", "reason": "The approved summaries could not be read."}
    else:
        provider, model, api_key = release["provider"], release["model"], release["api_key"]
        base_url, token_field = release.get("base_url"), release.get("token_field", "max_tokens")
        try:
            result = group_features(sources,
                                    lambda text: call_provider(provider, model, api_key, text, opener=opener,
                                                               base_url=base_url, token_field=token_field,
                                                               max_tokens=2000))
        except (ProviderStopped, ProviderError):
            result = {"status": "failed", "reason": "The language model did not answer. Nothing was kept."}
        del api_key, release
    status = post_result(args.callback, args.analysis_id, secret, payload_for(result), opener=opener)
    print(f"Feature grouping: {result.get('status')}. Saved: HTTP {status}.")
    return 0 if status in (200, 201) else 1


if __name__ == "__main__":
    raise SystemExit(main())
