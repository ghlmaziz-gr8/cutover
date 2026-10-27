// The database structure and the run button sit under the deep data assessment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the database and run cards sit in a box after the three cards, before the data section", () => {
  const box = html.indexOf('<div id="deeperDataBox" hidden>');
  assert.notEqual(box, -1);
  assert.ok(html.indexOf('id="lensCard"') < box, "after the three cards");
  assert.ok(box < html.indexOf('id="dbCard"'), "database card inside the box");
  assert.ok(html.indexOf('id="dbCard"') < html.indexOf('id="deeperRunCard"'), "run card after the database card");
  assert.ok(html.indexOf('id="deeperRunCard"') < html.indexOf('id="deeperArch"'), "run card before the architecture");
});

test("the box shows for the data view, before any report, and when showing everything", () => {
  assert.match(html, /\$\("deeperDataBox"\)\.hidden = ready && !!active && active\.key !== "data";/);
});

test("the run card uses the new wording", () => {
  assert.match(html, /<h2>Run deep data assessment<\/h2>/);
  assert.match(html, /<button type="button" id="deeperRun">Run deep data assessment<\/button>/);
  assert.doesNotMatch(html, /Run the deeper assessment<\/h2>|>Run deeper assessment<\/button>/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The database structure upload and the run button now sit under the three deeper assessments/);
});
