// A failed deep file assessment says why it ended, and can be run again. Text only, never markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const card = html.slice(html.indexOf("  function deepCard(a, reload, msg) {"), html.indexOf("    const content = a.content || {};", html.indexOf("  function deepCard(a, reload, msg) {")));

test("a failed run is labelled Failed", () => {
  assert.ok(html.includes('failed: "Failed"'));
});

test("the card shows the reason the run ended and says it can be run again", () => {
  assert.ok(card.includes('if (a.status === "failed") {'));
  assert.ok(card.includes("a.content.failure.reason"));
  assert.ok(card.includes("Press Run deep assessment to try again."));
});

test("the runner prints the reason and maps a payment problem to a clear message", () => {
  const runner = readFileSync(join(here, "..", "..", "..", "engine", "deep_file_run.py"), "utf8");
  const purposes = readFileSync(join(here, "..", "..", "..", "engine", "model_purposes.py"), "utf8");
  assert.ok(purposes.includes("def explain_failure(err: Exception) -> str:"));
  assert.ok(purposes.includes("The model provider asked for payment (HTTP 402)"));
  assert.ok(runner.includes("reason = f\" {result['reason']}\""));
});
