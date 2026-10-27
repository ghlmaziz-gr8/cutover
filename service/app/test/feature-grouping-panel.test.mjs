// The Feature groups card on the file-results screen: platform engineers only, drafts approved or discarded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const start = html.indexOf("  // Feature groups: platform engineers propose");
const end = html.indexOf("  function renderFiles() {");
const section = html.slice(start, end);
const wiring = html.slice(html.indexOf('$("groupStart").addEventListener'), html.indexOf('$("filesApproveAll").addEventListener'));

test("the card is shown to platform engineers, and to the application owner or a CIO or CTO", () => {
  assert.notEqual(start, -1);
  assert.match(section, /card\.hidden = !\(isEngineer \|\| canReviewGrouping\(\)\);/);
});

test("the list is read from the groupings endpoint and reloaded after showing the files", () => {
  assert.match(section, /api\(`\/api\/analyses\/\$\{cur\.id\}\/groupings`\)/);
  assert.match(html, /renderFiles\(\);\s*loadGroupings\(\);/);
});

test("approve, send back, edit and discard send the grouping id, and only act on drafts", () => {
  assert.match(section, /api\(`\/api\/analyses\/\$\{cur\.id\}\/groupings\/\$\{action\}`, \{ method: "POST", body: JSON\.stringify\(\{ grouping_id: groupingId, \.\.\.extra \}\) \}\)/);
  assert.match(section, /const draft = g\.status === "draft";/);
});

test("the start button posts to the start endpoint", () => {
  assert.match(wiring, /api\(`\/api\/analyses\/\$\{cur\.id\}\/groupings\/start`, \{ method: "POST" \}\)/);
});

test("the group names and summaries are written as plain text, never as markup", () => {
  assert.doesNotMatch(section, /innerHTML\s*=\s*`/);
  assert.doesNotMatch(section, /insertAdjacentHTML/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /Feature groups, at the foot of a file-results screen/);
});
