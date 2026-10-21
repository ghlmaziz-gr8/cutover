"""Tests for the upload unpacker. Run from the engine folder: python3 -m unittest test_safe_unzip"""
import os
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import safe_unzip as su


def make_zip(folder: Path, entries: dict) -> Path:
    path = folder / "code.zip"
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in entries.items():
            if isinstance(data, tuple):  # (bytes, external_attr) for links and modes
                info = zipfile.ZipInfo(name)
                info.external_attr = data[1] << 16
                zf.writestr(info, data[0])
            else:
                zf.writestr(name, data)
    return path


class UnpackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_nested_files_are_unpacked(self):
        archive = make_zip(self.root, {"app/web/index.asp": "x", "app/readme.txt": "y"})
        dest = self.root / "out"
        written, skipped = su.unpack(str(archive), str(dest))
        self.assertEqual((written, skipped), (2, 0))
        self.assertEqual((dest / "app/web/index.asp").read_text(), "x")

    def test_traversal_refuses_the_whole_archive_and_writes_nothing(self):
        archive = make_zip(self.root, {"ok.txt": "a", "../escape.txt": "b"})
        dest = self.root / "out"
        with self.assertRaises(su.UnsafeArchive):
            su.unpack(str(archive), str(dest))
        self.assertFalse((dest / "ok.txt").exists())
        self.assertFalse((self.root / "escape.txt").exists())

    def test_absolute_and_backslash_paths_are_refused(self):
        for name in ["/etc/passwd", "..\\evil.txt", "C:/Windows/x.txt"]:
            with self.subTest(name=name):
                archive = make_zip(self.root, {name: "b"})
                with self.assertRaises(su.UnsafeArchive):
                    su.unpack(str(archive), str(self.root / "out"))

    def test_symbolic_links_are_skipped_not_created(self):
        link_mode = stat.S_IFLNK | 0o777
        archive = make_zip(self.root, {"real.txt": "a", "link": ("/etc/passwd", link_mode)})
        dest = self.root / "out"
        written, skipped = su.unpack(str(archive), str(dest))
        self.assertEqual((written, skipped), (1, 1))
        self.assertFalse(os.path.islink(dest / "link"))
        self.assertFalse((dest / "link").exists())

    def test_too_many_files_is_refused(self):
        archive = make_zip(self.root, {"a.txt": "1", "b.txt": "2"})
        with mock.patch.object(su, "MAX_FILES", 1):
            with self.assertRaises(su.UnsafeArchive):
                su.unpack(str(archive), str(self.root / "out"))

    def test_unpacked_size_is_capped(self):
        archive = make_zip(self.root, {"a.txt": "x" * 100, "b.txt": "y" * 100})
        with mock.patch.object(su, "MAX_TOTAL_BYTES", 150):
            with self.assertRaises(su.UnsafeArchive):
                su.unpack(str(archive), str(self.root / "out"))

    def test_main_reports_a_refusal_with_exit_code_one(self):
        archive = make_zip(self.root, {"../x": "b"})
        self.assertEqual(su.main(["safe_unzip.py", str(archive), str(self.root / "out")]), 1)

    def test_not_a_zip_is_refused(self):
        bad = self.root / "bad.zip"
        bad.write_bytes(b"not a zip")
        self.assertEqual(su.main(["safe_unzip.py", str(bad), str(self.root / "out")]), 1)


if __name__ == "__main__":
    unittest.main()
