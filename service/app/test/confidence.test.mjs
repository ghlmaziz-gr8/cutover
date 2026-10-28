// The confidence score of a deep assessment, and the halo that shows it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const sandbox = {};
vm.runInNewContext(readFileSync(join(root, "confidence.js"), "utf8"), sandbox);
const { confidenceOf } = sandbox.Confidence;

test("a clean assessment with every rule checked and exampled scores high", () => {
  const content = {
    functions: [{ name: "Save", calls: ["Check"] }, { name: "Check", calls: [] }],
    rules: [{ id: "R1", lines: [1, 4] }, { id: "R2", lines: [5, 9] }],
    examples: [{ rule: "R1" }, { rule: "R2" }],
  };
  const r = confidenceOf(content, 0);
  assert.equal(r.score, 100);
  assert.equal(r.band, "high");
});

test("names that had to be dropped lower the score", () => {
  const content = { functions: [{ name: "Save", calls: ["Check"] }], rules: [], examples: [] };
  const clean = confidenceOf(content, 0).score;
  const lossy = confidenceOf(content, 3).score;
  assert.ok(lossy < clean, `${lossy} should be below ${clean}`);
});

test("rules without lines or examples lower the score, and the parts are shown", () => {
  const content = { functions: [], rules: [{ id: "R1" }, { id: "R2", lines: [1, 2] }], examples: [{ rule: "R2" }] };
  const r = confidenceOf(content, 0);
  assert.equal(r.parts.lines, 50);
  assert.equal(r.parts.examples, 50);
  assert.equal(r.band, r.score >= 80 ? "high" : r.score >= 55 ? "medium" : "low");
});

test("an empty assessment scores in the middle, not as zero or full", () => {
  const r = confidenceOf({}, 0);
  assert.equal(r.score, 50);
  assert.equal(r.band, "low");
});

test("the score ends in one of three bands", () => {
  for (const d of [0, 1, 5, 50]) {
    assert.ok(["high", "medium", "low"].includes(confidenceOf({ functions: [{ name: "A", calls: [] }] }, d).band));
  }
});

test("the deep card shows the score with a halo that animates, and respects reduced motion", () => {
  assert.match(html, /Confidence\.confidenceOf\(content, dropped\)/);
  assert.match(html, /appendHalo\(c, content, a\.dropped\);/);
  assert.match(html, /function deepHalo\(/);
  assert.match(html, /\.dh-arc\s*\{[^}]*transition:\s*stroke-dashoffset/);
  assert.match(html, /@keyframes dhPulse/);
  assert.match(html, /@keyframes dhSpin/);
  assert.match(html, /prefers-reduced-motion: reduce\)\{[^}]*\.dh-dash/);
});
