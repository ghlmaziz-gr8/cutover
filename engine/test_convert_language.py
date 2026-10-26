"""The chosen language reaches the model, and a reply that describes the file is not kept as code."""
import unittest

from model_convert import build_user_text, convert_file, looks_like_code


class ConvertLanguageTests(unittest.TestCase):
    def test_the_language_is_in_the_request(self):
        text = build_user_text("src/a.asp", "x = 1", "web-modern", "Python with FastAPI")
        self.assertIn("Target language: Python with FastAPI.", text)

    def test_the_language_is_sent_to_the_model(self):
        sent = []

        def ask(text):
            sent.append(text)
            return "from fastapi import FastAPI\napp = FastAPI()"

        result = convert_file("src/a.asp", "x = 1", "web-modern", ask, language="Python with FastAPI")
        self.assertEqual(result["status"], "ok")
        self.assertIn("Target language: Python with FastAPI.", sent[0])

    def test_no_language_means_nothing_is_sent(self):
        sent = []
        result = convert_file("src/a.asp", "x = 1", "web-modern", lambda t: sent.append(t) or "x", language="")
        self.assertEqual(result["status"], "refused")
        self.assertEqual(sent, [])

    def test_a_description_is_not_kept_as_code(self):
        reply = "This client-side script fetches and displays dynamic search suggestions as the user types in the box"
        result = convert_file("AJAX/hint.js", "var x = 1;", "web-modern", lambda t: reply, language="Python with FastAPI")
        self.assertEqual(result["status"], "unusable")
        self.assertIn("a description, not code", result["reason"])
        self.assertNotIn("proposed", result)

    def test_code_is_kept(self):
        code = "def hint(q):\n    return suggest(q)\n"
        self.assertTrue(looks_like_code(code))
        result = convert_file("AJAX/hint.js", "var x = 1;", "web-modern", lambda t: code, language="Python with FastAPI")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["proposed"], code.strip())


if __name__ == "__main__":
    unittest.main()
