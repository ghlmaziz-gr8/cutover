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


class ProgressReport(unittest.TestCase):
    def test_the_size_of_the_file_is_counted_in_lines_and_characters(self):
        payload = dr.progress_payload("src/A.bas", "one\ntwo\nthree")
        self.assertEqual(payload, {"path": "src/A.bas", "lines": 3, "chars": 13})

    def test_an_empty_file_has_no_lines(self):
        self.assertEqual(dr.progress_payload("src/A.bas", "")["lines"], 0)

    def test_the_progress_is_posted_to_its_own_route_with_the_secret(self):
        seen = {}

        class Res:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def opener(req, timeout=None):
            seen["url"] = req.full_url
            seen["secret"] = req.get_header("X-runner-secret")
            seen["body"] = json.loads(req.data.decode("utf-8"))
            return Res()

        status = dr.post_progress("https://api.example", "11111111-1111-1111-1111-111111111111", "s3cret",
                                  {"path": "src/A.bas", "lines": 2, "chars": 9}, opener=opener)
        self.assertEqual(status, 200)
        self.assertTrue(seen["url"].endswith("/api/runner/11111111-1111-1111-1111-111111111111/deep-file-progress"))
        self.assertEqual(seen["secret"], "s3cret")
        self.assertEqual(seen["body"]["lines"], 2)

    def test_a_run_reports_the_size_before_the_model_is_called(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "src").mkdir()
            Path(d, "src", "A.bas").write_text("Sub A()\nEnd Sub\n", encoding="utf-8")
            calls = []
            result = dr.run("src/A.bas", Path(d), lambda text: GOOD, report=lambda p: calls.append(("report", p)))
            self.assertEqual(calls[0][0], "report")
            self.assertEqual(calls[0][1]["lines"], 3)
            self.assertEqual(result["status"], "ok")


class FailureReason(unittest.TestCase):
    def test_a_payment_problem_says_so(self):
        self.assertIn("payment", dr.explain(dr.ProviderError("HTTP 402")))

    def test_a_refused_key_says_so_without_the_key(self):
        text = dr.explain(dr.ProviderError("HTTP 403"))
        self.assertIn("refused the key", text)

    def test_other_http_errors_show_the_status(self):
        self.assertEqual(dr.explain(dr.ProviderError("HTTP 500")), "The model provider answered HTTP 500. Nothing was kept.")

    def test_any_other_error_is_generic(self):
        self.assertEqual(dr.explain(dr.ProviderError("something new")), "The language model did not answer. Nothing was kept.")


class JsonReply(unittest.TestCase):
    def test_google_is_asked_for_a_json_object(self):
        from model_purposes import build_request
        _, _, body = build_request("google", "gemini-3.5-flash", "k", "text", max_tokens=3000, json_reply=True)
        self.assertEqual(json.loads(body)["generationConfig"]["responseMimeType"], "application/json")

    def test_openai_is_asked_for_a_json_object(self):
        from model_purposes import build_request
        _, _, body = build_request("openai", "gpt", "k", "text", base_url="https://api.openai.com/v1", max_tokens=3000, json_reply=True)
        self.assertEqual(json.loads(body)["response_format"], {"type": "json_object"})

    def test_other_requests_are_unchanged_by_default(self):
        from model_purposes import build_request
        _, _, body = build_request("google", "gemini-3.5-flash", "k", "text", max_tokens=3000)
        self.assertNotIn("responseMimeType", json.loads(body)["generationConfig"])

    def test_the_deep_file_run_asks_for_json(self):
        src = Path(dr.__file__).read_text(encoding="utf-8")
        self.assertIn("json_reply=True", src)


class StoppedAndCutOff(unittest.TestCase):
    def test_a_cut_off_reply_says_the_model_ran_out_of_room(self):
        self.assertIn("ran out of room", dr.explain(dr.ProviderError("reply cut off")))

    def test_a_refused_key_says_so(self):
        self.assertIn("refused the key (HTTP 401)", dr.explain(dr.ProviderStopped(401)))

    def test_a_rate_limit_says_so(self):
        self.assertIn("rate-limiting or out of quota (HTTP 429)", dr.explain(dr.ProviderStopped(429)))

    def test_the_budget_leaves_room_for_reasoning_models(self):
        self.assertGreaterEqual(dr.MAX_TOKENS, 8000)
