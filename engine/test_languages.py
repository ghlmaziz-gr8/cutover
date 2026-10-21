"""Tests for the full inventory: file types, age ranges, language packs and the fixture set.
Run: python3 -m unittest -q test_languages
"""
import unittest
from datetime import datetime
from pathlib import Path

import age
import filetypes
import inventory
import languages

FIX = Path(__file__).parent / "fixtures" / "legacy"
NOW = datetime(2026, 10, 21)


def load(rel):
    return (FIX / rel).read_text(encoding="utf-8")


class FileTypeTests(unittest.TestCase):
    def test_signatures_identify_binaries_whatever_the_name(self):
        self.assertEqual(filetypes.identify("x.dat", b"%PDF-1.4")["kind"], "document")
        self.assertEqual(filetypes.identify("scan.bin", b"\x89PNG\r\n\x1a\n")["format"], "PNG image")
        self.assertEqual(filetypes.identify("db/app.bin", b"\x00\x01\x00\x00Standard Jet DB\x00")["format"], "Microsoft Access")

    def test_thumbs_db_is_a_cache_not_a_database(self):
        self.assertEqual(filetypes.identify("images/Thumbs.db", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")["kind"], "tool")

    def test_legacy_text_is_text_in_any_8_bit_encoding(self):
        head = "Caf\xe9 men\xfa — 1997".encode("cp1252")
        self.assertEqual(filetypes.identify("notes.zzz", head)["kind"], "text")
        self.assertEqual(filetypes.encoding_of(head), "8-bit (legacy)")

    def test_unknown_binary_is_not_guessed(self):
        self.assertEqual(filetypes.identify("mystery.q9", b"\x00\x01\x02\x03")["method"], "none")


class AgeTests(unittest.TestCase):
    def test_git_dates_take_first_and_last_change(self):
        out = "2014-03-02\n\nsrc/a.asp\n2012-01-10\n\nsrc/a.asp\nsrc/b.asp\n"
        self.assertEqual(age.git_dates(out)["src/a.asp"], ("2012-01-10", "2014-03-02"))

    def test_years_in_a_file_give_the_range_and_name_the_evidence(self):
        r = age.range_for("a.asp", "' Copyright (c) 1998 Acme\n' Modified 2003\n", {}, NOW)
        self.assertEqual((r["earliest"], r["latest"]), (1998, 2003))
        self.assertIn("years written in the file 1998 to 2003", r["evidence"])

    def test_no_evidence_means_no_age(self):
        self.assertIsNone(age.range_for("a.txt", "hello", None, NOW))

    def test_years_outside_the_window_are_ignored(self):
        self.assertEqual(age.years_in_text("Copyright 1850\n", 2026), [])

    def test_two_digit_stamp_is_read_as_a_year_in_the_1900s(self):
        self.assertEqual(age.years_in_text("Date: 03/12/97\n", 2026), [1997])


class PackTests(unittest.TestCase):
    """Each language pack identifies its sample file and extracts the screens, tables and calls the sample contains."""

    def check(self, rel, pack, screens=(), tables=(), depends=()):
        text = load(rel)
        found = languages.identify(rel, text)
        self.assertIsNotNone(found, rel)
        self.assertEqual(found.name, pack, rel)
        result = languages.extract(found, rel, text)
        for s in screens:
            self.assertIn(s, result.screens, rel)
        for t in tables:
            self.assertIn(t, result.tables, rel)
        for d in depends:
            self.assertIn(d, result.depends, rel)

    def test_visual_basic_6(self):
        self.check("vb6/frmLogin.frm", "Visual Basic 6", screens=["frmLogin"], tables=["Users"], depends=["kernel32"])

    def test_cobol(self):
        self.check("cobol/PAYROLL01.cbl", "COBOL", screens=["MENU01"], tables=["EMPLOYEE"], depends=["TAXCALC"])

    def test_delphi_form_and_source(self):
        self.check("delphi/UMain.dfm", "Delphi or Pascal", screens=["frmMain"])
        self.check("delphi/UMain.pas", "Delphi or Pascal", tables=["Orders"], depends=["SysUtils"])

    def test_plsql(self):
        self.check("plsql/billing_pkg.pkb", "PL/SQL", tables=["INVOICES", "LEDGER"], depends=["audit_log"])

    def test_plsql_variables_are_not_tables(self):
        text = load("plsql/billing_pkg.pkb")
        self.assertNotIn("v_total", languages.extract(languages.identify("x.pkb", text), "x.pkb", text).tables)

    def test_tsql_and_its_schema_prefixes(self):
        self.check("tsql/patients.sql", "T-SQL (SQL Server scripts)", tables=["Patients", "Visits"])

    def test_plain_sql_is_left_to_the_database_reader(self):
        self.assertIsNone(languages.identify("sql/plain.sql", load("sql/plain.sql")))

    def test_perl_cgi(self):
        self.check("perl/report.cgi", "Perl", screens=["report"], tables=["visits"], depends=["DBI"])

    def test_php(self):
        self.check("php/search.php", "PHP (older)", screens=["search"], tables=["members"], depends=["config.php"])

    def test_powerbuilder(self):
        self.check("powerbuilder/w_orders.srw", "PowerBuilder", screens=["w_orders"], tables=["orders"])

    def test_natural(self):
        self.check("natural/PROG1.NSP", "Natural", tables=["EMPLOYEES"], depends=["SUBR1"])

    def test_progress(self):
        self.check("progress/order.w", "Progress 4GL", screens=["order"], tables=["customer", "orders"], depends=["calc.p"])

    def test_rpg(self):
        self.check("rpg/CUSTINQ.sqlrpgle", "RPG", tables=["CUSTMAST"], depends=["PRINTIT"])

    def test_foxpro(self):
        self.check("foxpro/menu.prg", "FoxPro or Visual FoxPro", tables=["customers", "orders"], depends=["report.prg"])

    def test_classic_asp_still_reports_its_screens(self):
        self.check("asp/manageit.asp", "Classic ASP", screens=["Closed", "My Account"], tables=["Project"])

    def test_include_is_asp_only_with_script_blocks(self):
        self.assertEqual(languages.identify("asp/upload.inc", load("asp/upload.inc")).name, "Classic ASP include")
        self.assertIsNone(languages.identify("asp/style.inc", load("asp/style.inc")))

    def test_every_pack_has_a_fixture_and_a_unique_name(self):
        names = [p.name for p in languages.PACKS]
        self.assertEqual(len(names), len(set(names)))
        self.assertTrue(set(languages.ALL_EXTS) >= {".frm", ".cbl", ".pas", ".nsp", ".w", ".sqlrpgle", ".prg"})


class InventoryTests(unittest.TestCase):
    def test_every_file_gets_a_record_and_no_value_is_copied(self):
        root = FIX
        paths = sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())
        files = {p: load(p) for p in paths if p.endswith(tuple(languages.ALL_EXTS) + (".inc", ".sql"))}
        records, summary = inventory.build(root, paths, files, {}, NOW)
        self.assertEqual(len(records), len(paths))
        self.assertEqual(summary["files"], len(paths))
        flat = str(records)
        self.assertNotIn("Abdul", flat)
        self.assertNotIn("SELECT * FROM Users", flat)

    def test_unidentified_files_are_named_not_guessed(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "mystery.q9").write_bytes(b"\x00\x01\x02\x03" * 16)
            records, summary = inventory.build(Path(tmp), ["mystery.q9"], {}, {}, NOW)
        self.assertEqual(records[0]["identified_by"], "none")
        self.assertEqual(summary["unidentified"], 1)
        self.assertEqual(summary["unidentified_paths"], ["mystery.q9"])


if __name__ == "__main__":
    unittest.main()


class JavaDotNetPackTests(unittest.TestCase):
    """Java and Spring Boot, JSP, C# and ASP.NET: each sample is identified and its screens, tables and dependencies are found."""

    def check(self, rel, pack, screens=(), tables=(), depends=()):
        text = load(rel)
        found = languages.identify(rel, text)
        self.assertIsNotNone(found, rel)
        self.assertEqual(found.name, pack, rel)
        result = languages.extract(found, rel, text)
        for s in screens:
            self.assertIn(s, result.screens, rel)
        for t in tables:
            self.assertIn(t, result.tables, rel)
        for d in depends:
            self.assertIn(d, result.depends, rel)
        return result

    def test_spring_controller_pages_and_jpa_tables(self):
        result = self.check("java/OrderController.java", "Java and Spring Boot",
                            tables=["customer_orders"],
                            depends=["org.springframework.stereotype.Controller", "com.example.orders.OrderService"])
        self.assertEqual(result.screens, set(), "controller routes are endpoints; their view files are the screens")
        self.assertNotIn("java.util.List", result.depends, "standard library imports are not dependencies")

    def test_jpa_entity_uses_its_table_name(self):
        self.check("java/Customer.java", "Java and Spring Boot", tables=["CUSTOMER_MASTER"])

    def test_jsp_page_is_a_screen_with_its_sql_and_includes(self):
        self.check("jsp/orders.jsp", "JSP", screens=["orders"], tables=["order_header"],
                   depends=["/WEB-INF/jspf/header.jspf", "footer.jsp"])

    def test_csharp_controller_views_entity_framework_and_usings(self):
        result = self.check("dotnet/OrdersController.cs", "C# and ASP.NET",
                            tables=["OrderHeader", "tblCustomer"], depends=["Microsoft.AspNetCore.Mvc"])
        self.assertEqual(result.screens, set(), "actions are endpoints; their Razor view files are the screens")

    def test_razor_view_is_a_screen(self):
        self.check("dotnet/Orders.cshtml", "ASP.NET Razor and Web Forms", screens=["Orders"])

    def test_plain_java_is_analysed_without_spring_screens(self):
        result = self.check("java/Customer.java", "Java and Spring Boot")
        self.assertEqual(result.screens, set(), "a class with no @Controller has no pages")
