"""Tests for the discovery engine, run against the synthetic answer-key fixture.

Run with:  python3 -m unittest engine/test_discover.py
"""
import datetime as dt
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cutover_discover as cd  # noqa: E402

FIXTURE = HERE.parent / "fixtures" / "synthetic-epic-app"
EXPECTED = json.loads((FIXTURE / "EXPECTED.json").read_text(encoding="utf-8"))
NOW = dt.datetime(2026, 10, 13, tzinfo=dt.timezone.utc)


class FixtureAnswerKeyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        repo = cd.Repo(FIXTURE)
        cls.report = cd.analyze(repo, FIXTURE, NOW, {"type": "local", "ref": None})
        cls.findings = cls.report["findings"]

    def test_every_expected_value_matches(self):
        for fid, expected in EXPECTED["findings"].items():
            with self.subTest(finding=fid):
                self.assertIn(fid, self.findings, f"engine did not report {fid}")
                self.assertEqual(self.findings[fid]["value"], expected)

    def test_flags_match(self):
        self.assertEqual(sorted(self.report["flags"]), sorted(EXPECTED["flags"]))

    def test_unverified_findings_are_labelled_inferred_or_verified(self):
        for fid, f in self.findings.items():
            with self.subTest(finding=fid):
                self.assertIn(f["confidence"], ("verified", "inferred"))

    def test_no_history_inside_a_parent_repository(self):
        # The fixture sits inside the Cutover repo, so it is not its own repository root.
        self.assertFalse(self.report["history"]["available"])

    def test_patient_identifiers_never_reach_output(self):
        blob = json.dumps(self.report)
        for secret in EXPECTED["must_not_appear"]:
            self.assertNotIn(secret, blob)


class HelperTests(unittest.TestCase):
    def test_resolve_url_accepts_owner_name(self):
        self.assertEqual(cd.resolve_url("acme/app"), "https://github.com/acme/app.git")

    def test_resolve_url_rejects_embedded_credentials(self):
        with self.assertRaises(SystemExit):
            cd.resolve_url("https://user:secret@github.com/acme/app.git")

    def test_token_is_redacted_from_errors(self):
        self.assertEqual(cd._redact("failed with ghp_abc123", "ghp_abc123"), "failed with ***")


if __name__ == "__main__":
    unittest.main()
