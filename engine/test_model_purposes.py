"""Tests for the model purpose step. Run from the engine folder: python3 -m unittest test_model_purposes"""
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

ID = "11111111-2222-4333-8444-555555555555"
KEY = "AIza-secret-test-key-0123456789"
TOKEN = "t0ken-that-is-long-enough-123456"


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def http_error(code):
    return urllib.error.HTTPError("https://example.test", code, "x", {}, None)


def records(*specs):
    return [{"path": p, "category": c, "purpose": "Rule-based purpose.", "suggestions": [], "sample_only": True} for p, c in specs]


class ChooseFilesTests(unittest.TestCase):
    def test_only_code_like_categories_are_eligible(self):
        chosen = mp.choose_files(records(("a.java", "source"), ("b.png", "other"), ("c.sql", "database"), ("d.md", "documentation")))
        self.assertEqual([r["path"] for r in chosen], ["a.java", "c.sql"])

    def test_capped_at_the_limit(self):
        many = records(*[(f"f{i}.java", "source") for i in range(250)])
        self.assertEqual(len(mp.choose_files(many)), mp.MAX_MODEL_FILES)
        self.assertEqual(len(mp.choose_files(many, limit=5)), 5)


class AcceptPurposeTests(unittest.TestCase):
    def test_a_short_plain_reply_is_used(self):
        self.assertEqual(mp.accept_purpose("Handles patient  visits.\n", "x = 1"), "Handles patient visits.")

    def test_empty_long_or_markdown_replies_are_refused(self):
        self.assertIsNone(mp.accept_purpose("   ", "x"))
        self.assertIsNone(mp.accept_purpose("word " * 100, "x"))
        self.assertIsNone(mp.accept_purpose("```java\nclass A {}\n```", "x"))
        self.assertIsNone(mp.accept_purpose("# Heading", "x"))
        self.assertIsNone(mp.accept_purpose("- one\n- two", "x"))

    def test_a_reply_that_copies_a_long_line_of_the_file_is_refused(self):
        code = "    String sql = \"select patient_name, mrn from visits where ward = 'ICU'\";\n"
        reply = "It runs: select patient_name, mrn from visits where ward = 'ICU'"
        self.assertIsNone(mp.accept_purpose(reply, code))

    def test_short_common_lines_do_not_block_a_reply(self):
        self.assertEqual(mp.accept_purpose("Starts the service.", "}\n"), "Starts the service.")


