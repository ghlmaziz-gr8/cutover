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
const { complexityOf, layout, band } = root.ComplexityTreemap;

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

test("the readiness panel draws the treemap and the script is loaded", () => {
  assert.match(html, /<script src="complexity-treemap.js"><\/script>/);
  assert.match(html, /complexityMap\(draft\.groups \|\| \[\], r\)/);
  assert.match(html, /\.fg-cell\.is-high\{background:#2f9e6b\}/);
  assert.match(html, /\.fg-cell\.is-medium\{background:#d89a1c\}/);
  assert.match(html, /\.fg-cell\.is-low\{background:#d0524a\}/);
});

test("the treemap is listed in What's new", () => {
  assert.match(guide, /The feature groups card has a complexity treemap/);
});
