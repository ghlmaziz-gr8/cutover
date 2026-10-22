// Run: node --test service/app/test/radial.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../radial.js", import.meta.url), "utf8"), sandbox);
const { build, wrap, curve, CX, LEAF_X, BRANCH_X } = sandbox.Radial;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const tree = (n) => ({
  label: "Root",
  children: Array.from({ length: n }, (_, i) => ({
    id: `b${i}`, label: `Branch ${i}`, tone: "pro",
    children: [{ kind: "group", tone: "pro", label: "Pros", children: [{ kind: "leaf", tone: "pro", label: `Point ${i}a` }, { kind: "leaf", tone: "pro", label: `Point ${i}b` }] }],
  })),
});

test("branches alternate right and left of the centre", () => {
  const map = build(tree(4));
  assert.equal(JSON.stringify(map.branches.map((b) => b.side)), JSON.stringify(["right", "left", "right", "left"]));
  for (const b of map.branches) {
    assert.equal(b.x, CX + (b.side === "right" ? BRANCH_X : -BRANCH_X));
    for (const l of b.leaves) assert.equal(l.x, CX + (b.side === "right" ? LEAF_X : -LEAF_X));
  }
});

test("a branch's points are flattened from its groups, with the group's icon", () => {
  const map = build(tree(1));
  assert.equal(map.branches[0].leaves.length, 2);
  assert.equal(map.branches[0].leaves[0].label, "Point 0a");
  assert.equal(map.branches[0].leaves[0].icon, "✓");
});

test("points beyond eight are summarised as 'more'", () => {
  const big = { label: "R", children: [{ id: "x", label: "X", tone: "pro", children: Array.from({ length: 12 }, (_, i) => ({ kind: "leaf", tone: "pro", label: `p${i}` })) }] };
  const map = build(big);
  const leaves = map.branches[0].leaves;
  assert.equal(leaves.length, 9);
  assert.equal(leaves[8].label, "4 more");
  assert.equal(leaves[8].more, true);
});

test("the layout fits inside its view and has no two pills on top of each other", () => {
  const map = build(tree(3));
  const ys = map.branches.flatMap((b) => b.leaves.filter((l) => l.dir === (b.side === "right" ? 1 : -1)).map((l) => `${b.side}:${l.y}`));
  assert.equal(new Set(ys).size, ys.length, "every point has its own row on its side");
  for (const b of map.branches) for (const l of b.leaves) {
    assert.ok(l.y > 0 && l.y < map.viewH);
    assert.ok(l.x > 0 && l.x < map.viewW, "point stays inside the width");
  }
});

test("long labels wrap to two lines and end with an ellipsis when cut", () => {
  assert.equal(JSON.stringify(wrap("Short", 10)), JSON.stringify(["Short"]));
  const two = wrap("Modern web front end over an API", 20);
  assert.equal(two.length, 2);
  assert.equal(two[0], "Modern web front end");
  const cut = wrap("a".repeat(60), 10);
  assert.ok(cut[1].endsWith("…"));
  assert.ok(cut[1].length <= 10);
});

test("curves start and end on the given points", () => {
  assert.equal(curve(10, 20, 110, 80), "M 10 20 C 60 20, 60 80, 110 80");
});

test("the page loads the radial script and draws it on wide screens, with the list kept for phones", () => {
  assert.ok(html.includes('<script src="radial.js"></script>'));
  assert.ok(html.includes("function drawRadial("));
  assert.ok(html.includes("@media (min-width:760px)"));
  assert.ok(html.includes(".radial-wide{display:none}"));
  assert.ok(html.includes('el("div", null, "radial-wide")'));
  assert.ok(html.includes('el("div", null, "list-narrow")'));
});
