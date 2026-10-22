"""Tests for the links and domains detector. Run with:  python3 -m unittest engine/test_links.py"""
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cutover_discover as cd  # noqa: E402


class FakeRepo:
    def __init__(self, files):
        self.files = files


def run(files):
    out = {}
    cd.detect_links(FakeRepo(files), out)
    return out


class LinksTests(unittest.TestCase):
    def test_lists_public_domains_once_per_host_with_file_counts(self):
        out = run({"a.js": 'fetch("https://api.stripe.com/v1/charges")', "b.py": 'URL = "https://api.stripe.com/v2"'})
        self.assertEqual(out["links.domains"]["value"], ["api.stripe.com (2 files)"])

    def test_query_strings_and_fragments_are_never_kept(self):
        out = run({"a.js": 'u = "https://api.acme.io/v2/items?token=abc#x"'})
        self.assertEqual(out["links.urls"]["value"], ["https://api.acme.io/v2/items (1 file)"])
        self.assertNotIn("abc", str(out))

    def test_placeholders_local_addresses_schemas_and_ip_addresses_are_skipped(self):
        out = run({"a.xml": 'ns="http://www.w3.org/2000/svg" dev="http://localhost:8080/x" ex="https://example.com/a" ip="http://10.0.0.5/status"'})
        self.assertNotIn("links.domains", out)
        self.assertNotIn("links.urls", out)

    def test_plain_http_to_an_outside_host_is_a_medium_flag(self):
        out = run({"a.config": 'ws = "http://legacy.acme-corp.net/ws/Orders.asmx"'})
        self.assertEqual(out["links.insecure"]["value"], 1)
        self.assertEqual(out["links.insecure"]["severity"], "medium")
        self.assertEqual(out["links.insecure"]["category"], "links")

    def test_an_address_with_a_password_is_a_high_flag_and_is_never_listed(self):
        out = run({"a.cfg": "url=https://svc:hunter2@private-host.acme.io/x"})
        self.assertEqual(out["links.credentials"]["severity"], "high")
        self.assertNotIn("hunter2", str(out))
        self.assertNotIn("links.domains", out)

    def test_reverse_dns_package_names_are_not_domains(self):
        out = run({"a.java": 'import "com.acme.app"; pkg = "org.apache.commons"'})
        self.assertNotIn("links.domains", out)

    def test_nothing_is_written_when_the_code_has_no_links(self):
        self.assertEqual(run({"a.py": "x = 1"}), {})


if __name__ == "__main__":
    unittest.main()