class RequestTests(unittest.TestCase):
    def test_the_key_goes_in_a_header_never_in_the_url(self):
        for provider, model in (("anthropic", "claude-haiku-5-5"), ("google", "gemini-3.5-flash")):
            url, headers, body = mp.build_request(provider, model, KEY, "File path: a.java")
            self.assertNotIn(KEY, url)
            self.assertNotIn(KEY, body.decode())
            self.assertIn(KEY, headers.values())

    def test_each_provider_gets_its_own_shape(self):
        url, headers, body = mp.build_request("anthropic", "claude-haiku-5-5", KEY, "hi")
        self.assertEqual(url, "https://api.anthropic.com/v1/messages")
        self.assertEqual(headers["x-api-key"], KEY)
        self.assertEqual(json.loads(body)["model"], "claude-haiku-5-5")
        url, headers, body = mp.build_request("google", "gemini-3.5-flash", KEY, "hi")
        self.assertEqual(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent")
        self.assertEqual(headers["x-goog-api-key"], KEY)
        self.assertEqual(json.loads(body)["generationConfig"]["maxOutputTokens"], mp.GOOGLE_MIN_OUTPUT_TOKENS)
        url, headers, body = mp.build_request("anthropic", "claude-haiku-5-5", KEY, "hi")
        self.assertEqual(json.loads(body)["max_tokens"], 160)

    def test_replies_are_read_from_each_provider_shape(self):
        self.assertEqual(mp.reply_text("anthropic", {"content": [{"type": "text", "text": "A"}, {"type": "text", "text": "B"}]}), "AB")
        self.assertEqual(mp.reply_text("google", {"candidates": [{"content": {"parts": [{"text": "G"}]}}]}), "G")
        self.assertEqual(mp.reply_text("google", {}), "")


class CallTests(unittest.TestCase):
    def test_refusal_and_rate_limit_stop_model_use(self):
        for code in (401, 403, 429):
            with self.subTest(code=code):
                def opener(req, timeout):
                    raise http_error(code)
                with self.assertRaises(mp.ProviderStopped):
                    mp.call_provider("google", "gemini-3.5-flash", KEY, "hi", opener=opener)

    def test_a_server_error_is_tried_again_before_the_file_fails(self):
        body = json.dumps({"candidates": [{"content": {"parts": [{"text": "Reads orders."}]}}]}).encode()
        calls = []
        def opener(req, timeout):
            calls.append(1)
            if len(calls) < 3:
                raise http_error(503)
            return FakeResponse(body)
        old = mp.RETRY_PAUSES
        mp.RETRY_PAUSES = (0, 0)
        try:
            self.assertEqual(mp.call_provider("google", "gemini-3.5-flash", KEY, "hi", opener=opener), "Reads orders.")
        finally:
            mp.RETRY_PAUSES = old
        self.assertEqual(len(calls), 3)

    def test_a_server_error_that_stays_fails_after_the_tries(self):
        calls = []
        def opener(req, timeout):
            calls.append(1)
            raise http_error(503)
        old = mp.RETRY_PAUSES
        mp.RETRY_PAUSES = (0, 0)
        try:
            with self.assertRaises(mp.ProviderError):
                mp.call_provider("google", "gemini-3.5-flash", KEY, "hi", opener=opener)
        finally:
            mp.RETRY_PAUSES = old
        self.assertEqual(len(calls), 3)

    def test_stopping_errors_are_not_retried(self):
        calls = []
        def opener(req, timeout):
            calls.append(1)
            raise http_error(429)
        with self.assertRaises(mp.ProviderStopped):
            mp.call_provider("google", "gemini-3.5-flash", KEY, "hi", opener=opener)
        self.assertEqual(len(calls), 1)

    def test_other_errors_affect_only_that_file(self):
        def opener(req, timeout):
            raise http_error(500)
        old = mp.RETRY_PAUSES
        mp.RETRY_PAUSES = (0, 0)
        try:
            with self.assertRaises(mp.ProviderError):
                mp.call_provider("google", "gemini-3.5-flash", KEY, "hi", opener=opener)
        finally:
            mp.RETRY_PAUSES = old

    def test_a_good_reply_is_returned(self):
        body = json.dumps({"candidates": [{"content": {"parts": [{"text": "Reads orders."}]}}]}).encode()
        text = mp.call_provider("google", "gemini-3.5-flash", KEY, "hi", opener=lambda req, timeout: FakeResponse(body))
        self.assertEqual(text, "Reads orders.")


class CutOffTests(unittest.TestCase):
    """A reply that stopped at the output limit can end mid-sentence, so it is never used."""

    def test_a_google_reply_cut_off_at_the_limit_is_refused(self):
        body = json.dumps({"candidates": [{"content": {"parts": [{"text": "This HTML file serves"}]}, "finishReason": "MAX_TOKENS"}]}).encode()
        with self.assertRaises(mp.ProviderError) as caught:
            mp.call_provider("google", "gemini-3.5-flash", KEY, "hi", opener=lambda req, timeout: FakeResponse(body))
        self.assertEqual(str(caught.exception), "reply cut off")

    def test_an_anthropic_reply_cut_off_at_the_limit_is_refused(self):
        body = json.dumps({"content": [{"type": "text", "text": "This file"}], "stop_reason": "max_tokens"}).encode()
        with self.assertRaises(mp.ProviderError):
            mp.call_provider("anthropic", "claude-haiku-5-5", KEY, "hi", opener=lambda req, timeout: FakeResponse(body))

    def test_a_finished_reply_is_still_used(self):
        body = json.dumps({"candidates": [{"content": {"parts": [{"text": "Reads orders."}]}, "finishReason": "STOP"}]}).encode()
        text = mp.call_provider("google", "gemini-3.5-flash", KEY, "hi", opener=lambda req, timeout: FakeResponse(body))
        self.assertEqual(text, "Reads orders.")

    def test_a_cut_off_reply_keeps_the_rule_based_purpose_and_says_why(self):
        recs = records(("a.java", "source"))
        reasons = []

        def ask(rec, code):
            raise mp.ProviderError("reply cut off")
        stats = mp.apply_purposes(recs, {"a.java": "x"}.get, ask, reasons=reasons)
        self.assertEqual(recs[0]["purpose"], "Rule-based purpose.")
        self.assertEqual(stats, {"model": 0, "rules": 1, "stopped": None})
        self.assertEqual(reasons, ["reply cut off"])


class ExchangeTests(unittest.TestCase):
    def test_a_released_key_is_returned_once_checked(self):
        body = json.dumps({"provider": "google", "model": "gemini-3.5-flash", "api_key": KEY}).encode()
        got = mp.exchange_token("https://api.test", ID, "s", TOKEN, opener=lambda req, timeout: FakeResponse(body))
        self.assertEqual(got["api_key"], KEY)

    def test_a_refused_exchange_reports_the_status_only(self):
        def opener(req, timeout):
            raise http_error(401)
        with self.assertRaises(mp.ReleaseError) as caught:
            mp.exchange_token("https://api.test", ID, "s", TOKEN, opener=opener)
        self.assertEqual(caught.exception.status, 401)

    def test_an_unexpected_answer_is_refused(self):
        for bad in (b"[]", b'{"provider": "other", "model": "m", "api_key": "' + KEY.encode() + b'"}', b'{"provider": "google"}'):
            with self.subTest(bad=bad):
                with self.assertRaises(mp.ReleaseError):
                    mp.exchange_token("https://api.test", ID, "s", TOKEN, opener=lambda req, timeout: FakeResponse(bad))


class ApplyTests(unittest.TestCase):
    def test_replies_are_used_and_others_keep_the_rule_based_purpose(self):
        recs = records(("a.java", "source"), ("b.java", "source"), ("c.md", "documentation"))
        sources = {"a.java": "class A {}", "b.java": "class B {}"}
        replies = {"a.java": "Holds the account rules.", "b.java": "```java```"}
        stats = mp.apply_purposes(recs, sources.get, lambda rec, code: replies[rec["path"]])
        self.assertEqual(recs[0]["purpose"], "Holds the account rules.")
        self.assertEqual(recs[1]["purpose"], "Rule-based purpose.")
        self.assertEqual(recs[2]["purpose"], "Rule-based purpose.", "documentation is never sent")
        self.assertEqual(stats, {"model": 1, "rules": 1, "stopped": None})
        self.assertEqual(recs[0]["purpose_source"], "model", "a model purpose is marked as the model's")
        self.assertNotEqual(recs[1].get("purpose_source"), "model", "a rules purpose is not marked as the model's")

    def test_a_refusal_stops_the_rest(self):
        recs = records(("a.java", "source"), ("b.java", "source"))
        def ask(rec, code):
            raise mp.ProviderStopped(403)
        stats = mp.apply_purposes(recs, {"a.java": "x", "b.java": "y"}.get, ask)
        self.assertEqual(stats["stopped"], 403)
        self.assertEqual([r["purpose"] for r in recs], ["Rule-based purpose."] * 2)

    def test_a_failed_file_keeps_its_purpose_and_the_rest_continue(self):
        recs = records(("a.java", "source"), ("b.java", "source"))
        def ask(rec, code):
            if rec["path"] == "a.java":
                raise mp.ProviderError("HTTP 500")
            return "Handles claims."
        stats = mp.apply_purposes(recs, {"a.java": "x", "b.java": "y"}.get, ask)
        self.assertEqual(recs[0]["purpose"], "Rule-based purpose.")
        self.assertEqual(recs[1]["purpose"], "Handles claims.")
        self.assertEqual(stats["model"], 1)


class SourceReaderTests(unittest.TestCase):
    def test_reads_files_inside_the_checkout_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "src").mkdir()
            (root / "src" / "A.java").write_text("class A {}", encoding="utf-8")
            (root / "bin.dat").write_bytes(b"\x00\x01")
            read = mp.make_source_reader(root)
            self.assertEqual(read("src/A.java"), "class A {}")
            self.assertIsNone(read("bin.dat"))
            self.assertIsNone(read("../outside.txt"))
            self.assertIsNone(read("missing.java"))


