#!/usr/bin/env python3
"""Send file-level results to the Cutover API in chunks of up to 200 files.

Usage:
  python3 engine/post_files.py --records reports/target/files.json \
      --callback https://api.example.com --analysis-id <uuid>

Each chunk is one request, so each stays small enough for the free-tier CPU budget.
Stops at the first chunk the API refuses and reports why.
The shared secret is read from the RUNNER_SECRET environment variable and is never printed.
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
from typing import Callable, Iterable, Iterator

CHUNK_FILES = 200
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

Poster = Callable[[str, str, dict], int]


def chunks(records: list[dict], size: int = CHUNK_FILES) -> Iterator[list[dict]]:
    for start in range(0, len(records), size):
        yield records[start:start + size]


def post_chunk(callback: str, analysis_id: str, secret: str, files: list[dict]) -> int:
    url = f"{callback.rstrip('/')}/api/runner/{analysis_id}/files"
    data = json.dumps({"files": files}).encode("utf-8")
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


def send_all(records: Iterable[dict], poster: Poster, callback: str, analysis_id: str, secret: str) -> tuple[int, str | None]:
    """Send every chunk in order. Returns (files saved, None) or (files saved so far, the reason it stopped)."""
    saved = 0
    for chunk in chunks(list(records)):
        status = poster(callback, analysis_id, secret, chunk)
        if status != 201:
            return saved, f"The API refused a chunk with HTTP {status}."
        saved += len(chunk)
    return saved, None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Send file-level results to the Cutover API.")
    ap.add_argument("--records", required=True, help="JSON list of file records written by the engine")
    ap.add_argument("--callback", required=True, help="Base URL of the Cutover API")
    ap.add_argument("--analysis-id", required=True)
    args = ap.parse_args(argv)

    if not UUID.match(args.analysis_id):
        ap.error("--analysis-id must be a UUID")
    secret = os.environ.get("RUNNER_SECRET", "")
    if not secret:
        print("RUNNER_SECRET is not set.", file=sys.stderr)
        return 2
    with open(args.records, encoding="utf-8") as fh:
        records = json.load(fh)
    if not isinstance(records, list):
        ap.error("--records must hold a JSON list")

    saved, problem = send_all(records, post_chunk, args.callback, args.analysis_id, secret)
    print(f"Saved {saved} of {len(records)} file records.")
    if problem:
        print(problem, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
