// The business card uses the deep card's layout, and a file with an approved deep result has no run button. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const slice = (from, to) => html.slice(html.indexOf(from), html.indexOf(to));
const biz = slice("  function bizCard(a, reload, msg) {", "  // Replaces one file's purpose");

test("the business card starts with the same job header and status line as the deep card", () => {
  assert.ok(biz.includes("c.append(...deepJobHead({ ...a, status: a.review_status }));"));
  assert.ok(biz.includes("const commit = a.commit_sha"));
});

test("the business card shows the same model note and the same approve and discard row", () => {
  assert.ok(biz.includes("Read by the model, so its confidence is lower than a rule-based result. An engineer checks it before it is final."));
  assert.ok(biz.includes('"Approve this draft"'));
  assert.ok(biz.includes('"Discard"'));
});

test("a file with an approved deep result has no run button on its deep panel", () => {
  assert.ok(html.includes('if (assessments.some((x) => x.status === "approved")) start.hidden = true;'));
});
