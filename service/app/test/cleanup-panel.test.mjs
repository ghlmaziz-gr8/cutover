// The Clean up card on the Workspaces tab: preview first, then remove the same count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const section = html.slice(html.indexOf("// ---- Clean up superseded business assessments"), html.indexOf("// The database size against the free-tier limit"));

test("the card is shown only to platform engineers on the Workspaces tab", () => {
  assert.match(html, /const cleanupHere = !!\(ws && ws\.role === "platform_engineer" && homeTab === "workspaces"\);/);
  assert.match(html, /\$\("cleanupCard"\)\.hidden = !cleanupHere;/);
});

test("the preview is read first, and the removal sends the count that was previewed", () => {
  assert.match(section, /api\(`\/api\/workspaces\/\$\{ws\.id\}\/cleanup\/superseded`\)/);
  assert.match(section, /method: "POST", body: JSON\.stringify\(\{ expected_count: cleanupExpected \}\)/);
});

test("the card is written as plain text, never as markup", () => {
  assert.doesNotMatch(section, /innerHTML\s*=\s*`/);
  assert.doesNotMatch(section, /insertAdjacentHTML/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /Clean up, on the Workspaces tab, removes superseded business assessments/);
});
