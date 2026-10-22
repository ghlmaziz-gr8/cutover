"""Tests for the conversion runner step. Run from the engine folder: python3 -m unittest test_convert_run"""
import json
import tempfile
import unittest
from pathlib import Path

import convert_run as cr


class FakeResponse:
    def __init__(self, status=201):
        self.status = status
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


class ResultTests(unittest.TestCase):
    def test_a_file_is_converted_and_the_outcome_is_returned(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "visits.sql").write_text("SELECT id FROM visits;", encoding="utf-8")
            got = cr.run("visits.sql", "services-data", Path(folder), lambda text: "SELECT id FROM visit_table;")
            self.assertEqual(got["status"], "ok")
            self.assertEqual(got["proposed"], "SELECT id FROM visit_table;")

    def test_paths_that_leave_the_checkout_are_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            for bad in ["../secrets.txt", "/etc/passwd", "a b.sql", "x" * 400]:
                self.assertEqual(cr.run(bad, "web-modern", Path(folder), lambda t: "x")["status"], "refused", bad)

    def test_a_missing_file_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(cr.run("missing.sql", "web-modern", Path(folder), lambda t: "x")["status"], "refused")

    def test_the_payload_holds_the_outcome_and_no_key(self):
        payload = cr.result_payload("a.sql", "web-modern", {"status": "ok", "proposed": "x", "api_key": "sk-secret"})
        self.assertNotIn("api_key", payload)
        self.assertEqual(payload["status"], "ok")


class PostTests(unittest.TestCase):
    def test_the_result_is_posted_to_the_conversion_route_with_the_secret(self):
        seen = {}
        def opener(req, timeout=None):
            seen["url"] = req.full_url
            seen["secret"] = req.get_header("X-runner-secret")
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return FakeResponse(201)
        status = cr.post_result("https://api.example", "11111111-1111-4111-8111-111111111111", "s3cret",
                                {"status": "ok"}, opener=opener)
        self.assertEqual(status, 201)
        self.assertTrue(seen["url"].endswith("/api/runner/11111111-1111-4111-8111-111111111111/conversion"))
        self.assertEqual(seen["secret"], "s3cret")
        self.assertEqual(seen["body"], {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