class MainTests(unittest.TestCase):
    def run_main(self, env, opener, extra=(), spec=(("A.java", "source"),)):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for path, _ in spec:
                (root / path).write_text("public class A { void run() {} }", encoding="utf-8")
            recs_path = root / "files.json"
            recs_path.write_text(json.dumps(records(*spec)), encoding="utf-8")
            argv = ["--records", str(recs_path), "--source", str(root), "--callback", "https://api.test", "--analysis-id", ID, *extra]
            with mock.patch.dict(os.environ, env, clear=True), redirect_stdout(out):
                code = mp.main(argv, opener=opener)
            return code, out.getvalue(), json.loads(recs_path.read_text(encoding="utf-8"))

    def test_without_a_token_nothing_is_sent(self):
        calls = []
        code, out, recs = self.run_main({}, lambda req, timeout: calls.append(req) or FakeResponse(b"{}"))
        self.assertEqual(code, 0)
        self.assertEqual(calls, [])
        self.assertEqual(recs[0]["purpose"], "Rule-based purpose.")

    def test_the_key_is_used_but_never_printed_or_saved_to_the_records(self):
        def opener(req, timeout):
            if "/model-key" in req.full_url:
                return FakeResponse(json.dumps({"provider": "google", "model": "gemini-3.5-flash", "api_key": KEY}).encode())
            return FakeResponse(json.dumps({"candidates": [{"content": {"parts": [{"text": "Runs the main program."}]}}]}).encode())
        code, out, recs = self.run_main({"MODEL_TOKEN": TOKEN, "RUNNER_SECRET": "s"}, opener)
        self.assertEqual(code, 0)
        self.assertEqual(recs[0]["purpose"], "Runs the main program.")
        self.assertIn("1 file purposes written by the model", out)
        self.assertNotIn(KEY, out)
        self.assertNotIn(TOKEN, out)
        self.assertNotIn(KEY, json.dumps(recs))

    def test_a_refused_release_does_not_fail_the_run(self):
        def opener(req, timeout):
            raise http_error(401)
        code, out, recs = self.run_main({"MODEL_TOKEN": TOKEN, "RUNNER_SECRET": "s"}, opener)
        self.assertEqual(code, 0)
        self.assertIn("could not be released (HTTP 401)", out)
        self.assertEqual(recs[0]["purpose"], "Rule-based purpose.")

    def test_screens_only_draws_the_screens_and_leaves_the_purposes_alone(self):
        html = "<!doctype html><html><body>" + "<div>Orders</div>" * 60 + "</body></html>"
        provider_calls = []

        class Created(FakeResponse):
            status = 201

        def opener(req, timeout):
            if "/model-key" in req.full_url:
                return FakeResponse(json.dumps({"provider": "google", "model": "gemini-3.5-flash", "api_key": KEY}).encode())
            if req.full_url.endswith("/screens"):
                return Created(b"{}")
            provider_calls.append(req.full_url)
            return FakeResponse(json.dumps({"candidates": [{"content": {"parts": [{"text": html}]}}]}).encode())

        code, out, recs = self.run_main({"MODEL_TOKEN": TOKEN, "RUNNER_SECRET": "s", "DRAW_SCREENS": "true"}, opener,
                                        extra=["--screens-only"], spec=(("Orders.html", "template"),))
        self.assertEqual(code, 0)
        self.assertEqual(len(provider_calls), 1, "only the screen is drawn; no file purposes are asked for")
        self.assertIn("1 screens drawn from the code and saved", out)
        self.assertEqual(recs[0]["purpose"], "Rule-based purpose.")
        self.assertNotIn(KEY, out)

    def test_screens_only_with_screens_off_draws_nothing(self):
        calls = []

        def opener(req, timeout):
            calls.append(req.full_url)
            return FakeResponse(json.dumps({"provider": "google", "model": "gemini-3.5-flash", "api_key": KEY}).encode())

        code, out, recs = self.run_main({"MODEL_TOKEN": TOKEN, "RUNNER_SECRET": "s"}, opener,
                                        extra=["--screens-only"], spec=(("Orders.html", "template"),))
        self.assertEqual(code, 0)
        self.assertIn("Screens are off for this workspace", out)
        self.assertFalse(any("generativelanguage" in u or "/screens" in u for u in calls))

    def test_the_secret_is_required_when_a_token_is_given(self):
        code, out, recs = self.run_main({"MODEL_TOKEN": TOKEN}, lambda req, timeout: FakeResponse(b"{}"))
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()


