// The findings treemap: tiles are in proportion to their values, fill the box, and do not overlap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../treemap.js", import.meta.url), "utf8"), sandbox);
const { layout } = sandbox.TreeMap;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const rows = [
  { label: "Links findings", value: 3, color: "a" },
  { label: "Screens findings", value: 2, color: "b" },
  { label: "Security findings", value: 1, color: "c" },
  { label: "Stack findings", value: 3, color: "d" },
  { label: "Data findings", value: 3, color: "e" },
  { label: "Infrastructure findings", value: 1, color: "f" },
];

test("each tile's area is in proportion to its value, and the tiles fill the box", () => {
  const W = 400;
  const H = 240;
  const tiles = layout(rows, W, H);
  assert.equal(tiles.length, rows.length);
  const total = rows.reduce((a, r) => a + r.value, 0);
  let area = 0;
  for (const t of tiles) {
    const want = (t.value / total) * W * H;
    assert.ok(Math.abs(t.w * t.h - want) < 1e-6, `${t.label} is in proportion`);
    area += t.w * t.h;
  }
  assert.ok(Math.abs(area - W * H) < 1e-6, "the tiles fill the box");
});

test("tiles stay inside the box and do not overlap", () => {
  const W = 400;
  const H = 240;
  const tiles = layout(rows, W, H);
  for (const t of tiles) {
    assert.ok(t.x >= -1e-9 && t.y >= -1e-9 && t.x + t.w <= W + 1e-6 && t.y + t.h <= H + 1e-6, `${t.label} is inside`);
  }
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i];
      const b = tiles[j];
      const overlap = a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
      assert.equal(overlap, false, `${a.label} and ${b.label} do not overlap`);
    }
  }
});

test("the tiles are kept close to square, so they are easy to compare", () => {
  const tiles = layout(rows, 400, 240);
  for (const t of tiles) {
    const ratio = Math.max(t.w / t.h, t.h / t.w);
    assert.ok(ratio < 4, `${t.label} aspect ${ratio.toFixed(2)}`);
  }
});

test("zero values are left out, and an empty list draws nothing", () => {
  assert.equal(layout([{ label: "none", value: 0 }], 400, 240).length, 0);
  assert.equal(layout([], 400, 240).length, 0);
  assert.equal(layout(rows.concat({ label: "zero", value: 0 }), 400, 240).length, rows.length);
});

test("the findings card draws a treemap, not bars, and the tiles animate in with the count", () => {
  assert.match(html, /<script src="treemap\.js"><\/script>/);
  assert.match(html, /p\.appendChild\(treemap\(catRows\)\);/);
  assert.doesNotMatch(html, /hbars\(catRows\)/);
  assert.match(html, /@keyframes tmIn/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{\.tm-tile\{animation:none;opacity:1;transform:none\}/);
});
