"""Tests for the business assessment of one file. Run from the engine folder: python3 -m unittest test_model_business"""
import json
import unittest

import model_business as mb
import business_run as br

GOOD = {
    "purpose": "Books and cancels patient appointments.",
    "business_rules": ["A cancelled visit frees its slot.", "Visits cannot overlap."],
    "workflows": ["Appointment booking"],
    "data_used": ["appointment times", "clinic names"],
    "risks": ["Double booking must never happen."],
    "questions": ["Who approves a waiver?"],
}
CODE = "class Booking:\n    def cancel(self, visit):\n        visit.free_slot()\n"


class CleanReply(unittest.TestCase):
    def test_a_good_reply_keeps_the_fixed_fields(self):
        got = mb.clean_reply(json.dumps(GOOD))
        self.assertEqual(set(got), set(GOOD))
        self.assertEqual(got["business_rules"], GOOD["business_rules"])

    def test_a_fenced_reply_is_read(self):
        self.assertIsNotNone(mb.clean_reply("```json\n" + json.dumps(GOOD) + "\n```"))

    def test_lists_are_capped_and_long_text_is_cut(self):
        big = dict(GOOD, business_rules=[f"rule {i}" for i in range(40)], purpose="x" * 2000)
        got = mb.clean_reply(json.dumps(big))
        self.assertEqual(len(got["business_rules"]), 12)
        self.assertEqual(len(got["purpose"]), 600)

    def test_a_reply_without_the_form_is_not_kept(self):
        self.assertIsNone(mb.clean_reply("Sure! Here is the answer."))
        self.assertIsNone(mb.clean_reply(json.dumps(["not", "an", "object"])))
        self.assertIsNone(mb.clean_reply(json.dumps({k: v for k, v in GOOD.items() if k != "purpose"})))
        self.assertIsNone(mb.clean_reply(json.dumps(dict(GOOD, workflows="one"))))
        self.assertIsNone(mb.clean_reply(None))


class AssessFile(unittest.TestCase):
    def test_a_good_reply_is_ok_and_the_model_gets_the_file_and_the_form(self):
        sent = []
        got = mb.assess_file("src/Booking.py", CODE, lambda text: sent.append(text) or json.dumps(GOOD))
        self.assertEqual(got["status"], "ok")
        self.assertEqual(got["content"]["purpose"], GOOD["purpose"])
        self.assertIn("src/Booking.py", sent[0])
        self.assertIn("JSON only", sent[0])

    def test_personal_data_in_the_file_stops_the_request(self):
        sent = []
        got = mb.assess_file("p.py", "EMAIL = 'jane@example.org'", lambda text: sent.append(text) or "x")
        self.assertEqual(got["status"], "blocked")
        self.assertEqual(got["stage"], "request")
        self.assertEqual(got["kinds"], ["email address"])
        self.assertEqual(sent, [], "nothing is sent when the file holds personal data")

    def test_personal_data_in_the_reply_is_not_kept(self):
        reply = dict(GOOD, risks=["Call jane@example.org first."])
        got = mb.assess_file("src/Booking.py", CODE, lambda text: json.dumps(reply))
        self.assertEqual(got["status"], "blocked")
        self.assertEqual(got["stage"], "reply")

    def test_an_empty_or_huge_file_is_refused(self):
        self.assertEqual(mb.assess_file("e.py", "   ", lambda t: "x")["status"], "refused")
        huge = "x" * (mb.MAX_SOURCE_CHARS + 1)
        self.assertEqual(mb.assess_file("h.py", huge, lambda t: "x")["status"], "refused")

    def test_a_model_error_or_a_bad_reply_keeps_nothing(self):
        def broken(text):
            raise RuntimeError("down")
        self.assertEqual(mb.assess_file("src/Booking.py", CODE, broken)["status"], "failed")
        self.assertEqual(mb.assess_file("src/Booking.py", CODE, lambda t: "not json")["status"], "unusable")


class RunnerStep(unittest.TestCase):
    def test_the_payload_carries_the_outcome_and_never_a_key(self):
        payload = br.result_payload("src/Booking.py", "abc1234", {"status": "ok", "content": GOOD})
        self.assertEqual(set(payload), {"path", "commit_sha", "status", "content", "reason"})
        self.assertNotIn("api_key", json.dumps(payload))

    def test_a_path_that_climbs_out_of_the_checkout_is_refused(self):
        got = br.run("../secret.txt", br.Path("."), lambda t: "x")
        self.assertEqual(got["status"], "refused")

    def test_the_result_is_posted_to_the_draft_route_with_the_secret(self):
        seen = {}

        class Res:
            status = 201

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def opener(req, timeout=None):
            seen["url"] = req.full_url
            seen["secret"] = req.get_header("X-runner-secret")
            return Res()

        status = br.post_result("https://api.example.test/", "00000000-0000-4000-8000-000000000001", "s3cret",
                                {"status": "ok"}, opener=opener)
        self.assertEqual(status, 201)
        self.assertTrue(seen["url"].endswith("/api/runner/00000000-0000-4000-8000-000000000001/business"))
        self.assertEqual(seen["secret"], "s3cret")

    def test_missing_secrets_stop_the_step(self):
        import os
        saved = {k: os.environ.pop(k, None) for k in ("MODEL_TOKEN", "RUNNER_SECRET")}
        try:
            code = br.main(["--path", "src/A.py", "--source", ".", "--callback", "https://x.test",
                            "--analysis-id", "00000000-0000-4000-8000-000000000001"])
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
