"""Tests for the AI origin estimate. Run from the engine folder: python3 -m unittest test_model_origin"""
import json
import tempfile
import unittest
from pathlib import Path

import model_origin as mo

NOW = 2026
EVIDENCE = "Copyright 2009 Example Health Ltd\nfile header: Written 2011 by the team"


def history(with_origin=True):
    h = {"available": True, "first_commit": "2024-03-01", "total_commits": 4}
    if with_origin:
        h["origin"] = {"earliest_year": 2009, "typical_year": 2011, "latest_year": 2014,
                       "files_with_years": 12, "files_scanned": 30, "confidence": "medium", "evidence": []}
    return h


def reply(**overrides):
    data = {"earliest_year": 2009, "typical_year": 2011, "confidence": "medium",
            "reasons": ["Headers in several files give years between 2009 and 2014."]}
    data.update(overrides)
    return json.dumps(data)


class ParseReplyTests(unittest.TestCase):
    def test_valid_reply_is_kept(self):
        got = mo.parse_reply(reply(), NOW, EVIDENCE)
        self.assertEqual(got["earliest_year"], 2009)
        self.assertEqual(got["typical_year"], 2011)
        self.assertEqual(got["confidence"], "medium")
        self.assertEqual(len(got["reasons"]), 1)

    def test_json_inside_text_is_found(self):
        got = mo.parse_reply("Here it is: " + reply() + " Thanks.", NOW, EVIDENCE)
        self.assertIsNotNone(got)

    def test_bad_replies_are_dropped(self):
        self.assertIsNone(mo.parse_reply("no json at all", NOW, EVIDENCE))
        self.assertIsNone(mo.parse_reply("{not json}", NOW, EVIDENCE))
        self.assertIsNone(mo.parse_reply(reply(earliest_year=1950), NOW, EVIDENCE))
        self.assertIsNone(mo.parse_reply(reply(earliest_year=2030), NOW, EVIDENCE))
        self.assertIsNone(mo.parse_reply(reply(typical_year=2005), NOW, EVIDENCE))  # typical before earliest
        self.assertIsNone(mo.parse_reply(reply(earliest_year="2009"), NOW, EVIDENCE))
        self.assertIsNone(mo.parse_reply(reply(earliest_year=True, typical_year=True), NOW, EVIDENCE))
        self.assertIsNone(mo.parse_reply(reply(confidence="certain"), NOW, EVIDENCE))

    def test_reason_that_copies_the_evidence_is_dropped(self):
        copied = "Copyright 2009 Example Health Ltd is written in the header"
        got = mo.parse_reply(reply(reasons=[copied, "A short plain reason about the years."]), NOW, EVIDENCE)
        self.assertEqual(got["reasons"], ["A short plain reason about the years."])

    def test_reasons_are_capped(self):
        many = [f"Reason number {i} is a short plain sentence." for i in range(9)]
        got = mo.parse_reply(reply(reasons=many), NOW, EVIDENCE)
        self.assertEqual(len(got["reasons"]), mo.MAX_REASONS)

    def test_long_reason_is_cut(self):
        got = mo.parse_reply(reply(reasons=["word " * 200]), NOW, EVIDENCE)
        self.assertLessEqual(len(got["reasons"][0]), mo.REASON_CHARS)


class EvidenceTests(unittest.TestCase):
    def test_evidence_has_rule_based_git_names_and_year_lines(self):
        records = [{"path": "a.asp", "category": "source"}, {"path": "b.txt", "category": "other"}]
        sources = {"a.asp": "' Copyright 2009 Example\nresponse.write 1\n"}
        text = mo.gather_evidence(records, sources.get, NOW, history())
        self.assertIn("Rule-based reading: earliest 2009, typical 2011", text)
        self.assertIn("first commit 2024-03-01", text)
        self.assertIn("- a.asp", text)
        self.assertIn("- a.asp: ' Copyright 2009 Example", text)
        self.assertNotIn("response.write", text)

    def test_no_year_is_said_plainly(self):
        text = mo.gather_evidence([], lambda p: None, NOW, {"available": False, "origin": {}})
        self.assertIn("no year is written", text)
        self.assertIn("no usable history", text)

    def test_evidence_is_capped(self):
        records = [{"path": f"f{i}.asp", "category": "source"} for i in range(400)]
        text = mo.gather_evidence(records, lambda p: "x 2010 " * 500, NOW, history())
        self.assertLessEqual(len(text), mo.EVIDENCE_CHARS)


class RunOriginTests(unittest.TestCase):
    def write_findings(self, folder, with_origin=True):
        path = Path(folder) / "findings.json"
        path.write_text(json.dumps({"history": history(with_origin)}), encoding="utf-8")
        return path

    def test_estimate_is_merged_and_rule_based_block_is_kept(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write_findings(folder)
            message = mo.run_origin(path, [{"path": "a.asp", "category": "source"}], lambda p: None, NOW,
                                    lambda text: reply(), "google")
            self.assertIn("AI origin estimate written", message)
            data = json.loads(path.read_text(encoding="utf-8"))["history"]["origin"]
            self.assertEqual(data["earliest_year"], 2009)  # rule-based block unchanged
            self.assertEqual(data["model_estimate"]["typical_year"], 2011)
            self.assertEqual(data["model_estimate"]["provider"], "google")

    def test_failure_leaves_findings_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write_findings(folder)
            before = path.read_text(encoding="utf-8")

            def boom(text):
                raise RuntimeError("HTTP 500 with a secret-looking detail")

            message = mo.run_origin(path, [], lambda p: None, NOW, boom, "openai")
            self.assertIn("failed", message)
            self.assertNotIn("secret", message)
            self.assertEqual(path.read_text(encoding="utf-8"), before)

    def test_unusable_reply_leaves_findings_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write_findings(folder)
            before = path.read_text(encoding="utf-8")
            message = mo.run_origin(path, [], lambda p: None, NOW, lambda text: "sorry, no", "google")
            self.assertIn("not usable", message)
            self.assertEqual(path.read_text(encoding="utf-8"), before)

    def test_no_origin_block_is_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            path = self.write_findings(folder, with_origin=False)
            message = mo.run_origin(path, [], lambda p: None, NOW, lambda text: reply(), "google")
            self.assertIn("No origin block", message)


if __name__ == "__main__":
    unittest.main()
