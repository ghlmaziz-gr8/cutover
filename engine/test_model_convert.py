"""Tests for the Stage 3 conversion step. Run from the engine folder: python3 -m unittest test_model_convert"""
import unittest

import model_convert as mc

CODE = "SELECT id, visited_on FROM visits WHERE id = @id;"


class ConvertTests(unittest.TestCase):
    def test_a_clean_reply_is_kept(self):
        got = mc.convert_file("visits.sql", CODE, "services-data", lambda text: "```sql\nSELECT id FROM visits;\n```")
        self.assertEqual(got["status"], "ok")
        self.assertEqual(got["proposed"], "SELECT id FROM visits;")

    def test_the_design_name_and_file_go_to_the_model(self):
        seen = []
        mc.convert_file("visits.sql", CODE, "web-modern", lambda text: seen.append(text) or "x")
        self.assertIn("a modern web front end over an API", seen[0])
        self.assertIn("visits.sql", seen[0])

    def test_personal_data_in_the_file_stops_the_request(self):
        sent = []
        got = mc.convert_file("p.sql", "INSERT INTO t VALUES ('jane@example.org');", "web-modern",
                              lambda text: sent.append(text) or "x")
        self.assertEqual(got["status"], "blocked")
        self.assertEqual(got["stage"], "request")
        self.assertEqual(got["kinds"], ["email address"])
        self.assertEqual(sent, [], "nothing is sent when the file holds personal data")

    def test_personal_data_in_the_reply_is_not_kept(self):
        got = mc.convert_file("visits.sql", CODE, "services-data", lambda text: "SELECT '555-867-5309';")
        self.assertEqual(got["status"], "blocked")
        self.assertEqual(got["stage"], "reply")
        self.assertNotIn("proposed", got)

    def test_cannot_convert_and_empty_replies_are_unusable(self):
        self.assertEqual(mc.convert_file("a", CODE, "web-modern", lambda t: "CANNOT_CONVERT")["status"], "unusable")
        self.assertEqual(mc.convert_file("a", CODE, "web-modern", lambda t: "   ")["status"], "unusable")

    def test_a_failing_provider_gives_a_plain_reason_and_never_raises(self):
        def boom(text):
            raise RuntimeError("HTTP 500 with a key-like detail")
        got = mc.convert_file("a", CODE, "web-modern", boom)
        self.assertEqual(got["status"], "failed")
        self.assertNotIn("key-like", got["reason"])

    def test_unknown_design_empty_or_large_files_are_refused(self):
        self.assertEqual(mc.convert_file("a", CODE, "rewrite-everything", lambda t: "x")["status"], "refused")
        self.assertEqual(mc.convert_file("a", "  ", "web-modern", lambda t: "x")["status"], "refused")
        self.assertEqual(mc.convert_file("a", "x" * (mc.MAX_SOURCE_CHARS + 1), "web-modern", lambda t: "x")["status"],
                         "refused")


if __name__ == "__main__":
    unittest.main()
