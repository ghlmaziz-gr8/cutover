"""Tests for legacy detection (classic ASP, VBScript, legacy databases) and the read-only Access metadata script.
Run: python3 -m unittest -q test_legacy
"""
import json
import tempfile
import unittest
from pathlib import Path

import access_metadata
import legacy


class AspViewTests(unittest.TestCase):
    def test_control_names_in_code_and_links_are_screens(self):
        text = '''
        <a href="manageit.asp?Mode=Display&ControlName=My%20Account">x</a>
        If Controlname = "Closed" Then
        ControlName="DisplayProjectDetail"
        controlname="dashboard"
        '''
        self.assertEqual(legacy.views_in(text), {"My Account", "Closed", "DisplayProjectDetail", "dashboard"})

    def test_dynamic_control_names_are_not_screens(self):
        text = 'ControlName <> "Closed"\nsql = "x" & ControlName & "y"\nControlname= request("Controlname")'
        self.assertEqual(legacy.views_in(text), set())

    def test_same_view_in_two_cases_is_one_screen(self):
        files = {"a.asp": 'ControlName="Closed"', "b.asp": 'Controlname="closed"'}
        self.assertEqual(sorted(legacy.asp_views(files)), ["Closed"])

    def test_includes_are_not_pages(self):
        paths = ["manageit.asp", "inc_upload.asp", "includefiles/inc_commonfunctions.asp", "AJAX/time.asp"]
        self.assertEqual(legacy.asp_pages(paths), ["manageit.asp", "AJAX/time.asp"])


class SqlTableTests(unittest.TestCase):
    def test_sql_in_a_string_gives_the_table(self):
        self.assertEqual(legacy.sql_tables_in('FillSelectOptions("Select * from location", 1)'), {"location"})

    def test_page_text_is_not_sql(self):
        self.assertEqual(legacy.sql_tables_in('<td>From Date:</td><p>Please update your details</p>'), set())

    def test_update_and_join_are_found(self):
        text = 'sSQL = "Update DerivedForms set Name=1"\nq = "SELECT A.x from homepage_navigation A, homepage_navigation B where A.ID = B.ID"'
        self.assertEqual(legacy.sql_tables_in(text), {"DerivedForms", "homepage_navigation"})

    def test_names_that_differ_only_in_case_are_one_table(self):
        files = {"a.asp": '"Select * from Permissions"', "b.asp": '"Select * from permissions"'}
        tables = legacy.sql_tables(files)
        self.assertEqual(len(tables), 1)
        (shown, used_in), = tables.items()
        self.assertEqual(shown.lower(), "permissions")
        self.assertEqual(used_in, ["a.asp", "b.asp"])


class DatabaseFileTests(unittest.TestCase):
    def test_access_is_recognised_by_its_signature(self):
        head = b"\x00\x01\x00\x00" + b"Standard Jet DB\x00" + b"\x00" * 12
        self.assertEqual(legacy.database_kind("db/ManageIt.mdb", head)[:2], ("Microsoft Access", 1))

    def test_a_file_named_mdb_without_the_signature_is_not_claimed(self):
        self.assertIsNone(legacy.database_kind("notes.mdb", b"hello world" + b"\x00" * 20))

    def test_sqlite_is_recognised_by_its_signature(self):
        self.assertEqual(legacy.database_kind("app.db", b"SQLite format 3\x00" + b"\x00" * 16)[:2], ("SQLite", 1))

    def test_thumbs_db_is_never_a_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "images").mkdir()
            (root / "images" / "Thumbs.db").write_bytes(b"\xd0\xcf\x11\xe0" + b"\x00" * 60)
            self.assertEqual(legacy.database_files(root, ["images/Thumbs.db"]), [])

    def test_unknown_db_file_is_listed_not_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "old.db").write_bytes(b"\x00" * 64)
            rows = legacy.database_files(root, ["old.db"])
            self.assertEqual(rows[0]["tier"], 3)
            self.assertIn("not read", rows[0]["identified"])


class LanguageTests(unittest.TestCase):
    def test_classic_asp_and_vb6_are_tier_one(self):
        self.assertEqual(legacy.language_of("manageit.asp", "")[1], 1)
        self.assertEqual(legacy.language_of("Form1.frm", "")[0], "Visual Basic 6")

    def test_an_include_is_asp_only_with_script_blocks(self):
        self.assertIsNone(legacy.language_of("style.inc", "body {}"))
        self.assertEqual(legacy.language_of("upload.inc", "<% Response.Write 1 %>")[0], "Classic ASP include")

    def test_tier_three_is_counted_not_read(self):
        self.assertEqual(legacy.language_of("PAYROLL.rpgle", None), ("RPG", 3))


class MetadataValidationTests(unittest.TestCase):
    def good(self):
        return {"format": legacy.META_FORMAT, "database": "ManageIt.mdb", "engine": "Microsoft Access",
                "tables": [{"name": "Login", "row_count": 12,
                            "columns": [{"name": "LoginID", "type": "LONG", "nullable": False}]}]}

    def test_names_types_and_counts_are_accepted(self):
        self.assertEqual(legacy.validate_metadata(self.good())["tables"][0]["name"], "Login")

    def test_row_values_are_refused(self):
        doc = self.good()
        doc["tables"][0]["rows"] = [["Abdul", "555-0100"]]
        with self.assertRaises(ValueError):
            legacy.validate_metadata(doc)

    def test_a_field_with_a_value_is_refused(self):
        doc = self.good()
        doc["tables"][0]["columns"][0]["value"] = "patient"
        with self.assertRaises(ValueError):
            legacy.validate_metadata(doc)

    def test_a_file_of_another_format_is_refused(self):
        doc = self.good()
        doc["format"] = "something-else"
        with self.assertRaises(ValueError):
            legacy.validate_metadata(doc)

    def test_a_bad_row_count_is_refused(self):
        doc = self.good()
        doc["tables"][0]["row_count"] = "many"
        with self.assertRaises(ValueError):
            legacy.validate_metadata(doc)


