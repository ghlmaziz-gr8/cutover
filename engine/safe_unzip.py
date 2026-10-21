#!/usr/bin/env python3
"""Unpacks an uploaded zip of an application's code into a folder, safely.

Usage: python3 safe_unzip.py <archive.zip> <destination>

Rules this file keeps:
- Every entry must stay inside the destination. An entry with an absolute path, a drive letter, a backslash or '..'
  refuses the whole archive, before anything is written.
- Symbolic links are skipped. They are never followed or created.
- The archive is refused if it holds too many files, if its unpacked size is too large, or if one file is too large.
- Only counts are printed, never file contents.
Stdlib only.
"""
from __future__ import annotations

import os
import stat
import sys
import zipfile
from pathlib import PurePosixPath

MAX_FILES = 50_000
MAX_TOTAL_BYTES = 400 * 1024 * 1024
MAX_FILE_BYTES = 50 * 1024 * 1024
CHUNK = 1 << 20


class UnsafeArchive(Exception):
    """The archive cannot be unpacked. The message says why, never a file's content."""


def member_parts(name: str) -> list[str]:
    if "\\" in name or name.startswith("/") or (len(name) > 1 and name[1] == ":"):
        raise UnsafeArchive("an entry has an absolute or backslash path")
    parts = [p for p in PurePosixPath(name).parts if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise UnsafeArchive("an entry tries to leave the folder")
    return parts


def unpack(archive: str, dest: str) -> tuple[int, int]:
    """Returns (files written, symbolic links skipped)."""
    base = os.path.realpath(dest)
    os.makedirs(base, exist_ok=True)
    with zipfile.ZipFile(archive) as zf:
        infos = zf.infolist()
        if len(infos) > MAX_FILES:
            raise UnsafeArchive("the archive holds too many files")
        plan = []
        declared_total = 0
        for info in infos:
            parts = member_parts(info.filename)
            if (info.external_attr >> 16) & 0o170000 == stat.S_IFLNK:
                plan.append((info, parts, True))
                continue
            if info.is_dir() or not parts:
                continue
            if info.file_size > MAX_FILE_BYTES:
                raise UnsafeArchive("a file is too large")
            declared_total += info.file_size
            if declared_total > MAX_TOTAL_BYTES:
                raise UnsafeArchive("the unpacked code is too large")
            plan.append((info, parts, False))

        written = skipped = 0
        total = 0
        for info, parts, is_link in plan:
            if is_link:
                skipped += 1
                continue
            target = os.path.realpath(os.path.join(base, *parts))
            if os.path.commonpath([base, target]) != base:
                raise UnsafeArchive("an entry tries to leave the folder")
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as out:
                size = 0
                while chunk := src.read(CHUNK):
                    size += len(chunk)
                    total += len(chunk)
                    if size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
                        raise UnsafeArchive("the unpacked code is too large")
                    out.write(chunk)
            written += 1
    return written, skipped


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("Usage: safe_unzip.py <archive.zip> <destination>", file=sys.stderr)
        return 2
    try:
        written, skipped = unpack(argv[1], argv[2])
    except (UnsafeArchive, zipfile.BadZipFile) as err:
        print(f"The upload was refused: {err}.", file=sys.stderr)
        return 1
    print(f"Unpacked {written} files. Skipped {skipped} symbolic links.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
