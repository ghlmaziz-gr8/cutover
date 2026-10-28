"""Tests for feature grouping. Run from the engine folder: python3 -m unittest test_model_grouping"""
import json
import os
import unittest

import grouping_run as gr
import model_grouping as mg

SOURCES = [
    {"path": "src/Orders.py", "content": {"purpose": "Places orders.", "business_rules": ["Orders need a customer."], "workflows": ["Checkout"]}},
    {"path": "src/Refunds.py", "content": {"purpose": "Refunds payments.", "business_rules": [], "workflows": ["Returns"]}},
]
ALLOWED = {"src/Orders.py", "src/Refunds.py"}


class Reply(unittest.TestCase):
    def test_a_good_grouping_keeps_only_allowed_files_and_lists_each_once_per_group(self):
        reply = json.dumps({"groups": [
            {"name": "Ordering", "summary": "Places orders.", "paths": ["src/Orders.py", "src/Unknown.py"]},
            {"name": "Money back", "summary": "Refunds.", "paths": ["src/Orders.py", "src/Refunds.py"]},
        ]})
        got = mg.clean_grouping_reply(reply, ALLOWED)
        self.assertEqual(got[0]["paths"], ["src/Orders.py"])
        self.assertEqual(got[1]["paths"], ["src/Orders.py", "src/Refunds.py"])

    def test_a_fenced_reply_is_read(self):
        reply = "```json\n" + json.dumps({"groups": [{"name": "A", "summary": "", "paths": ["src/Orders.py"]}]}) + "\n```"
        self.assertIsNotNone(mg.clean_grouping_reply(reply, ALLOWED))

    def test_a_reply_without_usable_groups_is_not_kept(self):
        self.assertIsNone(mg.clean_grouping_reply("Here are the groups.", ALLOWED))
        self.assertIsNone(mg.clean_grouping_reply(json.dumps({"groups": [{"name": "A", "paths": ["nope.py"]}]}), ALLOWED))
        self.assertIsNone(mg.clean_grouping_reply(None, ALLOWED))


class Group(unittest.TestCase):
    def test_a_good_reply_is_ok_and_the_model_sees_summaries_not_code(self):
        sent = []
        reply = json.dumps({"groups": [{"name": "Ordering", "summary": "x", "paths": ["src/Orders.py"]}]})
        got = mg.group_features(SOURCES, lambda text: sent.append(text) or reply)
        self.assertEqual(got["status"], "ok")
        self.assertIn("Orders need a customer.", sent[0])
        self.assertIn("src/Refunds.py", sent[0])

    def test_nothing_to_group_is_refused_and_nothing_is_sent(self):
        sent = []
        got = mg.group_features([], lambda text: sent.append(text) or "x")
        self.assertEqual(got["status"], "refused")
        self.assertEqual(sent, [])

    def test_personal_data_in_the_summaries_stops_the_request(self):
        sent = []
        bad = [{"path": "src/A.py", "content": {"purpose": "Mail jane@example.org about it."}}]
        got = mg.group_features(bad, lambda text: sent.append(text) or "x")
        self.assertEqual(got["status"], "blocked")
        self.assertEqual(got["stage"], "request")
        self.assertEqual(sent, [])

    def test_a_model_error_or_a_bad_reply_keeps_nothing(self):
        def broken(text):
            raise RuntimeError("down")
        self.assertEqual(mg.group_features(SOURCES, broken)["status"], "failed")
        self.assertEqual(mg.group_features(SOURCES, lambda t: "not json")["status"], "unusable")


class RunnerStep(unittest.TestCase):
    def test_the_payload_carries_the_groups_or_a_reason_and_never_a_key(self):
        ok = gr.payload_for({"status": "ok", "groups": [{"name": "A", "summary": "", "paths": ["src/Orders.py"]}]})
        self.assertEqual(ok["status"], "ok")
        failed = gr.payload_for({"status": "unusable", "reason": "No."})
        self.assertEqual(failed, {"status": "failed", "reason": "No."})
        self.assertNotIn("api_key", json.dumps(ok) + json.dumps(failed))

    def test_the_summaries_are_read_from_the_api_with_the_secret(self):
        seen = {}

        class Res:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps({"files": SOURCES}).encode("utf-8")

        def opener(req, timeout=None):
            seen["url"] = req.full_url
            seen["secret"] = req.get_header("X-runner-secret")
            return Res()

        got = gr.fetch_sources("https://api.example.test/", "00000000-0000-4000-8000-000000000001", "s3cret", opener=opener)
        self.assertEqual(got, SOURCES)
        self.assertTrue(seen["url"].endswith("/api/runner/00000000-0000-4000-8000-000000000001/grouping-sources"))
        self.assertEqual(seen["secret"], "s3cret")

    def test_missing_secrets_stop_the_step(self):
        saved = {k: os.environ.pop(k, None) for k in ("MODEL_TOKEN", "RUNNER_SECRET")}
        try:
            code = gr.main(["--callback", "https://x.test", "--analysis-id", "00000000-0000-4000-8000-000000000001"])
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()


