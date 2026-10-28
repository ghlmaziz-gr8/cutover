// The complexity treemap: pure layout, complexity measure and band, plus the wiring in the readiness panel.
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
const { complexityOf, layout, band, convex } = root.ComplexityTreemap;

// True when every turn of the polygon bends the same way.
function isConvex(p) {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

test("complexity counts stories, distinct rules and distinct files", () => {
  const c = complexityOf({
    paths: ["a.asp", "b.asp", "a.asp"],
    stories: [
      { story: "s1", rules: [{ file: "a.asp", id: "R1" }, { file: "a.asp", id: "R2" }] },
      { story: "s2", rules: [{ file: "a.asp", id: "R1" }] },
    ],
  });
  assert.deepEqual(c, { stories: 2, rules: 2, files: 2, total: 6 });
});

test("a feature with no stories or files still has a complexity of zero", () => {
  assert.equal(complexityOf({}).total, 0);
});

test("rectangles fill the box, and each area is its share of the total", () => {
  const items = [
    { key: "a", value: 6 },
    { key: "b", value: 3 },
    { key: "c", value: 2 },
    { key: "d", value: 1 },
  ];
  const cells = layout(items, 600, 400);
  const area = cells.reduce((s, c) => s + c.w * c.h, 0);
  assert.ok(Math.abs(area - 240000) < 1, `total area ${area}`);
  for (const c of cells) {
    const want = (items.find((i) => i.key === c.key).value / 12) * 240000;
    assert.ok(Math.abs(c.w * c.h - want) < 1, `${c.key} area`);
    assert.ok(c.x >= -1e-9 && c.y >= -1e-9 && c.x + c.w <= 600 + 1e-6 && c.y + c.h <= 400 + 1e-6);
  }
});

test("items with no value, or no box, lay out to nothing", () => {
  assert.deepEqual(layout([{ key: "a", value: 0 }], 100, 100), []);
  assert.deepEqual(layout([{ key: "a", value: 5 }], 0, 100), []);
});

test("band is high when every check passes, medium when one is missing, else low", () => {
  assert.equal(band(4, 4), "high");
  assert.equal(band(3, 4), "medium");
  assert.equal(band(1, 4), "low");
});

test("the readiness panel draws convex cells and loads the script", () => {
  assert.match(html, /<script src="complexity-treemap.js"><\/script>/);
  assert.match(html, /complexityMap\(draft\.groups \|\| \[\], r, caps\)/);
  assert.match(html, /T\.convexIn\(region\.points/);
  // Each feature has its own colour, shared by its row and its cell.
  assert.match(html, /const featureColour = \(i\) => FEATURE_COLOURS\[i % FEATURE_COLOURS\.length\];/);
  assert.match(html, /li\.style\.borderLeft = \`4px solid \$\{featureColour\(i\)\}\`;/);
  assert.match(html, /fill: featureColour\(cell\.key\)/);
});

test("convex cells are convex polygons whose areas match their share", () => {
  const values = [6, 3, 2, 1, 5, 4, 2];
  const cells = convex(values.map((v, i) => ({ key: i, value: v })), 600, 400);
  const total = values.reduce((a, b) => a + b, 0);
  for (const c of cells) {
    const want = (values[c.key] / total) * 240000;
    assert.ok(Math.abs(c.area - want) / want < 0.005, `cell ${c.key}: ${c.area} vs ${want}`);
    assert.ok(isConvex(c.points), `cell ${c.key} is convex`);
    for (const [x, y] of c.points) assert.ok(x >= -1e-6 && x <= 600 + 1e-6 && y >= -1e-6 && y <= 400 + 1e-6);
  }
  assert.ok(Math.abs(cells.reduce((s, c) => s + c.area, 0) - 240000) < 1);
});

test("one dominant feature among many small ones keeps every area in proportion", () => {
  const values = [100, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const total = values.reduce((a, b) => a + b, 0);
  const cells = convex(values.map((v, i) => ({ key: i, value: v })), 600, 400);
  assert.equal(cells.length, values.length);
  for (const c of cells) {
    const want = (values[c.key] / total) * 240000;
    assert.ok(Math.abs(c.area - want) / want < 0.005, `cell ${c.key}`);
  }
});

test("a single feature fills the whole box, and no items lay out to nothing", () => {
  const [only] = convex([{ key: "a", value: 3 }], 300, 200);
  assert.equal(only.area, 60000);
  assert.deepEqual(convex([{ key: "a", value: 0 }], 300, 200), []);
});

test("the treemap is listed in What's new", () => {
  assert.match(guide, /The feature groups card has a complexity treemap/);
});
