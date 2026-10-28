// The business view shows the approved deep assessment of the file, and the open file's Business view button is highlighted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

test("the business view shows the approved deep assessment of the file, read only", () => {
  assert.match(html, /const codeBox = el\("div", null, "biz-col biz-code"\);/);
  assert.match(html, /Deep assessment: what the code does/);
  assert.match(html, /Deep assessment: what the code does/);
  assert.match(html, /api\(`\/api\/analyses\/\$\{cur\.id\}\/deep-files\?path=\$\{encodeURIComponent\(f\.path\)\}`\)/);
  assert.match(html, /rows\.find\(\(a\) => a\.status === "approved"\) \|\| null/);
  assert.match(html, /else body\.append\(deepCard\(pick, \(\) => \{\}, msg, f\.path\)\);/);
  assert.match(html, /compare\.append\(codeBox, side\);/);
  assert.match(html, /panel\.append\(top, modelRow, msg, compare\);/);
});

test("the Business view button of the open file is highlighted, and so is its row", () => {
  assert.match(html, /const bizBtn = button\("Business view", \(\) => openBusinessView\(li, f, bizBtn\)\);/);
  assert.match(html, /function setBizOpen\(btn, li, on\) \{/);
  assert.match(html, /btn\.classList\.toggle\("is-active", on\);/);
  assert.match(html, /li\.classList\.toggle\("is-biz-open", on\);/);
  assert.match(html, /button\.ghost\.small-btn\.is-active\{background:#7c3aed;border-color:#7c3aed;color:#fff\}/);
  assert.match(html, /const closeView = \(\) => \{ box\.remove\(\); setBizOpen\(btn, li, false\); \};/);
});

test("the code view and the business view sit side by side, with the business view headed, and stack on a narrow screen", () => {
  assert.match(html, /const compare = el\("div", null, "biz-compare"\);/);
  assert.match(html, /side\.append\(el\("div", "Business assessment", "biz-head"\), list\);/);
  assert.match(html, /\.biz-compare\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(html, /@media \(max-width:820px\)\{\.biz-compare\{grid-template-columns:1fr\}\}/);
});

test("Enlarge extends the business panel to the window, and Shrink brings it back", () => {
  assert.match(html, /const enlarge = el\("button", "Enlarge", "ghost small-btn"\);/);
  assert.match(html, /panel\.classList\.toggle\("is-enlarged", on\);/);
  assert.match(html, /enlarge\.textContent = on \? "Shrink" : "Enlarge";/);
  assert.match(html, /top\.append\(start, refresh, enlarge, close\);/);
  assert.match(html, /\.biz-panel\.is-enlarged\{position:fixed;inset:12px;z-index:60;overflow:auto/);
});

test("both columns are headed and bordered, and the deep card\'s next-step note wraps inside its column", () => {
  assert.match(html, /side\.append\(el\("div", "Business assessment", "biz-head"\), list\);/);
  assert.match(html, /\.biz-compare>\.biz-col\{min-width:0;border:1px solid/);
  assert.match(html, /\.biz-compare \.next-step\{white-space:normal;/);
});
