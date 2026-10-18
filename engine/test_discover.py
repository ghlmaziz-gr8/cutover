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


class PortalTests(unittest.TestCase):
    """The client-facing portal card: screen names from file names, roles from access rules."""

    def _detect(self, files: dict) -> dict:
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for rel, text in files.items():
                path = root / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
            out: dict = {}
            cd.detect_ui(cd.Repo(root), out)
            return out

    def test_screen_names_come_from_template_file_names(self):
        out = self._detect({
            "web/templates/lab-results.html": "<h1>Lab</h1>",
            "web/templates/appointments.html": "<h1>Appt</h1>",
            "web/templates/secure_messages.html": "<h1>Msg</h1>",
        })
        self.assertIn("ui.screen_names", out)
        value = out["ui.screen_names"]["value"]
        self.assertEqual(value["count"], 3)
        self.assertEqual([x["name"] for x in value["screens"]], ["Appointments", "Lab Results", "Secure Messages"])
        self.assertEqual(value["screens"][0]["name"], "Appointments")
        self.assertEqual(value["screens"][0]["path"], "web/templates/appointments.html")
        self.assertEqual(out["ui.screen_names"]["confidence"], "inferred")

    def test_screen_layout_comes_from_the_markup(self):
        out = self._detect({
            "web/templates/checkin.html": (
                "<h1>Check in</h1><h2>Visit details</h2>"
                "<form><input name='a'><select name='b'></select><button type='submit'>Go</button></form>"
                "<table><thead><tr><th>Name</th><th>Time</th><th>Room</th></tr></thead></table>"
                "<ul><li>One</li></ul><img src='x.png'>"
            ),
        })
        screen = out["ui.screen_names"]["value"]["screens"][0]
        self.assertEqual(screen["name"], "Checkin")
        self.assertEqual(screen["headings"], ["Check in", "Visit details"])
        self.assertEqual((screen["forms"], screen["inputs"], screen["buttons"]), (1, 2, 1))
        self.assertEqual((screen["tables"], screen["table_columns"], screen["lists"], screen["images"]), (1, 3, 1, 1))

    def test_a_one_page_site_is_read_from_its_sections(self):
        out = self._detect({
            "index.html": (
                "<section id='capabilities'><h2>Capabilities</h2><img src='a.jpg'></section>"
                "<section id='rfq'><h2>Request a quote</h2><form><input name='a'>"
                "<button>Send</button></form></section>"
            ),
        })
        self.assertEqual(out["ui.screen_names"]["value"]["count"], 1)
        screen = out["ui.screen_names"]["value"]["screens"][0]
        self.assertEqual(screen["section_count"], 2)
        self.assertEqual([x["title"] for x in screen["sections"]], ["Capabilities", "Request a quote"])
        self.assertEqual((screen["sections"][1]["inputs"], screen["sections"][1]["buttons"]), (1, 1))

    def test_a_bare_page_reports_no_layout_elements(self):
        out = self._detect({"web/templates/results.html": "<html><body>Results</body></html>"})
        screen = out["ui.screen_names"]["value"]["screens"][0]
        self.assertEqual(screen["inputs"], 0)
        self.assertEqual(screen["tables"], 0)
        self.assertEqual(screen["headings"], [])

    def test_no_screen_finding_when_no_screen_files(self):
        out = self._detect({"src/Main.java": "class Main {}"})
        self.assertNotIn("ui.screen_names", out)

    def test_roles_are_counted_from_access_rules(self):
        out = self._detect({
            "src/PortalController.java": (
                '@PreAuthorize("hasRole(\'PATIENT\')")\nvoid a() {}\n'
                '@RolesAllowed("PATIENT")\nvoid b() {}\n'
            ),
        })
        self.assertIn("ui.roles", out)
        value = out["ui.roles"]["value"]
        self.assertEqual(value["count"], 1)
        self.assertEqual(value["roles"], {"PATIENT": 2})

    def test_staff_only_roles_are_left_out_of_the_portal(self):
        out = self._detect({
            "src/StaffController.java": '@PreAuthorize("hasRole(\'FRONTDESK\')")\nvoid a() {}\n',
            "src/PortalController.java": '@PreAuthorize("hasRole(\'PATIENT\')")\nvoid b() {}\n',
        })
        self.assertEqual(out["ui.roles"]["value"]["roles"], {"PATIENT": 1})
        self.assertEqual(out["ui.roles"]["confidence"], "verified")

    def test_no_roles_finding_without_access_rules(self):
        out = self._detect({"src/Main.java": "class Main {}"})
        self.assertNotIn("ui.roles", out)


if __name__ == "__main__":
    unittest.main()
