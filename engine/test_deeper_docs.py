"""Tests for the deeper assessment. Run from the engine folder: python3 -m unittest test_deeper_docs"""
import unittest

import deeper_docs as dd


def finding(fid, category, value):
    return {"id": fid, "category": category, "title": fid, "value": value, "confidence": "verified", "evidence_count": 1, "evidence": []}


def report(*items, **extra):
    base = {"findings": {f["id"]: f for f in items}, "history": {"available": False}}
    base.update(extra)
    return base


class BuildTests(unittest.TestCase):
    def test_an_empty_report_gives_empty_sections_and_the_limits(self):
        doc = dd.build({"findings": {}})
        self.assertEqual([s["id"] for s in doc["sections"]], ["business", "systems", "data", "workflows"])
        self.assertTrue(all(s["points"] == [] for s in doc["sections"]))
        self.assertEqual(doc["architecture"]["layers"], [])
        self.assertEqual(doc["limits"], dd.LIMITS)

    def test_every_point_names_its_finding_and_category(self):
        doc = dd.build(report(finding("data.tables", "data", {"count": 2, "names": ["visits", "orders"]})))
        point = doc["sections"][2]["points"][0]
        self.assertEqual(point["basis"], "data.tables")
        self.assertEqual(point["category"], "data")
        self.assertEqual(point["text"], "2 tables in the SQL scripts: visits, orders.")

    def test_long_name_lists_are_shortened(self):
        names = [f"t{i}" for i in range(20)]
        doc = dd.build(report(finding("data.tables", "data", {"count": 20, "names": names})))
        text = doc["sections"][2]["points"][0]["text"]
        self.assertIn("and 8 more", text)
        self.assertNotIn("t19", text)

    def test_screens_are_described_by_their_counts_and_capped(self):
        screens = [{"name": f"Screen {i}", "forms": 1, "inputs": 2, "buttons": 1} for i in range(20)]
        doc = dd.build(report(finding("ui.screens", "ui_portal", {"count": 20, "screens": screens})))
        self.assertEqual(len(doc["sections"][3]["points"]), dd.MAX_SCREENS)
        self.assertEqual(doc["sections"][3]["points"][0]["text"], 'Screen "Screen 0": 1 forms, 2 inputs, 1 buttons.')

    def test_addresses_in_the_findings_are_never_copied_into_the_document(self):
        host = "https://vendor-internal.example.test/fhir/Patient"
        doc = dd.build(report(
            finding("ui.endpoints", "ui_portal", {"count": 3, "endpoints": [host]}),
            finding("epic.fhir_endpoints", "epic", {"count": 1, "endpoints": [host]}),
        ))
        self.assertNotIn("vendor-internal", repr(doc))
        self.assertNotIn("/fhir/", repr(doc))

    def test_architecture_layers_follow_the_findings(self):
        doc = dd.build(report(
            finding("ui.roles", "ui_portal", {"count": 2, "roles": {"nurse": 1, "admin": 2}}),
            finding("ui.screens", "ui_portal", {"count": 4, "screens": []}),
            finding("data.tables", "data", {"count": 9, "names": []}),
        ))
        layers = [(layer["layer"], layer["detail"]) for layer in doc["architecture"]["layers"]]
        self.assertEqual(layers, [("Users", "nurse, admin"), ("Screens", "4 screens"), ("Data", "9 tables")])

    def test_the_history_is_described_without_a_category(self):
        doc = dd.build({"findings": {}, "history": {"available": True, "application_age_years": 3.5, "total_commits": 400, "days_since_last_commit": 10}})
        point = doc["sections"][0]["points"][0]
        self.assertEqual(point["text"], "Version history: about 3.5 years, 400 commits, last change 10 days ago.")
        self.assertIsNone(point["category"])


if __name__ == "__main__":
    unittest.main()
