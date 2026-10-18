"""Tests for the file-level inventory. Run from the engine folder: python3 -m unittest test_file_inventory"""
import json
import unittest

import file_inventory as fi


def run(files: dict[str, str], extra_paths=()):
    paths = sorted(set(files) | set(extra_paths))
    return {r["path"]: r for r in fi.file_records(paths, files)}


class CoverageTests(unittest.TestCase):
    def test_every_file_gets_exactly_one_record(self):
        paths = ["src/main/A.java", "logo.png", "db/V1.sql"]
        records = fi.file_records(paths, {"src/main/A.java": "class A {}", "db/V1.sql": "create table t (id int);"})
        self.assertEqual(sorted(r["path"] for r in records), sorted(paths))

    def test_unreadable_files_are_listed_but_not_read(self):
        records = run({}, extra_paths=["logo.png"])
        self.assertEqual(records["logo.png"]["category"], "other")
        self.assertIn("not read", records["logo.png"]["purpose"])
        self.assertEqual(records["logo.png"]["suggestions"], [])

    def test_every_record_is_marked_sample_only(self):
        records = run({"src/main/A.java": "class A {}"})
        self.assertTrue(all(r["sample_only"] for r in records.values()))


class CategoryTests(unittest.TestCase):
    def test_categories_follow_the_path_and_type(self):
        self.assertEqual(fi.category_of("src/main/java/App.java"), "source")
        self.assertEqual(fi.category_of("src/test/java/AppTest.java"), "test")
        self.assertEqual(fi.category_of("tests/test_api.py"), "test")
        self.assertEqual(fi.category_of("templates/appointments.html"), "template")
        self.assertEqual(fi.category_of("db/V1__init.sql"), "database")
        self.assertEqual(fi.category_of("src/main/resources/application.yml"), "configuration")
        self.assertEqual(fi.category_of("infra/main.tf"), "infrastructure")
        self.assertEqual(fi.category_of("Dockerfile"), "infrastructure")
        self.assertEqual(fi.category_of("pom.xml"), "build")
        self.assertEqual(fi.category_of("README.md"), "documentation")


class PurposeTests(unittest.TestCase):
    def test_a_pipeline_file_is_described_as_a_pipeline(self):
        records = run({".github/workflows/build.yml": "on: push\njobs: {}"})
        self.assertIn("pipeline", records[".github/workflows/build.yml"]["purpose"])


class PrivacyTests(unittest.TestCase):
    def test_no_secret_url_or_code_line_is_copied_into_the_output(self):
        source = 'String password = "hunter2hunter2";\nString host = "https://billing.internal-hospital.example.net";\nint total = 3;'
        records = run({"src/main/Billing.java": source})
        output = json.dumps(list(records.values()))
        self.assertNotIn("hunter2", output)
        self.assertNotIn("billing.internal", output)
        self.assertNotIn("int total", output)

    def test_a_secret_is_flagged_without_showing_it(self):
        records = run({"src/main/Config.java": 'String apiKey = "abcd1234efgh";'})
        suggestions = records["src/main/Config.java"]["suggestions"]
        self.assertTrue(any(s["severity"] == "high" for s in suggestions))
        self.assertNotIn("abcd1234efgh", json.dumps(suggestions))


class SuggestionTests(unittest.TestCase):
    def test_todo_markers_are_counted(self):
        records = run({"src/main/A.java": "// TODO fix this\n// FIXME later\nclass A {}"})
        texts = [s["text"] for s in records["src/main/A.java"]["suggestions"]]
        self.assertTrue(any("2 open TODO or FIXME markers" in t for t in texts))

    def test_a_source_file_without_a_test_is_flagged(self):
        records = run({"src/main/Order.java": "class Order {}"})
        self.assertTrue(any("No test file" in s["text"] for s in records["src/main/Order.java"]["suggestions"]))

    def test_a_source_file_with_a_matching_test_is_not_flagged(self):
        records = run({"src/main/Order.java": "class Order {}", "src/test/OrderTest.java": "class OrderTest {}"})
        self.assertFalse(any("No test file" in s["text"] for s in records["src/main/Order.java"]["suggestions"]))

    def test_a_select_star_in_sql_is_flagged(self):
        records = run({"db/q.sql": "select * from patient_identity;"})
        self.assertTrue(any("selects all columns" in s["text"] for s in records["db/q.sql"]["suggestions"]))

    def test_suggestions_are_capped(self):
        text = 'password = "longsecret1"\nhttps://a.example.org/x\n// TODO\n.printStackTrace();\n' + "x\n" * 900
        records = run({"src/main/Big.java": text})
        self.assertLessEqual(len(records["src/main/Big.java"]["suggestions"]), fi.MAX_SUGGESTIONS)


class SizeTests(unittest.TestCase):
    def test_a_typical_record_is_small(self):
        records = run({"src/main/A.java": "class A {}"})
        self.assertLess(len(json.dumps(records["src/main/A.java"])), 1000)


if __name__ == "__main__":
    unittest.main()
