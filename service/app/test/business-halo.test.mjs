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
  assert.ok(biz.includes("appendHalo(c, content, content.dropped)"));
  const helper = html.slice(html.indexOf("function appendHalo(c, content, dropped)"), html.indexOf("function appendRules(c, content)"));
  assert.ok(helper.includes("Confidence.confidenceOf(content, dropped)"));
  assert.ok(helper.includes("deepHalo(conf.score, conf.band)"));
  for (const line of ["Names checked against the code:", "Rules with line numbers:", "Rules with a worked example:"]) {
    assert.ok(helper.includes(line), line);
  }
});

test("each business rule shows its location and its worked examples", () => {
  assert.ok(biz.includes("appendRules(c, content)"));
  const helper = html.slice(html.indexOf("function appendRules(c, content)"), html.indexOf("function deepCard("));
  assert.ok(helper.includes("Given ${ex.given} → expect ${ex.expect}"));
  assert.ok(helper.includes("lines ${rule.lines[0]}–${rule.lines[1]}"));
  assert.ok(helper.includes("When: ${rule.condition}"));
  assert.ok(helper.includes("Then: ${rule.outcome}"));
  assert.ok(helper.includes("Values: ${rule.values.join"));
});

test("an older draft without rules shows no halo", () => {
  const helper = html.slice(html.indexOf("function appendHalo(c, content, dropped)"), html.indexOf("function appendRules(c, content)"));
  assert.ok(helper.includes("if (!(content.file_purpose || content.functions || content.rules)) return;"));
});
