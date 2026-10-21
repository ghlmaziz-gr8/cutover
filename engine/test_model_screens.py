"""Tests for drawing screens with the model. Run from the engine folder: python3 -m unittest test_model_screens"""
import io
import json
import os
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import model_purposes as mp
import model_screens as ms

ID = "11111111-2222-4333-8444-555555555555"
KEY = "AIza-secret-test-key-0123456789"
TOKEN = "t0ken-that-is-long-enough-123456"
PAGE = "<!doctype html><html><body><h1>Appointments</h1><p>Sample visit: 10:30, Room 4</p></body></html>"


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def records(*specs):
    return [{"path": p, "category": c, "purpose": "Rule-based purpose.", "suggestions": [], "sample_only": True} for p, c in specs]


class RefusalTests(unittest.TestCase):
    def test_a_plain_page_is_allowed(self):
        self.assertIsNone(ms.screen_problem(PAGE))

    def test_code_links_forms_and_frames_are_refused(self):
        for html in (
            "<!doctype html><html><body><script>alert(1)</script></body></html>",
            "<!doctype html><html><body><p onclick=\"x()\">Visit</p></body></html>",
            "<!doctype html><html><body><img src=\"https://example.test/a.png\"></body></html>",
            "<!doctype html><html><body><iframe src=\"x.html\"></iframe></body></html>",
            "<!doctype html><html><body><form action=\"/send\"></form></body></html>",
            "<!doctype html><html><body><a href=\"javascript:alert(1)\">Visit</a></body></html>",
            "<!doctype html><html><head><style>@import url(x.css);</style></head><body>Visit</body></html>",
        ):
            with self.subTest(html=html[:60]):
                self.assertIsNotNone(ms.screen_problem(html))

    def test_a_fragment_or_a_too_short_or_too_long_drawing_is_refused(self):
        self.assertIsNotNone(ms.screen_problem("<div>A fragment without a page around it, long enough to pass.</div>"))
        self.assertIsNotNone(ms.screen_problem("<html></html>"))
        self.assertIsNotNone(ms.screen_problem("<html><body>" + "x" * 40_000 + "</body></html>"))


class TidyTests(unittest.TestCase):
    def test_page_metadata_and_form_wrappers_are_removed_not_refused(self):
        html = ('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="x.css"><base href="/">'
                '</head><body><form method="post"><label>Visit</label><input value="10:30"></form>'
                '<p>Sample visit at 10:30, Room 4.</p></body></html>')
        page, problem = ms.inspect_reply(html)
        self.assertIsNone(problem)
        self.assertNotIn("<meta", page)
        self.assertNotIn("<form", page)
        self.assertNotIn("</form", page)
        self.assertIn("<input value=\"10:30\">", page)

    def test_scripts_and_outside_links_are_still_refused(self):
        for body in ('<script>x()</script>', '<img src="https://example.test/a.png">', '<p onclick="x()">Visit at 10:30</p>'):
            with self.subTest(body=body):
                page, problem = ms.inspect_reply(f'<!doctype html><html><body><p>Sample visit at 10:30.</p>{body}</body></html>')
                self.assertIsNone(page)
                self.assertIsNotNone(problem)


class CleanReplyTests(unittest.TestCase):
    def test_a_fenced_reply_is_unwrapped(self):
        self.assertEqual(ms.clean_reply("```html\n" + PAGE + "\n```"), PAGE)

    def test_chatter_before_the_page_is_dropped(self):
        self.assertEqual(ms.clean_reply("Here is the screen:\n" + PAGE), PAGE)

    def test_a_reply_without_a_page_is_not_used(self):
        self.assertIsNone(ms.clean_reply("Sorry, I cannot draw that."))
        self.assertIsNone(ms.clean_reply("```html\n<script>alert(1)</script>\n```"))


class ChoiceTests(unittest.TestCase):
    def test_only_template_files_are_drawn_and_the_count_is_capped(self):
        recs = records(("src/A.java", "source"), ("ui/x.html", "template"), ("ui/y.html", "template"))
        self.assertEqual([r["path"] for r in ms.choose_screen_files(recs)], ["ui/x.html", "ui/y.html"])
        many = records(*[(f"ui/p{i}.html", "template") for i in range(20)])
        self.assertEqual(len(ms.choose_screen_files(many)), ms.SCREEN_MAX)

    def test_names_come_from_the_file_name(self):
        self.assertEqual(ms.screen_name("ui/appointment-checkin.html"), "Appointment checkin")
        self.assertEqual(ms.screen_name("results.html"), "Results")


