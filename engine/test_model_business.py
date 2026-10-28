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
        self.assertTrue(set(GOOD) <= set(got))
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


RULE = {"id": "R1", "statement": "A cancelled visit frees its slot.", "function": "cancel", "lines": [2, 3]}


class Rules(unittest.TestCase):
    def test_a_rule_whose_function_the_code_does_not_contain_is_dropped_and_counted(self):
        reply = dict(GOOD, rules=[RULE, {"id": "R2", "statement": "Made up.", "function": "invented", "lines": [1, 1]}])
        got = mb.clean_reply(json.dumps(reply), CODE)
        self.assertEqual([r["id"] for r in got["rules"]], ["R1"])
        self.assertEqual(got["dropped"], 1)
        self.assertEqual(got["functions"], [{"name": "cancel", "lines": [2, 3]}])

    def test_when_then_and_values_are_kept_and_values_must_be_in_the_code(self):
        code = CODE + "STATUS = 'cancelled'\n"
        reply = dict(GOOD, rules=[dict(RULE, condition="A visit is cancelled.", outcome="Its slot is free.",
                                       values=["cancelled", "not-in-code"])])
        got = mb.clean_reply(json.dumps(reply), code)
        self.assertEqual(got["rules"][0]["condition"], "A visit is cancelled.")
        self.assertEqual(got["rules"][0]["outcome"], "Its slot is free.")
        self.assertEqual(got["rules"][0]["values"], ["cancelled"])
        self.assertEqual(got["dropped"], 1)

    def test_line_numbers_are_kept_only_when_they_make_sense(self):
        reply = dict(GOOD, rules=[dict(RULE, lines=[3, 2])])
        got = mb.clean_reply(json.dumps(reply), CODE)
        self.assertIsNone(got["rules"][0]["lines"])
        self.assertEqual(got["dropped"], 0)

    def test_examples_are_kept_only_for_a_kept_rule(self):
        reply = dict(GOOD, rules=[RULE], examples=[
            {"rule": "R1", "given": "A visit is cancelled.", "expect": "Its slot is free again."},
            {"rule": "R9", "given": "Orphan.", "expect": "Dropped."},
        ])
        got = mb.clean_reply(json.dumps(reply), CODE)
        self.assertEqual(got["examples"], [{"rule": "R1", "given": "A visit is cancelled.", "expect": "Its slot is free again."}])

    def test_a_reply_without_rules_is_still_kept(self):
        got = mb.clean_reply(json.dumps(GOOD), CODE)
        self.assertEqual(got["rules"], [])
        self.assertEqual(got["examples"], [])
        self.assertEqual(got["dropped"], 0)


class AssessFile(unittest.TestCase):
    def test_the_form_asks_for_rules_and_examples_with_names(self):
        sent = []
        mb.assess_file("src/Booking.py", CODE, lambda text: sent.append(text) or json.dumps(GOOD))
        self.assertIn("rules", sent[0])
        self.assertIn("examples", sent[0])

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
    def test_the_connection_note_carries_the_path_and_no_key(self):
        self.assertEqual(br.progress_payload("src/Booking.py"), {"path": "src/Booking.py", "connected": True})

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


class FailureReasonTests(unittest.TestCase):
    def test_a_provider_error_names_its_status_and_nothing_else(self):
        import model_purposes as mp_mod

        def ask(text):
            raise mp_mod.ProviderError("HTTP 400")

        result = mb.assess_file("src/A.java", "public class A {}", ask)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["reason"], "The model provider answered HTTP 400. Nothing was kept.")

class BusinessRunAsksForJson(unittest.TestCase):
    def test_the_business_run_asks_the_provider_for_a_json_reply(self):
        # Without this, Google may return prose, and the reply is refused as not in the form needed.
        import pathlib
        src = (pathlib.Path(__file__).parent / "business_run.py").read_text(encoding="utf-8")
        self.assertIn("json_reply=True", src)

    def test_the_business_answer_has_the_same_room_as_the_deep_assessment(self):
        # A model that reasons first can run out of room and cut its JSON short: the business run needs the same room.
        import business_run
        import deep_file_run
        self.assertEqual(business_run.MAX_TOKENS, deep_file_run.MAX_TOKENS)


if __name__ == "__main__":
    unittest.main()
