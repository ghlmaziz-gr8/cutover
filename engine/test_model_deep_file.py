"""Tests for the deep assessment of one file. Run from the engine folder: python3 -m unittest test_model_deep_file"""
import json
import unittest

import model_deep_file as md

CODE = (
    "Public Function CancelVisit(visitId As Long)\n"
    "    Call FreeSlot(visitId)\n"
    "    Call writeLog(\"cancelled\")\n"
    "End Function\n"
    "Sub FreeSlot(id As Long)\nEnd Sub\n"
)


def reply(**overrides):
    body = {
        "file_purpose": "Cancels a patient visit and frees its slot.",
        "file_user_stories": ["As a receptionist I can cancel a visit so that the slot is free again."],
        "functions": [
            {"name": "CancelVisit", "purpose": "Cancels one visit.",
             "user_stories": ["As a receptionist I can cancel a visit."],
             "calls": ["FreeSlot", "writeLog"]},
            {"name": "FreeSlot", "purpose": "Frees a slot.", "user_stories": [], "calls": []},
        ],
    }
    body.update(overrides)
    return json.dumps(body)


class AppearsIn(unittest.TestCase):
    def test_a_name_is_found_whole_and_ignoring_case(self):
        self.assertTrue(md.appears_in("cancelvisit", CODE))
        self.assertTrue(md.appears_in("writelog", CODE))

    def test_a_part_of_a_longer_name_is_not_found(self):
        self.assertFalse(md.appears_in("Cancel", CODE))
        self.assertFalse(md.appears_in("", CODE))


class CleanReply(unittest.TestCase):
    def test_a_good_reply_keeps_its_names_and_counts_nothing_dropped(self):
        content, dropped = md.clean_reply(reply(), CODE)
        self.assertEqual(dropped, 0)
        self.assertEqual([f["name"] for f in content["functions"]], ["CancelVisit", "FreeSlot"])
        self.assertEqual(content["functions"][0]["calls"], ["FreeSlot", "writeLog"])

    def test_a_function_name_the_code_does_not_contain_is_dropped(self):
        bad = json.loads(reply())
        bad["functions"].append({"name": "InventedRoutine", "purpose": "x", "user_stories": [], "calls": []})
        content, dropped = md.clean_reply(json.dumps(bad), CODE)
        self.assertNotIn("InventedRoutine", [f["name"] for f in content["functions"]])
        self.assertEqual(dropped, 1)

    def test_a_call_the_code_does_not_contain_is_dropped_and_counted(self):
        bad = json.loads(reply())
        bad["functions"][0]["calls"] = ["FreeSlot", "NoSuchProgram"]
        content, dropped = md.clean_reply(json.dumps(bad), CODE)
        self.assertEqual(content["functions"][0]["calls"], ["FreeSlot"])
        self.assertEqual(dropped, 1)

    def test_a_fenced_reply_is_read(self):
        self.assertIsNotNone(md.clean_reply("```json\n" + reply() + "\n```", CODE))

    def test_a_reply_without_a_purpose_or_a_function_list_is_unusable(self):
        self.assertIsNone(md.clean_reply(reply(file_purpose=""), CODE))
        self.assertIsNone(md.clean_reply(reply(functions="none"), CODE))
        self.assertIsNone(md.clean_reply("not json", CODE))

    def test_a_repeated_name_is_kept_once(self):
        twice = json.loads(reply())
        twice["functions"].append(dict(twice["functions"][0]))
        content, _ = md.clean_reply(json.dumps(twice), CODE)
        self.assertEqual(len(content["functions"]), 2)


class AssessFile(unittest.TestCase):
    def test_a_good_answer_is_ok_and_marked_model_read(self):
        got = md.assess_file("src/Visits.bas", CODE, lambda text: reply())
        self.assertEqual(got["status"], "ok")
        self.assertEqual(got["confidence"], "model_read")
        self.assertEqual(got["dropped"], 0)

    def test_personal_data_in_the_file_stops_the_request(self):
        got = md.assess_file("src/Patients.bas", "Dim email As String\nemail = \"ada@example.com\"\n", lambda text: reply())
        self.assertEqual(got["status"], "blocked")
        self.assertEqual(got["stage"], "request")

    def test_a_failed_provider_keeps_nothing(self):
        def boom(text):
            raise RuntimeError("down")
        self.assertEqual(md.assess_file("a.bas", CODE, boom)["status"], "failed")

    def test_an_empty_file_is_refused_without_asking(self):
        asked = []
        got = md.assess_file("empty.bas", "   ", lambda text: asked.append(text) or reply())
        self.assertEqual(got["status"], "refused")
        self.assertEqual(asked, [])

    def test_an_unusable_reply_keeps_nothing(self):
        self.assertEqual(md.assess_file("a.bas", CODE, lambda text: "sure!")["status"], "unusable")