class DrawTests(unittest.TestCase):
    def test_drawings_are_kept_and_refused_ones_counted(self):
        recs = records(("ui/a.html", "template"), ("ui/b.html", "template"), ("ui/c.html", "template"))
        sources = {"ui/a.html": "<h1>A</h1>", "ui/b.html": "<h1>B</h1>", "ui/c.html": "<h1>C</h1>"}
        replies = {"ui/a.html": PAGE, "ui/b.html": "I cannot draw this.", "ui/c.html": PAGE}
        screens, stats = ms.draw_screens(recs, sources.get, lambda rec, code: replies[rec["path"]])
        self.assertEqual([s["path"] for s in screens], ["ui/a.html", "ui/c.html"])
        self.assertEqual(screens[0]["name"], "A")
        self.assertEqual(stats, {"drawn": 2, "refused": 1, "stopped": None})

    def test_each_refused_screen_says_why(self):
        recs = records(("ui/a.html", "template"), ("ui/b.html", "template"), ("ui/c.html", "template"))
        sources = {"ui/a.html": "<h1>A</h1>", "ui/b.html": "<h1>B</h1>", "ui/c.html": "<h1>C</h1>"}
        replies = {"ui/a.html": "Sorry, no page.", "ui/b.html": "<!doctype html><html><body><h1>Visits</h1><p>Sample visit at 10:30, Room 4.</p><script>x()</script></body></html>", "ui/c.html": PAGE}

        def ask(rec, code):
            if rec["path"] == "ui/c.html":
                raise ms.ScreenError("reply cut off")
            return replies[rec["path"]]
        reasons = []
        screens, stats = ms.draw_screens(recs, sources.get, ask, reasons=reasons)
        self.assertEqual(stats["refused"], 3)
        self.assertEqual(reasons[0], "reply had no HTML page")
        self.assertIn("scripts", reasons[1])
        self.assertEqual(reasons[2], "reply cut off")

    def test_a_refusal_from_the_provider_stops_drawing(self):
        recs = records(("ui/a.html", "template"), ("ui/b.html", "template"))

        def ask(rec, code):
            raise ms.StopDrawing(403)
        screens, stats = ms.draw_screens(recs, {"ui/a.html": "x", "ui/b.html": "y"}.get, ask)
        self.assertEqual(screens, [])
        self.assertEqual(stats["stopped"], 403)

    def test_a_failed_request_skips_only_that_screen(self):
        recs = records(("ui/a.html", "template"), ("ui/b.html", "template"))

        def ask(rec, code):
            if rec["path"] == "ui/a.html":
                raise ms.ScreenError("request failed")
            return PAGE
        screens, stats = ms.draw_screens(recs, {"ui/a.html": "x", "ui/b.html": "y"}.get, ask)
        self.assertEqual([s["path"] for s in screens], ["ui/b.html"])
        self.assertEqual(stats["refused"], 1)


class PostTests(unittest.TestCase):
    def test_the_drawings_go_to_the_runner_endpoint_with_the_secret_in_a_header(self):
        seen = {}

        def opener(req, timeout):
            seen["url"] = req.full_url
            seen["secret"] = req.get_header("X-runner-secret")
            seen["body"] = json.loads(req.data.decode())
            response = FakeResponse(b"")
            response.status = 201
            return response
        status = ms.post_screens("https://api.test", ID, "s3cret", [{"path": "a.html", "name": "A", "html": PAGE}], opener=opener)
        self.assertEqual(status, 201)
        self.assertEqual(seen["url"], f"https://api.test/api/runner/{ID}/screens")
        self.assertEqual(seen["secret"], "s3cret")
        self.assertEqual(seen["body"]["screens"][0]["name"], "A")


class RunTests(unittest.TestCase):
    def run_main(self, env, opener, recs):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ui").mkdir()
            (root / "ui" / "appointments.html").write_text("<div class=\"visit\">Visit list</div>", encoding="utf-8")
            (root / "Orders.java").write_text("public class Orders { void run() {} }", encoding="utf-8")
            recs_path = root / "files.json"
            recs_path.write_text(json.dumps(recs), encoding="utf-8")
            argv = ["--records", str(recs_path), "--source", str(root), "--callback", "https://api.test", "--analysis-id", ID]
            with mock.patch.dict(os.environ, env, clear=True), redirect_stdout(out):
                code = mp.main(argv, opener=opener)
            return code, out.getvalue()

    def test_the_run_draws_and_saves_screens_without_printing_the_key(self):
        posted = []

        def opener(req, timeout):
            url = req.full_url
            if "/model-key" in url:
                return FakeResponse(json.dumps({"provider": "google", "model": "gemini-3.5-flash", "api_key": KEY}).encode())
            if "/screens" in url:
                posted.append(json.loads(req.data.decode()))
                response = FakeResponse(b'{"saved": 1}')
                response.status = 201
                return response
            body = json.loads(req.data.decode())
            if "draw one screen" in body["systemInstruction"]["parts"][0]["text"]:
                text = "```html\n" + PAGE + "\n```"
            else:
                text = "Lists the orders."
            return FakeResponse(json.dumps({"candidates": [{"content": {"parts": [{"text": text}]}}]}).encode())

        recs = [
            {"path": "Orders.java", "category": "source", "purpose": "Rule-based.", "suggestions": [], "sample_only": True},
            {"path": "ui/appointments.html", "category": "template", "purpose": "Rule-based.", "suggestions": [], "sample_only": True},
        ]
        code, out = self.run_main({"MODEL_TOKEN": TOKEN, "RUNNER_SECRET": "s"}, opener, recs)
        self.assertEqual(code, 0)
        self.assertIn("1 screens drawn from the code and saved", out)
        self.assertEqual(posted[0]["screens"][0]["path"], "ui/appointments.html")
        self.assertEqual(posted[0]["screens"][0]["name"], "Appointments")
        self.assertNotIn(KEY, out)
        self.assertNotIn(KEY, json.dumps(posted))


if __name__ == "__main__":
    unittest.main()
