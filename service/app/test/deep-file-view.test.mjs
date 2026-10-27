// The Deep view on a file: a platform engineer runs it, and approves or discards the draft. Text only, never markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const panel = html.slice(html.indexOf("  function deepPanel(li, f) {"), html.indexOf("  function businessPanel(li, f) {"));

test("the Deep view button sits beside the Business view button on a file", () => {
  assert.match(html, /button\("Business view", \(\) => businessPanel\(li, f\)\);\s*button\("Deep view", \(\) => deepPanel\(li, f\)\);/);
});

test("the panel reads the list, starts a run, and approves or discards by assessment id", () => {
  assert.match(panel, /api\(`\/api\/analyses\/\$\{cur\.id\}\/deep-files\?path=\$\{encodeURIComponent\(f\.path\)\}`\)/);
  assert.match(panel, /api\(`\/api\/analyses\/\$\{cur\.id\}\/deep-files\/start`, \{ method: "POST", body: JSON\.stringify\(\{ path: f\.path \}\) \}\)/);
  assert.match(html, /deep-files\/approve`, \{ method: "POST", body: JSON\.stringify\(\{ assessment_id: a\.id \}\) \}/);
  assert.match(html, /deep-files\/discard`, \{ method: "POST", body: JSON\.stringify\(\{ assessment_id: a\.id \}\) \}/);
});

test("only drafts show approve and discard", () => {
  assert.match(html, /if \(a\.status === "draft"\) \{\s*const row = el\("div", null, "row"\);/);
});

test("the account is written as plain text, never as markup", () => {
  assert.doesNotMatch(panel, /innerHTML\s*=\s*`/);
  assert.doesNotMatch(panel, /insertAdjacentHTML/);
});

test("the change is listed in What's new, with the lower-confidence note", () => {
  assert.match(guide, /Deep view, on a file in the business assessment list/);
  assert.match(html, /Read by the model, so its confidence is lower than a rule-based result/);
});