class FakeCursor:
    def __init__(self, db):
        self.db = db
        self.last = None

    def tables(self):
        return [("", "", name, kind) for name, kind in self.db["tables"]]

    def columns(self, table):
        return [("", "", table, col, 4, typ, 0, 0, 0, 0, 1 if nullable else 0)
                for col, typ, nullable in self.db["columns"][table]]

    def execute(self, sql):
        self.last = sql
        if "COUNT(*)" not in sql:
            raise AssertionError("only COUNT(*) may run against table data: " + sql)
        table = sql.split("FROM ", 1)[1].strip("[]")
        if table not in self.db["counts"]:
            raise RuntimeError("cannot count")
        self.count = self.db["counts"][table]
        return self

    def fetchone(self):
        return (self.count,)


class FakeConnection:
    def __init__(self, db):
        self.db = db
        self.closed = False

    def cursor(self):
        return FakeCursor(self.db)

    def close(self):
        self.closed = True


class AccessMetadataTests(unittest.TestCase):
    def db(self):
        return {
            "tables": [("Login", "TABLE"), ("MSysObjects", "SYSTEM TABLE"), ("qryDisplay", "VIEW"), ("states", "TABLE")],
            "columns": {"Login": [("LoginID", "LONG", False), ("Name", "TEXT", True)],
                        "states": [("Code", "TEXT", False)]},
            "counts": {"Login": 42, "states": 51},
        }

    def test_connection_is_read_only(self):
        self.assertIn("ReadOnly=1", access_metadata.connection_string("C:/x/ManageIt.mdb"))

    def test_only_tables_are_listed_and_system_tables_are_skipped(self):
        doc = access_metadata.collect(FakeConnection(self.db()), database="ManageIt.mdb")
        self.assertEqual([t["name"] for t in doc["tables"]], ["Login", "states"])
        self.assertEqual(doc["format"], access_metadata.FORMAT)

    def test_counts_and_fields_come_back_and_no_values_do(self):
        doc = access_metadata.collect(FakeConnection(self.db()), database="ManageIt.mdb")
        login = doc["tables"][0]
        self.assertEqual(login["row_count"], 42)
        self.assertEqual(login["columns"][1], {"name": "Name", "type": "TEXT", "nullable": True})
        self.assertEqual(legacy.validate_metadata(doc)["database"], "ManageIt.mdb")

    def test_a_table_that_cannot_be_counted_is_null_not_an_error(self):
        db = self.db()
        del db["counts"]["states"]
        doc = access_metadata.collect(FakeConnection(db), database="ManageIt.mdb")
        self.assertIsNone(doc["tables"][1]["row_count"])

    def test_names_with_a_closing_bracket_are_quoted_safely(self):
        self.assertEqual(access_metadata.quote_name("odd]name"), "[odd]]name]")

    def test_the_output_passes_the_metadata_check(self):
        doc = access_metadata.collect(FakeConnection(self.db()), database="ManageIt.mdb")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "meta.json"
            path.write_text(json.dumps(doc), encoding="utf-8")
            legacy.validate_metadata(json.loads(path.read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()


class TablePrecedenceTests(unittest.TestCase):
    """The document and the cost estimate use the best table count: the client's metadata, then SQL scripts, then code."""

    def test_metadata_beats_scripts_and_code(self):
        import deeper_docs
        report = {"findings": {
            "data.database_metadata": {"value": {"tables": 7}},
            "data.tables": {"value": {"count": 3, "names": []}},
            "data.tables_in_code": {"value": {"count": 19, "names": []}},
        }}
        self.assertEqual(deeper_docs._tables(report), (7, "data.database_metadata"))

    def test_code_is_used_when_nothing_better_exists(self):
        import deeper_docs
        report = {"findings": {"data.tables_in_code": {"value": {"count": 19, "names": []}}}}
        self.assertEqual(deeper_docs._tables(report), (19, "data.tables_in_code"))

    def test_nothing_found_is_none(self):
        import deeper_docs
        self.assertEqual(deeper_docs._tables({"findings": {}}), (None, None))


class RoutineTests(unittest.TestCase):
    def test_views_procedures_and_functions_are_counted_once_each(self):
        files = {
            "db/schema.sql": "CREATE OR REPLACE VIEW dbo.vw_Active AS SELECT 1;\n"
                             "create procedure [dbo].[GetUsers] as select 1\n"
                             "CREATE FUNCTION fnTotal(@x int) RETURNS int AS BEGIN RETURN @x END\n"
                             "create proc GetUsers as select 2\n",
            "pages/list.asp": "<% 'CREATE VIEW ActiveUsers' %>",
        }
        found = legacy.routines(files)
        self.assertEqual(sorted(found["views"].values()), ["ActiveUsers", "vw_Active"])
        self.assertEqual(list(found["procedures"].values()), ["GetUsers"], "a name twice is counted once")
        self.assertEqual(list(found["functions"].values()), ["fnTotal"])

    def test_documentation_is_not_counted(self):
        files = {"README.md": "CREATE VIEW example AS SELECT 1", "notes.txt": "create procedure demo"}
        found = legacy.routines(files)
        self.assertEqual(found, {"views": {}, "procedures": {}, "functions": {}})
