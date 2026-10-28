"""Feature stories step: drafts the user stories for each feature of a draft grouping and posts them to the API.

Started by the stories workflow. The approved rules are read from the API with the runner secret; no repository is
cloned and no source code is read. The model key is released for one run with the one-time token. The key is never
printed or stored. A failed run is posted too, so the portal can say why. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

from model_purposes import ProviderError, ProviderStopped, ReleaseError, call_provider, exchange_token
from model_stories import draft_feature_stories

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def fetch_sources(callback: str, analysis_id: str, grouping_id: str, secret: str, opener=urllib.request.urlopen):
    """The features of the draft grouping with the approved rules of their files, or None when they could not be read."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/story-sources?grouping_id={grouping_id}"
    req = urllib.request.Request(url, method="GET", headers={"x-runner-secret": secret, "user-agent": "cutover-runner"})
    try:
        with opener(req, timeout=60) as res:
            data = json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return None
    features = data.get("features") if isinstance(data, dict) else None
    return features if isinstance(features, list) else None


def post_result(callback: str, analysis_id: str, secret: str, payload: dict, opener=urllib.request.urlopen) -> int:
    """Sends the stories to the API. Returns the HTTP status, or 0 when it could not be reached."""
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/stories"
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


def draft_all(features: list[dict], ask) -> dict:
    """The stories for every feature. A feature that cannot be drafted is reported with its reason and the others go on."""
    out = []
    for index, feature in enumerate(features):
        result = draft_feature_stories(feature, feature.get("files") or [], ask)
        out.append({"index": index, "name": feature.get("name", ""), "result": result})
    if out and all(item["result"].get("status") != "ok" for item in out):
        return {"status": "failed", "reason": out[0]["result"].get("reason", "No stories were drafted."), "features": []}
    return {"status": "ok", "features": [
        {"index": item["index"], "name": item["name"], "stories": item["result"].get("stories", []),
         "reason": None if item["result"].get("status") == "ok" else item["result"].get("reason")}
        for item in out
    ]}


def payload_for(grouping_id: str, result: dict) -> dict:
    """What the API receives: the grouping, the outcome and the stories. Never the key."""
    if result.get("status") == "ok":
        return {"grouping_id": grouping_id, "status": "ok", "features": result["features"]}
    return {"grouping_id": grouping_id, "status": "failed", "reason": result.get("reason", "The stories were not drafted.")}


def main(argv=None, opener=urllib.request.urlopen) -> int:
    ap = argparse.ArgumentParser(description="Draft user stories for the features of a grouping.")
    ap.add_argument("--callback", required=True)
    ap.add_argument("--analysis-id", required=True)
    ap.add_argument("--grouping-id", required=True)
    args = ap.parse_args(argv)
    if not UUID.match(args.analysis_id) or not UUID.match(args.grouping_id):
        ap.error("the ids must be UUIDs")

    token = os.environ.get("MODEL_TOKEN", "")
    secret = os.environ.get("RUNNER_SECRET", "")
    if not token or not secret:
        print("The model or the runner secret is missing. No stories were drafted.", file=sys.stderr)
        return 2

    try:
        release = exchange_token(args.callback, args.analysis_id, secret, token, opener=opener)
    except ReleaseError as err:
        result = {"status": "failed", "reason": f"The model could not be released (HTTP {err.status})."}
        status = post_result(args.callback, args.analysis_id, secret, payload_for(args.grouping_id, result), opener=opener)
        print(f"Feature stories: failed. Saved: HTTP {status}.")
        return 0 if status in (200, 201) else 1

    features = fetch_sources(args.callback, args.analysis_id, args.grouping_id, secret, opener=opener)
    if features is None:
        result = {"status": "failed", "reason": "The approved rules could not be read."}
    else:
        provider, model, api_key = release["provider"], release["model"], release["api_key"]
        base_url, token_field = release.get("base_url"), release.get("token_field", "max_tokens")
        try:
            result = draft_all(features, lambda text: call_provider(provider, model, api_key, text, opener=opener,
                                                                   base_url=base_url, token_field=token_field,
                                                                   max_tokens=3000))
        except (ProviderStopped, ProviderError):
            result = {"status": "failed", "reason": "The language model did not answer. Nothing was kept."}
        del api_key, release
    status = post_result(args.callback, args.analysis_id, secret, payload_for(args.grouping_id, result), opener=opener)
    print(f"Feature stories: {result.get('status')}. Saved: HTTP {status}.")
    return 0 if status in (200, 201) else 1


if __name__ == "__main__":
    raise SystemExit(main())
