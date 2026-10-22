"""Tests for the personal-data scanner. Run from the engine folder: python3 -m unittest test_privacy_scan"""
import unittest

import privacy_scan as ps


class ScanTests(unittest.TestCase):
    def test_finds_each_kind(self):
        self.assertEqual(ps.scan("contact jane.doe@example.org"), ["email address"])
        self.assertEqual(ps.scan("call 555-867-5309 today"), ["phone number"])
        self.assertEqual(ps.scan("ssn 123-45-6789"), ["national ID number"])
        self.assertEqual(ps.scan("MRN: AB12345"), ["record number"])
        self.assertEqual(ps.scan("card 4111 1111 1111 1111"), ["card number"])

    def test_plain_structure_is_clean(self):
        self.assertTrue(ps.is_clean("CREATE TABLE visits (id INT, visited_on DATE);"))
        self.assertTrue(ps.is_clean("<h1>Work list</h1> <a href='/visits.asp'>Open</a>"))

    def test_a_number_that_is_not_a_card_is_not_flagged(self):
        self.assertEqual(ps.scan("order 1234 5678 9012 3456"), [])

    def test_result_never_holds_the_value(self):
        text = "jane.doe@example.org and 123-45-6789"
        for kind in ps.scan(text):
            self.assertNotIn("jane", kind)
            self.assertNotIn("123-45", kind)


if __name__ == "__main__":
    unittest.main()
