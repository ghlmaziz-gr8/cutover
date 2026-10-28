// Skipping a failed business view for now, and the count on the feature step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("a failed business view offers Skip for now to an engineer, and calls the skip route", () => {
  assert.match(html, /if \(canActOnResults\(\)\) \{\n\s*\/\/ Skipping keeps the failure on the file/);
  assert.match(html, /el\("button", "Skip for now", "ghost small-btn"\)/);
  assert.match(html, /api\(`\/api\/analyses\/\$\{cur\.id\}\/business\/skip`, \{ method: "POST", body: JSON\.stringify\(\{ path: a\.path \}\) \}\)/);
});

test("a skipped view says so, keeps the reason, and tells the person how to assess it now", () => {
  assert.match(html, /a\.review_status === "skipped"/);
  assert.match(html, /Skipped for now\. The capabilities go on without this file\./);
  assert.match(html, /Press Assess for the business to do it now\./);
  assert.match(html, /skipped: "Skipped for now"/);
});

test("the feature step shows how many approved files have an approved business view, and lists the skipped ones", () => {
  assert.match(html, /<div id="groupSummary" class="fg-summary"/);
  assert.match(html, /async function loadGroupSummary\(\) \{/);
  assert.match(html, /api\(`\/api\/analyses\/\$\{cur\.id\}\/business-summary`\)/);
  assert.match(html, /of \$\{s\.files\} approved files have an approved business view\./);
  assert.match(html, /Skipped for now \(\$\{s\.skipped\.length\}\)/);
  assert.match(html, /loadGroupSummary\(\);\n\s*try \{\n\s*const data = await api\(`\/api\/analyses\/\$\{cur\.id\}\/groupings`\)/);
});

test("the skip and the count are listed in What's new and the FAQ", () => {
  assert.match(guide, /A failed business view can be skipped for now/);
  assert.match(guide, /shows how many approved files have an approved business view/);
  assert.match(guide, /The business assessment of a file keeps failing\. Can I move on\?/);
});
