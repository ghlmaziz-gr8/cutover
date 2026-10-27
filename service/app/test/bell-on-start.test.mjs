// The bell is hidden during an assessment: while starting or opening one, and on every screen except home while it runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const rule = html.slice(html.indexOf("  let startingRun = false;"), html.indexOf("  function show(id) {"));
const handler = html.slice(html.indexOf('$("startNow").addEventListener("click"'), html.indexOf('$("startNow").addEventListener("click"') + 1200);
const opener = html.slice(html.indexOf("  async function openAnalysis(id) {"), html.indexOf("  async function openAnalysis(id) {") + 700);

test("the bell rule hides it while starting, and on any screen except home while the analysis runs", () => {
  assert.match(rule, /const onHome = !\$\("s-home"\)\.hidden;/);
  assert.match(rule, /const hide = startingRun \|\| \(running && !onHome\);/);
  assert.match(rule, /document\.body\.classList\.toggle\("no-bell", hide\);/);
});

test("the bell is hidden as soon as Start is pressed, and returns if starting fails", () => {
  assert.match(handler, /startingRun = true;\s*updateBellVisibility\(\);/);
  assert.match(html, /catch \(err\) \{\s*startingRun = false;\s*updateBellVisibility\(\);\s*setMsg\("rulesMsg"/);
});

test("the bell is hidden while an analysis opens from the list", () => {
  assert.match(opener, /startingRun = true;\s*updateBellVisibility\(\);/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The bell is hidden from the moment an analysis is started/);
});
