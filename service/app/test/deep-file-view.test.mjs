// The Deep view on a file: a platform engineer runs it, and approves or discards the draft. Text only, never markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const panel = html.slice(html.indexOf("  function deepPanel(li, f, onClose"), html.indexOf("  function businessPanel(li, f) {"));

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
  assert.match(html, /if \(a\.status === "draft" && canActOnResults\(\)\) \{[\s\S]*?const row = el\("div", null, "row"\);/);
});

test("the account is written as plain text, never as markup", () => {
  assert.doesNotMatch(panel, /innerHTML\s*=\s*`/);
  assert.doesNotMatch(panel, /insertAdjacentHTML/);
});

test("the change is listed in What's new, with the lower-confidence note", () => {
  assert.match(guide, /Deep view, on a file in the business assessment list/);
  assert.match(html, /Read by the model, so its confidence is lower than a rule-based result/);
});

test("choosing a file opens its deep view under it by itself, with an entrance, and closing removes the panel", () => {
  const detail = html.slice(html.indexOf("  function showBusinessFile(path) {"), html.indexOf("  // Next steps opens only when"));
  assert.match(detail, /box\.classList\.add\("dp-enter"\);/);
  assert.match(detail, /const panel = deepPanel\(box, f, \(\) => panel\.remove\(\), actions\);/);
  assert.ok(!detail.includes('"Deep view", "small-btn"'));
});

test("an approved file says its next step: its feature, or grouping it", () => {
  assert.match(html, /list\.appendChild\(deepCard\(a, \(\) => refreshAfterChange\(f\.path\), msg, f\.path\)\);/);
  assert.match(html, /if \(a\.status === "approved" && path\) c\.append\(nextStepNote\(path\)\);/);
  assert.match(html, /Next step: add this file to a feature in the draft on the Features card\./);
  assert.match(html, /Next step: an engineer groups this file into a feature, and the owner approves it\./);
  assert.match(html, /api\(`\/api\/analyses\/\$\{cur\.id\}\/features`\)/);
});

test("the reviewer's items are amber: names not found, names unchecked, and the model's read", () => {
  assert.match(html, /\.attn\{color:#92400e;background:#fef3c7;border-left:3px solid #f59e0b/);
  assert.match(html, /not found in the file and left out\.`, "attn small"\)/);
  assert.match(html, /Read by the model, so its confidence is lower than a rule-based result\. An engineer checks it before it is final\.", "attn small"\)/);
  assert.match(html, /conf\.parts\.names < 100 \? "attn small" : "muted small"/);
});

test("an engineer can add an approved file that is not in the draft to one of its features, and saving checks it", () => {
  assert.match(html, /function addFileRow\(groups, redraw\) \{/);
  assert.match(html, /box\.insertBefore\(addFileRow\(groups, \(\) => drawGroups\(\)\), actions\);/);
  assert.match(html, /const free = approvedPaths\.filter\(\(p\) => !inDraft\.has\(p\)\);/);
  assert.match(html, /target\.paths\.push\(pick\.value\);/);
  assert.match(html, /Add to feature/);
});

test("every role can open the file-level results; only engineers see Approve and Edit purpose on a file", () => {
  assert.match(html, /\$\("reviewFilesTop"\)\.hidden = false;/);
  assert.doesNotMatch(html, /\$\("reviewFilesTop"\)\.hidden = !cur\.can_plan;/);
  assert.match(html, /if \(canActOnResults\(\)\) \{\n      if \(f\.review_status !== "approved"\) button\("Approve"/);
  assert.match(html, /button\("Edit purpose", \(\) => openFileEditor\(li, f\)\);\n    \}/);
});

test("file-level results can be reached from the Deeper assessment screen, and a blocked grouping says where to approve", () => {
  assert.match(html, /<button type="button" class="ghost small-btn" id="deeperReviewFiles">Review file results<\/button>/);
  assert.match(html, /\$\("deeperReviewFiles"\)\.addEventListener\("click", \(\) => showFiles\(\)\);/);
  assert.match(html, /Approve them under Files for the business assessment on the Deeper assessment screen\./);
});

