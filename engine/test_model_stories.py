"""Tests for the feature user stories. Run from the engine folder: python3 -m unittest test_model_stories"""
import json
import unittest

import model_stories as ms

SOURCES = [
    {"path": "src/Orders.asp", "content": {
        "file_purpose": "Takes orders.",
        "file_user_stories": ["As a clerk I can place an order."],
        "rules": [
            {"id": "R1", "statement": "An order needs a customer.", "condition": "When saving.", "outcome": "Save is refused.", "lines": [4, 9]},
            {"id": "R2", "statement": "Orders over the limit need approval.", "lines": None},
        ]}},
    {"path": "src/Refunds.asp", "content": {"rules": [{"id": "R1", "statement": "A refund is capped.", "lines": [2, 3]}]}},
]
FEATURE = {"name": "Ordering", "summary": "Taking and checking orders."}


def reply(stories):
    return json.dumps({"stories": stories})


class Prompt(unittest.TestCase):
    def test_the_prompt_has_the_rules_with_their_lines_and_no_code(self):
        text = ms.build_user_text(FEATURE, SOURCES)
        self.assertIn("Rule R1 (lines 4–9): An order needs a customer.", text)
        self.assertIn("Rule R2 (no line range)", text)
        self.assertIn("Feature: Ordering", text)


class Reply(unittest.TestCase):
    def test_a_story_citing_a_real_rule_keeps_the_lines_from_the_rule(self):
        got, dropped = ms.clean_story_reply(reply([
            {"story": "As a clerk I can place an order so that it is checked.", "rules": [{"file": "src/Orders.asp", "id": "R1"}]},
        ]), SOURCES)
        self.assertEqual(got[0]["rules"], [{"file": "src/Orders.asp", "id": "R1", "lines": [4, 9]}])
        self.assertEqual(dropped, 0)

    def test_a_rule_that_does_not_exist_is_not_cited(self):
        got, dropped = ms.clean_story_reply(reply([
            {"story": "As a clerk I can place an order so that it is checked.", "rules": [{"file": "src/Orders.asp", "id": "R9"}]},
        ]), SOURCES)
        self.assertEqual(got, [])
        self.assertEqual(dropped, 1)

    def test_a_story_that_is_not_in_the_story_form_is_dropped(self):
        got, dropped = ms.clean_story_reply(reply([
            {"story": "The orders screen saves data.", "rules": [{"file": "src/Orders.asp", "id": "R1"}]},
        ]), SOURCES)
        self.assertEqual(got, [])
        self.assertEqual(dropped, 1)

    def test_a_reply_without_stories_is_not_kept(self):
        self.assertIsNone(ms.clean_story_reply("Here are some stories.", SOURCES))


class Draft(unittest.TestCase):
    def test_a_feature_with_no_approved_rules_is_refused_without_asking(self):
        called = []
        result = ms.draft_feature_stories(FEATURE, [], lambda t: called.append(t) or "")
        self.assertEqual(result["status"], "refused")
        self.assertEqual(called, [])

    def test_a_provider_error_is_reported_without_the_reply(self):
        def ask(_):
            raise RuntimeError("boom")
        result = ms.draft_feature_stories(FEATURE, SOURCES, ask)
        self.assertEqual(result["status"], "failed")
        self.assertIn("RuntimeError", result["reason"])

    def test_a_good_reply_gives_stories(self):
        result = ms.draft_feature_stories(FEATURE, SOURCES, lambda _: reply([
            {"story": "As a clerk I can place an order so that it is checked.", "rules": [{"file": "src/Orders.asp", "id": "R1"}]},
        ]))
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(result["stories"]), 1)


if __name__ == "__main__":
    unittest.main()


class RunnerOutcome(unittest.TestCase):
    def test_one_feature_failing_does_not_stop_the_others(self):
        import stories_run as sr
        good = json.dumps({"stories": [{"story": "As a clerk I can place an order so that it is checked.", "rules": [{"file": "src/Orders.asp", "id": "R1"}]}]})
        calls = {"n": 0}
        def ask(_):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("down")
            return good
        features = [
            {"name": "First", "files": SOURCES},
            {"name": "Second", "files": SOURCES},
        ]
        result = sr.draft_all(features, ask)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["features"][0]["stories"], [])
        self.assertIn("RuntimeError", result["features"][0]["reason"])
        self.assertEqual(len(result["features"][1]["stories"]), 1)

    def test_every_feature_failing_is_a_failed_run(self):
        import stories_run as sr
        def ask(_):
            raise RuntimeError("down")
        result = sr.draft_all([{"name": "Only", "files": SOURCES}], ask)
        self.assertEqual(result["status"], "failed")
