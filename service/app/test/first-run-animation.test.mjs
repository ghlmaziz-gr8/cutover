// The first-run card and the live card for a business run, and the Business view button on the Deeper file tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const slice = (from, to) => html.slice(html.indexOf(from), html.indexOf(to));
const intro = slice("  function firstRunCard(title, text, note) {", "  // Business runs take about");
const biz = slice("  function businessPanel(li, f, onClose", "  function bizCard(a, reload, msg) {");
const tree = slice("  function showBusinessFile(path) {", "  // Next steps opens only");

test("a first-run card shows the orb and the code scan, with no clock", () => {
  assert.ok(intro.includes('"dw-card dw-intro"'));
  for (const cls of ["dw-orb", "dw-scan", "dw-sweep", "dw-line"]) assert.ok(intro.includes(cls), cls);
  assert.ok(!intro.includes("dw-clock"));
});

test("an empty deep panel and an empty business panel show the first-run card", () => {
  assert.ok(html.includes("No deep assessment has run for this file"));
  assert.ok(biz.includes("No business assessment has run for this file"));
  assert.ok(biz.includes("firstRunCard("));
});

test("a running business assessment shows the live card with an estimate, and is checked again", () => {
  assert.ok(biz.includes('a.review_status === "running"'));
  assert.ok(biz.includes("deepWait({ ...a, status: \"running\", file_path: f.path }, { fallbackSeconds: BIZ_FALLBACK_SECONDS })"));
  assert.ok(biz.includes("setTimeout(load, 4000)"));
  assert.ok(html.includes("const BIZ_FALLBACK_SECONDS = 120;"));
});

test("the Deeper file tree opens the business view and the deep view", () => {
  assert.ok(tree.includes('"Business view"'));
  assert.ok(tree.includes("businessPanel(bizSlot, f, () => bizSlot.replaceChildren())"));
  assert.ok(tree.includes("deepPanel(box, f, () => panel.remove(), actions)"));
});

test("the business view shows the model for this analysis, from the same picker as the deep view", () => {
  assert.ok(biz.includes("analysisModelRow(msg)"));
  assert.ok(biz.includes("loadModels();"));
  assert.ok(slice("  function analysisModelRow(msg) {", "  function deepPanel(li, f, onClose").includes('"Model for this analysis"'));
});
