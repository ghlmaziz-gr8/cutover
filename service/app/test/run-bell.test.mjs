// The notification bell is hidden only on the progress screen while an analysis runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the bell is hidden by a body class", () => {
  assert.match(html, /\.no-bell \.bell\{display:none\}/);
});

test("the class is set by one function that show() calls", () => {
  assert.match(html, /document\.body\.classList\.toggle\("no-bell", hide\);/);
  assert.match(html, /renderHeader\(id\);\s*updateBellVisibility\(\);/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The notification bell is hidden on the progress screen/);
});
