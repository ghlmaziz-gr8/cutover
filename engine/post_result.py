#!/usr/bin/env python3
"""Send an engine report to the Cutover API. Used by the analysis workflow.

Usage:
  python3 engine/post_result.py --report reports/target/findings.json \
      --callback https://api.example.com --analysis-id <uuid>

The shared secret is read from the RUNNER_SECRET environment variable and is
never printed. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def build_payload(report: dict | None, error: str | None) -> dict:
    if report is None:
        return {"status": "failed", "error": error or "Analysis failed."}
    commit = (report.get("source") or {}).get("commit")
    return {"status": "complete", "commit_sha": commit, "findings": report}


def post(callback: str, analysis_id: str, secret: str, payload: dict) -> int:
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/result"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "content-type": "application/json",
        "x-runner-secret": secret,
        "user-agent": "cutover-runner",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Post an analysis result to the Cutover API.")
    ap.add_argument("--report", help="Path to findings.json written by the engine")
    ap.add_argument("--error", help="Send a failure with this message instead of a report")
    ap.add_argument("--callback", required=True, help="Base URL of the Cutover API")
    ap.add_argument("--analysis-id", required=True)
    args = ap.parse_args(argv)

    if not UUID.match(args.analysis_id):
        ap.error("--analysis-id must be a UUID")
    secret = os.environ.get("RUNNER_SECRET", "")
    if not secret:
        print("RUNNER_SECRET is not set.", file=sys.stderr)
        return 2

    report = None
    if args.report and not args.error:
        with open(args.report, encoding="utf-8") as fh:
            report = json.load(fh)
    payload = build_payload(report, args.error)

    status = post(args.callback, args.analysis_id, secret, payload)
    print(f"Callback responded with HTTP {status}.")
    return 0 if status == 200 else 1


if __name__ == "__main__":
    sys.exit(main())