class OverlappingGroups(unittest.TestCase):
    def test_a_file_may_be_in_more_than_one_group_but_is_listed_once_in_each(self):
        import json as _json
        from model_grouping import clean_grouping_reply
        reply = _json.dumps({"groups": [
            {"name": "Ordering", "summary": "", "paths": ["a.asp", "a.asp"]},
            {"name": "Login", "summary": "", "paths": ["a.asp", "b.asp"]},
        ]})
        groups = clean_grouping_reply(reply, {"a.asp", "b.asp"})
        self.assertEqual(groups[0]["paths"], ["a.asp"])
        self.assertEqual(groups[1]["paths"], ["a.asp", "b.asp"])


class Capabilities(unittest.TestCase):
    def test_a_capability_holds_features_and_each_feature_is_in_one_capability(self):
        reply = json.dumps({"capabilities": [
            {"name": "Sales", "summary": "x", "features": [
                {"name": "Ordering", "summary": "", "paths": ["src/Orders.py"]},
                {"name": "Checkout", "summary": "", "paths": ["src/Orders.py", "src/Unknown.py"]}]},
            {"name": "Returns", "summary": "", "features": [
                {"name": "Money back", "summary": "", "paths": ["src/Refunds.py"]}]},
        ]})
        groups, caps = mg.clean_grouping(reply, ALLOWED)
        self.assertEqual([g["name"] for g in groups], ["Ordering", "Checkout", "Money back"])
        self.assertEqual(caps, [
            {"name": "Sales", "summary": "x", "features": [0, 1]},
            {"name": "Returns", "summary": "", "features": [2]},
        ])
        self.assertEqual(groups[1]["paths"], ["src/Orders.py"])

    def test_a_capability_with_no_usable_feature_is_dropped(self):
        reply = json.dumps({"capabilities": [
            {"name": "Empty", "features": [{"name": "Nothing", "paths": ["nope.py"]}]},
            {"name": "Sales", "features": [{"name": "Ordering", "paths": ["src/Orders.py"]}]},
        ]})
        groups, caps = mg.clean_grouping(reply, ALLOWED)
        self.assertEqual(len(groups), 1)
        self.assertEqual(caps, [{"name": "Sales", "summary": "", "features": [0]}])

    def test_an_older_reply_with_groups_only_gives_no_capabilities(self):
        reply = json.dumps({"groups": [{"name": "Ordering", "summary": "", "paths": ["src/Orders.py"]}]})
        groups, caps = mg.clean_grouping(reply, ALLOWED)
        self.assertEqual(len(groups), 1)
        self.assertIsNone(caps)

    def test_a_good_capability_reply_is_ok_with_the_capabilities(self):
        reply = json.dumps({"capabilities": [{"name": "Sales", "summary": "", "features": [
            {"name": "Ordering", "summary": "", "paths": ["src/Orders.py"]}]}]})
        got = mg.group_features(SOURCES, lambda text: reply)
        self.assertEqual(got["status"], "ok")
        self.assertEqual(got["capabilities"], [{"name": "Sales", "summary": "", "features": [0]}])

    def test_the_prompt_asks_for_capabilities_and_one_capability_per_feature(self):
        text = mg.build_user_text(SOURCES)
        self.assertIn('"capabilities"', text)
        self.assertIn("A feature belongs to one capability only", text)

    def test_the_run_posts_the_capabilities_too(self):
        payload = gr.payload_for({"status": "ok", "groups": [{"name": "A", "summary": "", "paths": ["a"]}],
                                  "capabilities": [{"name": "C", "summary": "", "features": [0]}]})
        self.assertEqual(payload["capabilities"], [{"name": "C", "summary": "", "features": [0]}])
