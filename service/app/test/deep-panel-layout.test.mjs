// The deep panel layout: the buttons beside the file name, the model above the results, a database section,
// and a plain explanation of Approve.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the deep assessment buttons sit beside the file name", () => {
  assert.match(html, /const titleRow = el\("div", null, "dp-title-row"\);/);
  assert.match(html, /deepPanel\(box, f, \(\) => panel\.remove\(\), actions\)/);
  assert.match(html, /if \(actionSlot\) actionSlot\.append\(top\);/);
});

test("the model dropdown sits directly above the results", () => {
  assert.match(html, /panel\.append\(modelRow, msg, list\);/);
});

test("the card has a database section for tables and queries", () => {
  assert.match(html, /const db = content\.database \|\| \{\};/);
  assert.match(html, /c\.append\(el\("div", "Database", "small"\)\);/);
});

test("Approve explains what it does", () => {
  assert.match(html, /Approving makes this the account for the file/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The deep assessment now lists the database tables and queries in each file/);
});
