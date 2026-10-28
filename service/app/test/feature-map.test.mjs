// The mind map of the approved features: built from the approved features only, with confidence on each branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const load = (file) => {
  const sandbox = {};
  vm.runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), sandbox);
  return sandbox;
};
const { FeatureTree } = load("feature-map.js");
const { Confidence } = load("confidence.js");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const assessed = {
  dropped: 0,
  functions: [{ name: "SaveOrder", purpose: "Stores an order.", calls: [] }],
  rules: [{ id: "R1", statement: "An order needs a customer.", function: "SaveOrder", lines: [4, 9] }],
  examples: [{ rule: "R1" }],
  database: { tables: [{ name: "orders", operations: ["INSERT"], fields: [] }], queries: [{ function: "SaveOrder", operation: "INSERT", tables: ["orders"] }] },
};
const data = {
  grouping: { id: "g1" },
  features: [{
    name: "Ordering",
    files: [{ path: "src/Orders.asp", assessment: assessed }, { path: "src/Pending.asp", assessment: null }],
    stories: [{ story: "As a clerk I can place an order so that it is checked." }],
  }],
};
const find = (node, pred) => {
  if (pred(node)) return node;
  for (const c of node.children || []) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
};

test("the map is the application, then the approved features, with files, functions, rules and data beneath", () => {
  const tree = FeatureTree.build(data, Confidence.confidenceOf, "ManageIT");
  assert.equal(tree.kind, "root");
  assert.equal(tree.label, "ManageIT");
  assert.equal(tree.meta, "1 approved feature");
  const feature = tree.children[0];
  assert.equal(feature.label, "Ordering");
  assert.ok(find(feature, (n) => n.label === "User stories"), "the stories branch is there");
  assert.ok(find(feature, (n) => n.label === "Function SaveOrder — Stores an order."));
  assert.ok(find(feature, (n) => /^Rule R1: An order needs a customer\. \(lines 4–9\) · in SaveOrder · has a worked example$/.test(n.label)));
  assert.ok(find(feature, (n) => n.label === "Table orders · INSERT"));
  assert.ok(find(feature, (n) => n.label === "INSERT in SaveOrder on orders"));
});

test("each file shows its confidence, and the feature shows the average of its assessed files", () => {
  const tree = FeatureTree.build(data, Confidence.confidenceOf, "ManageIT");
  const feature = tree.children[0];
  const file = find(feature, (n) => (n.label || "").startsWith("src/Orders.asp"));
  const score = Confidence.confidenceOf({ functions: assessed.functions, rules: assessed.rules, examples: assessed.examples }, 0).score;
  assert.ok(file.label.endsWith(`confidence ${score}`), file.label);
  assert.match(feature.meta, new RegExp(`confidence ${score} · 2 files · 1 story`));
});

test("a file with no approved assessment is marked, and does not count toward confidence", () => {
  const tree = FeatureTree.build(data, Confidence.confidenceOf, "ManageIT");
  const pending = find(tree, (n) => (n.label || "").startsWith("src/Pending.asp"));
  assert.equal(pending.label, "src/Pending.asp · no approved assessment yet");
  assert.equal(pending.tone, "plain");
});

test("a branch's colour follows its band: high green, medium amber, low red", () => {
  assert.deepEqual({ ...FeatureTree.TONE }, { high: "pro", medium: "possible", low: "con" });
});

test("names left out are said in the map, and no grouping means no map", () => {
  const dropped = { ...data, features: [{ ...data.features[0], files: [{ path: "src/Orders.asp", assessment: { ...assessed, dropped: 2 } }] }] };
  const tree = FeatureTree.build(dropped, Confidence.confidenceOf, "ManageIT");
  assert.ok(find(tree, (n) => n.label === "2 names left out, not found in the code"));
  assert.equal(FeatureTree.build({ grouping: null, features: [] }, Confidence.confidenceOf, "x"), null);
});

test("the map is drawn in the feature card and only from the approved features", () => {
  assert.match(html, /<script src="feature-map\.js"><\/script>/);
  assert.match(html, /<div class="mmap feature-map" id="featureMap"/);
  assert.match(html, /window\.FeatureTree\.build\(data, window\.Confidence\.confidenceOf, cur\.app_name \|\| cur\.repo\)/);
  assert.match(html, /drawMap\(tree, box, \{\n\s+title: "Mind map of the approved capabilities and features"/);
});
