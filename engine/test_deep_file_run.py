"""Tests for the deep file runner step. Run from the engine folder: python3 -m unittest test_deep_file_run"""
import json
import tempfile
import unittest
from pathlib import Path

import deep_file_run as dr

GOOD = json.dumps({
    "file_purpose": "Takes orders.",
    "file_user_stories": ["As a clerk I can take an order."],
    "functions": [{"name": "TakeOrder", "purpose": "Takes one order.", "user_stories": [], "calls": []}],
})


class PayloadShape(unittest.TestCase):
    def test_a_saved_account_carries_the_dropped_count_and_never_a_key(self):
        payload = dr.result_payload("src/A.bas", "abc123", {"status": "ok", "content": {"functions": []}, "dropped": 2})
        self.assertEqual(payload["dropped"], 2)
        self.assertEqual(payload["commit_sha"], "abc123")
        self.assertNotIn("api_key", json.dumps(payload))

    def test_a_failed_result_has_no_content(self):
        payload = dr.result_payload("src/A.bas", None, {"status": "failed", "reason": "no answer"})
        self.assertEqual(payload["status"], "failed")
        self.assertIsNone(payload["content"])


class RunOneFile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "src").mkdir()
        (self.root / "src" / "Orders.bas").write_text("Sub TakeOrder()\nEnd Sub\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_file_in_the_checkout_is_assessed(self):
        got = dr.run("src/Orders.bas", self.root, lambda text: GOOD)
        self.assertEqual(got["status"], "ok")
        self.assertEqual(got["confidence"], "model_read")

    def test_a_path_that_climbs_out_of_the_checkout_is_refused_without_asking(self):
        asked = []
        got = dr.run("../secret.txt", self.root, lambda text: asked.append(text) or GOOD)
        self.assertEqual(got["status"], "refused")
        self.assertEqual(asked, [])

    def test_a_missing_file_is_refused(self):
        self.assertEqual(dr.run("src/Missing.bas", self.root, lambda text: GOOD)["status"], "refused")


class Constants(unittest.TestCase):
    def test_the_model_has_room_for_a_whole_account(self):
        self.assertGreaterEqual(dr.MAX_TOKENS, 3000)


if __name__ == "__main__":
    unittest.main()