if __name__ == "__main__":
    unittest.main()


from model_deep_file import clean_reply, reply_shape


class TolerantReply(unittest.TestCase):
    CODE = "Public Sub TakeOrder()\nEnd Sub\n"

    def test_a_reply_with_a_sentence_before_the_object_is_still_read(self):
        reply = 'Here is the assessment: {"file_purpose": "Takes orders.", "functions": []}'
        content, dropped = clean_reply(reply, self.CODE)
        self.assertEqual(content["file_purpose"], "Takes orders.")

    def test_a_file_with_no_functions_may_leave_the_list_out(self):
        content, dropped = clean_reply('{"file_purpose": "Takes orders."}', self.CODE)
        self.assertEqual(content["functions"], [])

    def test_a_reply_with_no_object_is_still_not_kept(self):
        self.assertIsNone(clean_reply("I could not read this file.", self.CODE))

    def test_the_shape_of_a_bad_reply_has_no_text_in_it(self):
        shape = reply_shape("secret customer code here")
        self.assertIn("chars=", shape)
        self.assertNotIn("secret", shape)


class ProviderFailureReasons(unittest.TestCase):
    CODE = "Public Sub TakeOrder()\nEnd Sub\n"

    def test_a_reply_cut_off_says_so_instead_of_a_generic_failure(self):
        from model_purposes import ProviderError
        def ask(_):
            raise ProviderError("reply cut off")
        result = md.assess_file("src/A.bas", self.CODE, ask)
        self.assertEqual(result["status"], "failed")
        self.assertIn("ran out of room", result["reason"])

    def test_a_rate_limit_says_so(self):
        from model_purposes import ProviderStopped
        def ask(_):
            raise ProviderStopped(429)
        result = md.assess_file("src/A.bas", self.CODE, ask)
        self.assertIn("HTTP 429", result["reason"])


class RulesExamplesData(unittest.TestCase):
    """Business rules, worked examples and data access are kept only when the code supports them."""

    def clean(self, **overrides):
        return md.clean_reply(reply(**overrides), CODE)

    def test_a_rule_with_real_lines_and_names_is_kept(self):
        content, _ = self.clean(rules=[{
            "id": "R1", "statement": "A visit is cancelled and its slot freed.",
            "condition": "When CancelVisit runs.", "outcome": "The slot is freed.",
            "values": ["cancelled"], "data": [], "function": "CancelVisit", "lines": [1, 4],
        }])
        self.assertEqual(content["rules"][0]["id"], "R1")
        self.assertEqual(content["rules"][0]["lines"], [1, 4])
        self.assertEqual(content["rules"][0]["values"], ["cancelled"])
        self.assertEqual(content["rules"][0]["function"], "CancelVisit")

    def test_line_numbers_outside_the_file_are_dropped_not_the_rule(self):
        content, dropped = self.clean(rules=[{
            "id": "R1", "statement": "Frees a slot.", "lines": [1, 999],
        }])
        self.assertEqual(content["rules"][0]["lines"], None)
        self.assertEqual(len(content["rules"]), 1)

    def test_a_value_the_code_does_not_contain_is_dropped_and_counted(self):
        content, dropped = self.clean(rules=[{
            "id": "R1", "statement": "Frees a slot.", "values": ["pdf", "cancelled"], "lines": [5, 5],
        }])
        self.assertEqual(content["rules"][0]["values"], ["cancelled"])
        self.assertGreaterEqual(dropped, 1)

    def test_a_rule_without_a_statement_is_skipped(self):
        content, dropped = self.clean(rules=[{"id": "R1", "statement": "  "}, {"id": "R2", "statement": "Frees a slot."}])
        self.assertEqual([r["id"] for r in content["rules"]], ["R2"])
        self.assertGreaterEqual(dropped, 1)

    def test_an_example_for_a_missing_rule_is_dropped(self):
        content, _ = self.clean(
            rules=[{"id": "R1", "statement": "Frees a slot."}],
            examples=[{"rule": "R1", "given": "visit 7", "expect": "slot 7 free"},
                      {"rule": "R9", "given": "visit 8", "expect": "nothing"}],
        )
        self.assertEqual([e["rule"] for e in content["examples"]], ["R1"])

    def test_an_example_missing_its_result_is_dropped(self):
        content, _ = self.clean(
            rules=[{"id": "R1", "statement": "Frees a slot."}],
            examples=[{"rule": "R1", "given": "visit 7", "expect": ""}],
        )
        self.assertEqual(content["examples"], [])

    def test_data_access_keeps_only_names_the_code_contains(self):
        content, dropped = self.clean(data_access=[
            {"function": "CancelVisit", "reads": [], "writes": ["visits.status"]},
            {"function": "NoSuchFunction", "reads": ["x"], "writes": []},
        ])
        self.assertEqual(content["data_access"], [])  # visits.status is not in CODE, the other function is not in CODE
        self.assertGreaterEqual(dropped, 2)

    def test_a_reply_without_the_new_fields_still_works(self):
        content, dropped = self.clean()
        self.assertEqual(content["rules"], [])
        self.assertEqual(content["examples"], [])
        self.assertEqual(content["data_access"], [])
        self.assertEqual(dropped, 0)


