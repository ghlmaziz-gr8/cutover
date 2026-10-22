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
const allPoints = () => Object.fromEntries(Modernize.TEMPLATES.map((t) => [t.id, t.points]));

test("each approach has pros, cons and best-for points", () => {
  for (const t of Modernize.TEMPLATES) {
    assert.ok(t.points, `${t.id} has points`);
    for (const k of ["pros", "cons", "best"]) assert.ok(t.points[k].length > 0, `${t.id} has ${k}`);
  }
});

test("the root has one branch per approach, in the order given, each with a score and a maximum", () => {
  const picks = Modernize.choose({});
  const map = MindMap.approach(picks, allPoints());
  assert.equal(map.kind, "root");
  assert.equal(map.label, "Modernize the application");
  assert.equal(JSON.stringify(map.children.map((c) => c.id)), JSON.stringify(picks.map((p) => p.id)));
  for (const b of map.children) {
    assert.equal(b.kind, "branch");
    assert.ok(b.max >= b.score && b.max > 0);
  }
});

test("evidence from real findings is shown as Why it matches", () => {
  const picks = Modernize.choose({ "ui.screens": { point: true, value: ["Home"] } });
  const web = picks.find((p) => p.id === "web-modern");
  assert.ok(web.evidence.includes("Screens were found in the code"));
  const map = MindMap.approach(picks, allPoints());
  const branch = map.children.find((b) => b.id === "web-modern");
  const why = branch.children.find((g) => g.label === "Why it matches");
  assert.ok(why && why.children.some((l) => l.label === "Screens were found in the code"));
});

test("the chosen approach is flagged, and only that one", () => {
  const map = MindMap.approach(Modernize.choose({}), allPoints(), "services-data");
  const flagged = map.children.filter((b) => b.chosen).map((b) => b.id);
  assert.equal(JSON.stringify(flagged), JSON.stringify(["services-data"]));
});

test("each group has a tone and an icon, and each leaf has a tone", () => {
  const map = MindMap.approach(Modernize.choose({}), allPoints());
  for (const b of map.children) {
    for (const g of b.children) {
      assert.equal(g.kind, "group");
      assert.ok(g.tone && g.icon, "group has tone and icon");
      for (const l of g.children) assert.equal(l.kind, "leaf");
    }
  }
});

test("no picks gives an empty map without error", () => {
  assert.equal(MindMap.approach(undefined, {}).children.length, 0);
});

test("the page draws both maps with the rich renderer and the interactions", () => {
  assert.ok(html.includes('<script src="mindmap.js"></script>'));
  assert.ok(html.includes('id="approachMap"'));
  assert.ok(html.includes("function drawBranch("));
  assert.ok(html.includes("function goToOption("));
  assert.ok(html.includes('c.id = `opt-${p.id}`') || html.includes('c.id = "opt-" + p.id'));
  assert.ok(html.includes("The plan at a glance"));
  assert.ok(html.includes("drawMap(window.Plan.tree(planInput(row)), map, { radial: true, title: "Project plan" });"));
  assert.ok(html.includes("function planInput(row)"));
  assert.ok(html.includes("prefers-reduced-motion"));
});
