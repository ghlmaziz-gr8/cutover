// The capability level: capabilities hold features, the map outlines each capability, and any signed-in user can rename one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "complexity-treemap.js"), "utf8");
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const root = {};
new Function("globalThis", src)(root);
const T = root.ComplexityTreemap;

const area = (p) => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;

test("features split a capability's region in proportion to their complexity", () => {
  const box = [[0, 0], [300, 0], [260, 200], [0, 180]];
  const values = [3, 2, 1];
  const cells = T.convexIn(box, values.map((v, i) => ({ key: i, value: v })));
  const total = values.reduce((a, b) => a + b, 0);
  assert.equal(cells.length, 3);
  for (const c of cells) {
    const want = (values[c.key] / total) * area(box);
    assert.ok(Math.abs(c.area - want) / want < 0.005, `feature ${c.key}`);
  }
  assert.ok(Math.abs(cells.reduce((s, c) => s + c.area, 0) - area(box)) < 1);
});

test("the card draws each capability's name and outline, and renames it through the Worker", () => {
  assert.match(html, /function renameCapability\(groupingId, index, name, reload\)/);
  assert.match(html, /method: "PATCH", body: JSON\.stringify\(\{ grouping_id: groupingId, index, name: next \}\)/);
  assert.match(html, /\/api\/analyses\/\$\{cur\.id\}\/capabilities/);
  assert.match(html, /class: "fg-cap"/);
  assert.match(html, /class: "fg-cap-label"/);
  assert.match(html, /aria-label", "Capability name"/);
  assert.match(html, /T\.convex\(sections\.map/);
});

test("the approved view shows a capability heading before its features", () => {
  assert.match(html, /const approvedCaps = Array\.isArray\(data\.capabilities\)/);
  assert.match(html, /renameCapability\(data\.grouping\.id, ci, input\.value, \(\) => loadFeatureView\(\)\)/);
});

test("the Worker returns the capabilities with the features", () => {
  const worker = readFileSync(join(here, "..", "..", "worker", "src", "index.mjs"), "utf8");
  assert.match(worker, /select=id,groups,capabilities,reviewed_by_email,reviewed_at/);
  assert.match(worker, /select=id,status,groups,capabilities,source_count,/);
});

test("the two levels are in What's new", () => {
  assert.match(guide, /Feature groups now have two levels/);
});