class ChatCompletionsTests(unittest.TestCase):
    """Any provider that speaks the chat-completions shape: its address comes from the Worker, never from the file."""
    BASE = "https://llm.example.com/v1"

    def test_the_request_goes_to_the_chosen_address_with_the_key_in_a_header_only(self):
        url, headers, body = mp.build_request("openai", "team-model-1", KEY, "File path: a.java",
                                              base_url=self.BASE + "/", token_field="max_completion_tokens")
        self.assertEqual(url, self.BASE + "/chat/completions")
        self.assertEqual(headers["authorization"], f"Bearer {KEY}")
        self.assertNotIn(KEY, url)
        payload = json.loads(body)
        self.assertEqual(payload["model"], "team-model-1")
        self.assertIn("max_completion_tokens", payload)
        self.assertNotIn("max_tokens", payload)
        self.assertEqual(payload["messages"][0]["role"], "system")

    def test_an_address_that_is_not_https_is_refused(self):
        for bad in (None, "http://llm.example.com/v1", "https://localhost/v1", "https://10.0.0.5/v1"):
            with self.assertRaises(mp.ProviderError):
                mp.build_request("openai", "m", KEY, "hi", base_url=bad)

    def test_the_reply_and_a_cut_off_reply_are_read(self):
        ok = {"choices": [{"message": {"content": "A"}, "finish_reason": "stop"}]}
        self.assertEqual(mp.reply_text("openai", ok), "A")
        self.assertFalse(mp.reply_cut_off("openai", ok))
        cut = {"choices": [{"message": {"content": "A"}, "finish_reason": "length"}]}
        self.assertTrue(mp.reply_cut_off("openai", cut))
        self.assertEqual(mp.reply_text("openai", {}), "")

    def test_a_released_key_needs_a_secure_address_for_this_shape(self):
        body = json.dumps({"provider": "openai", "model": "team-model-1", "api_key": KEY, "base_url": "http://x.example.com"}).encode()
        with self.assertRaises(mp.ReleaseError):
            mp.exchange_token("https://cutover.example", "a1", "secret", "token",
                              opener=lambda req, timeout: FakeResponse(body))
        good = json.dumps({"provider": "openai", "model": "team-model-1", "api_key": KEY,
                           "base_url": self.BASE, "token_field": "max_completion_tokens"}).encode()
        released = mp.exchange_token("https://cutover.example", "a1", "secret", "token",
                                     opener=lambda req, timeout: FakeResponse(good))
        self.assertEqual(released["base_url"], self.BASE)

    def test_a_model_name_with_a_slash_is_accepted(self):
        self.assertTrue(mp.MODEL_NAME.match("MiniMaxAI/MiniMax-M3"))
        self.assertFalse(mp.MODEL_NAME.match("bad name!"))
