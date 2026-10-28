// Feature groupings: the application owner approves or sends back, an engineer edits a draft, overlap is allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("only the application owner or a CIO or CTO sees approve and send back", () => {
  assert.match(html, /function canReviewGrouping\(\) \{/);
  assert.match(html, /return \(!!owner && owner === me\.email\) \|\| ws\.role === "cio_cto";/);
  assert.match(html, /const reviewer = draft && canReviewGrouping\(\);/);
});

test("an engineer edits a draft: rename a feature, take a file out, save", () => {
  assert.match(html, /const editable = draft && isEngineer;/);
  assert.match(html, /groupAction\("edit", g\.id, \{ groups \}\)/);
  assert.match(html, /Take \$\{path\} out of \$\{item\.name\}/);
});

test("a sent-back grouping shows its note", () => {
  assert.match(html, /Sent back: \$\{g\.review_note\}/);
  assert.match(html, /groupAction\("reject", g\.id, \{ note: text\.value \}\)/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The application owner approves the feature grouping/);
});

test("an engineer drafts the user stories, and the stories show under each feature with the rules they cite", () => {
  assert.match(html, /function draftStories\(g\) \{/);
  assert.match(html, /groupings\/stories`, \{ method: "POST"/);
  assert.match(html, /function watchStories\(groupingId, before\) \{/);
  assert.match(html, /The user stories are ready\. They are drafts until the application owner approves the grouping\./);
  assert.match(html, /\$\{r\.file\} · \$\{r\.id\}/);
});
