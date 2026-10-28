// The per-feature effort: the same rates as the whole-application assessment, applied to one feature at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, "..", f), "utf8");
const root = {};
new Function("globalThis", read("effort.js"))(root);
new Function("globalThis", read("feature-effort.js"))(root);
const FE = root.FeatureEffort;

const file = (path, functions, tables) => ({
  path,
  assessment: { functions: Array.from({ length: functions }, (_, i) => ({ name: `f${i}` })), database: { tables: tables.map((name) => ({ name })), queries: [] } },
});
const feature = (name, stories, files) => ({ name, stories: Array.from({ length: stories }, (_, i) => ({ story: `s${i}` })), files });

test("a feature's facts come from its stories, its files, their functions and the tables they use", () => {
  const f = feature("Upload", 3, [file("a.asp", 2, ["Orders", "orders"]), file("b.asp", 1, ["Files"])]);
  assert.deepEqual(FE.factsOf(f), { stories: 3, screens: 2, functions: 3, tables: 2 });
});

test("the cutover figure is the manual effort less the saving, plus the review of the AI's code", () => {
  const r = FE.forFeature(feature("Upload", 4, [file("a.asp", 3, ["T1"])]), "web-modern");
  assert.ok(r.manualDays > 0);
  assert.ok(r.cutoverDays < r.manualDays, "cutover is cheaper");
  assert.ok(Math.abs(r.savedDays - (r.manualDays - r.cutoverDays)) < 0.15);
  assert.equal(r.savedHours, Math.round(r.savedDays * 8));
});

test("a bigger feature takes more hours, and the saving is a share of its manual effort", () => {
  const small = FE.forFeature(feature("A", 1, [file("a.asp", 0, [])]), "web-modern");
  const big = FE.forFeature(feature("B", 8, [file("a.asp", 10, ["T1", "T2", "T3"]), file("b.asp", 6, ["T4"])]), "web-modern");
  assert.ok(big.manualHours > small.manualHours);
  assert.ok(big.savedPercent > 0 && big.savedPercent < 100);
});

test("a capability adds its features together", () => {
  const a = feature("A", 2, [file("a.asp", 2, ["T1"])]);
  const b = feature("B", 3, [file("b.asp", 4, ["T2"])]);
  const sum = FE.forFeature(a, "web-modern").manualHours + FE.forFeature(b, "web-modern").manualHours;
  const cap = FE.forCapability([a, b], "web-modern");
  assert.equal(cap.features, 2);
  assert.ok(Math.abs(cap.manualHours - sum) <= 1);
});

test("an unknown approach falls back to the web approach, and an empty feature gives zero", () => {
  assert.equal(FE.forFeature(feature("A", 1, []), "nope").manualHours, FE.forFeature(feature("A", 1, []), "web-modern").manualHours);
  assert.equal(FE.forCapability([], "web-modern").manualHours, 0);
});

test("the capability heading shows the saving in hours and percent", () => {
  const html = read("index.html");
  assert.match(html, /<script src="feature-effort\.js"><\/script>/);
  assert.match(html, /window\.FeatureEffort\.forCapability/);
  assert.match(html, /fg-cap-saving/);
});
