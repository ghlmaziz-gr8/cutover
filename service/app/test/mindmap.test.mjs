// Run: node --test service/app/test/mindmap.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const load = (file) => {
  const sandbox = {};
  vm.runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), sandbox);
  return sandbox;
};
const { Modernize } = load("modernize.js");
const { MindMap } = load("mindmap.js");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("each approach has pros, cons and best-for points", () => {
  for (const t of Modernize.TEMPLATES) {
    assert.ok(t.points, `${t.id} has points`);
    for (const k of ["pros", "cons", "best"]) assert.ok(t.points[k].length > 0, `${t.id} has ${k}`);
  }
});

test("the map has the root and one branch per approach, in the order given", () => {
  const picks = Modernize.choose({});
  const map = MindMap.approach(picks, Object.fromEntries(Modernize.TEMPLATES.map((t) => [t.id, t.points])));
  assert.equal(map.label, "Modernize the application");
  assert.deepEqual(map.children.map((c) => c.id), picks.map((p) => p.id));
  for (const branch of map.children) {
    const groups = branch.children.map((g) => g.label);
    assert.ok(groups.includes("Pros") && groups.includes("Cons") && groups.includes("Best for"));
  }
});

test("a branch shows why it matches this application when reasons exist", () => {
  const picks = [{ id: "web-modern", title: "T", fit: "recommended", reasons: ["Screens were found in the code"] }];
  const map = MindMap.approach(picks, Modernize.TEMPLATES.reduce((o, t) => ((o[t.id] = t.points), o), {}));
  assert.equal(map.children[0].tag, "Best fit for this application");
  assert.equal(map.children[0].children[0].label, "Matches this application");
  assert.equal(map.children[0].children[0].children[0].label, "Screens were found in the code");
});

test("no picks gives an empty map without error", () => {
  assert.equal(MindMap.approach(undefined, {}).children.length, 0);
});

test("the page loads the map script and draws it in the next-steps card", () => {
  assert.ok(html.includes('<script src="mindmap.js"></script>'));
  assert.ok(html.includes('id="approachMap"'));
  assert.ok(html.includes("renderApproachMap"));
});
