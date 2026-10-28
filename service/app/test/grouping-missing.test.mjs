// A feature that names an approved file with no approved business view says which file, and the draft marks it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the feature step names the approved files with no approved business view, and says what to do", () => {
  assert.match(html, /groupNoView = new Set\(s\.without_view \|\| \[\]\);/);
  assert.match(html, /No approved business view yet: \$\{s\.without_view\.join\(", "\)\}\. Approve or skip each one/);
});

test("each file chip carries its path, and a file with no approved view is marked red", () => {
  assert.match(html, /chip\.dataset\.path = path;/);
  assert.match(html, /function markMissingFiles\(\) \{/);
  assert.match(html, /chip\.classList\.toggle\("is-missing", missing\);/);
  assert.match(html, /\.gr-file\.is-missing\{background:#fee2e2;color:#991b1b;border-color:#fca5a5\}/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /names each approved file that has no approved business view/);
});
