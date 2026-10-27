// The operator overview shows the database size against the free-tier limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the All workspaces card has a line for the database size", () => {
  const card = html.slice(html.indexOf('id="overviewCard"'), html.indexOf('id="privacyCard"'));
  assert.match(card, /id="databaseSize"/);
});

test("the database size is read from the operator endpoint and shows used, limit and percent", () => {
  assert.match(html, /async function loadDatabaseSize\(\)/);
  assert.match(html, /api\("\/api\/admin\/database"\)/);
  assert.match(html, /free-tier limit \(\$\{d\.percent\}%\)/);
  assert.match(html, /Could not read the database size\./);
});

test("loading the overview also loads the database size", () => {
  const start = html.indexOf("async function loadOverview()");
  assert.ok(start > 0);
  assert.match(html.slice(start, start + 200), /loadDatabaseSize\(\);/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /2026-10-27: Operators see the database size against the free-tier limit/);
});
