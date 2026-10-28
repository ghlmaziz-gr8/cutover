// The business card has the same halo and checks as the deep card, from its rules and worked examples. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const biz = html.slice(html.indexOf("  function bizCard(a, reload, msg) {"), html.indexOf("  // Replaces one file's purpose"));

test("the business card uses the deep card's halo and checks", () => {
  assert.ok(biz.includes("Confidence.confidenceOf(content, content.dropped)"));
  assert.ok(biz.includes("deepHalo(conf.score, conf.band)"));
  for (const line of ["Names checked against the code:", "Rules with line numbers:", "Rules with a worked example:"]) {
    assert.ok(biz.includes(line), line);
  }
});

test("each business rule shows its location and its worked examples", () => {
  assert.ok(biz.includes("Business rules"));
  assert.ok(biz.includes("Given ${ex.given} → expect ${ex.expect}"));
  assert.ok(biz.includes("lines ${rule.lines[0]}–${rule.lines[1]}"));
});

test("an older draft without rules shows no halo", () => {
  assert.ok(biz.includes("if (Array.isArray(content.rules)) {"));
});
