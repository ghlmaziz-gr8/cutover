// The business view of one file: starts an assessment, and approves or discards its drafts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const section = html.slice(html.indexOf("// ---- Business view of one file"), html.indexOf("// Replaces one file's purpose with an editable box."));

test("each file has a Business view button that opens the panel", () => {
  assert.match(html, /button\("Business view", \(\) => businessPanel\(li, f\)\);/);
});

test("the panel starts an assessment and reads the file's assessments", () => {
  assert.match(section, /\/business\/start`, \{ method: "POST"/);
  assert.match(section, /\/business\?path=\$\{encodeURIComponent\(f\.path\)\}/);
});

test("drafts can be approved or discarded, and approving names the assessment", () => {
  assert.match(section, /\/business\/approve`, \{ method: "POST", body: JSON\.stringify\(\{ assessment_id: a\.id \}\)/);
  assert.match(section, /\/business\/discard`, \{ method: "POST", body: JSON\.stringify\(\{ assessment_id: a\.id \}\)/);
  assert.match(section, /if \(a\.review_status === "draft" && canActOnResults\(\)\)/);
});

test("the model's text is written as plain text, never as markup", () => {
  assert.doesNotMatch(section, /innerHTML\s*=\s*[^"'`]*(a\.content|value)/);
  assert.doesNotMatch(section, /insertAdjacentHTML/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /Business view, on a file's card, starts a business assessment/);
});

test("only platform engineers see Run, approve, discard or the model change; others get a plain note", () => {
  assert.match(html, /function canActOnResults\(\) \{\n    return !!ws && ws\.role === "platform_engineer";/);
  assert.match(html, /if \(!canActOnResults\(\)\) \{\n      start\.hidden = true;\n      modelPick\.disabled = true;/);
  assert.match(html, /Only platform engineers run, approve or discard file results/);
});