SQL_CODE = (
    "Public Function LoadVisit(visitId As Long)\n"
    "    rs = \"SELECT status FROM visits WHERE id = \" & visitId\n"
    "    Call SaveVisit(visitId)\n"
    "End Function\n"
    "Sub SaveVisit(id As Long)\n"
    "    rs = \"UPDATE visits SET status = 'x' WHERE id = \" & id\n"
    "End Sub\n"
)


class DatabaseSection(unittest.TestCase):
    def clean(self, database):
        body = {
            "file_purpose": "Loads and saves a visit.",
            "functions": [{"name": "LoadVisit", "calls": ["SaveVisit"]}, {"name": "SaveVisit", "calls": []}],
            "database": database,
        }
        return md.clean_reply(json.dumps(body), SQL_CODE)

    def test_a_table_the_code_names_is_kept_with_its_operations_and_fields(self):
        content, _ = self.clean({
            "tables": [{"name": "visits", "operations": ["SELECT", "UPDATE"], "fields": ["status", "id"]}],
            "queries": [{"function": "LoadVisit", "operation": "SELECT", "tables": ["visits"], "purpose": "Reads a visit."}],
        })
        self.assertEqual(content["database"]["tables"][0]["name"], "visits")
        self.assertEqual(content["database"]["tables"][0]["operations"], ["SELECT", "UPDATE"])
        self.assertEqual(content["database"]["tables"][0]["fields"], ["status", "id"])
        self.assertEqual(content["database"]["queries"][0]["operation"], "SELECT")

    def test_a_table_the_code_does_not_name_is_dropped(self):
        content, dropped = self.clean({"tables": [{"name": "patients", "operations": ["SELECT"], "fields": []}], "queries": []})
        self.assertEqual(content["database"]["tables"], [])
        self.assertGreaterEqual(dropped, 1)

    def test_an_operation_outside_the_four_is_dropped(self):
        content, _ = self.clean({"tables": [{"name": "visits", "operations": ["MERGE", "DELETE"], "fields": []}], "queries": []})
        self.assertEqual(content["database"]["tables"][0]["operations"], ["DELETE"])

    def test_a_query_with_no_known_table_is_dropped(self):
        content, _ = self.clean({"tables": [], "queries": [{"function": "LoadVisit", "operation": "SELECT", "tables": ["invoices"]}]})
        self.assertEqual(content["database"]["queries"], [])

    def test_a_reply_without_database_access_gives_empty_lists(self):
        content, _ = self.clean(None)
        self.assertEqual(content["database"], {"tables": [], "queries": []})
