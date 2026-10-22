// The Cutover AI assessment: effort, resources and the project plan. Run: node --test service/app/test/effort.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../effort.js", import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(src, sandbox);
const E = sandbox.Effort;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const facts = {
  template: "web-modern", screens: 12, endpoints: 20, routines: { procedures: 8, functions: 3, views: 2 },
  tables: 14, dependencies: 6, targetLanguage: "py-fastapi", targetLabel: "Python with FastAPI", targetMatchesLegacy: false,
};

test("the assessment says it is a Cutover AI assessment", () => {
  assert.equal(E.LABEL, "Cutover AI assessment");
});

test("without an approach there is no estimate", () => {
  const r = E.build({});
  assert.equal(r.ready, false);
  assert.ok(r.message);
});

test("every range is low to high, and totals add up", () => {
  const r = E.build(facts);
  assert.equal(r.ready, true);
  assert.ok(r.coding.low <= r.coding.high);
  assert.ok(r.database.low <= r.database.high);
  assert.ok(r.total.low <= r.total.high);
  assert.ok(r.total.low >= r.coding.low + r.database.low);
});

test("the database part covers tables, routines and migration", () => {
  const r = E.build(facts);
  const labels = r.database.items.map((i) => i.label);
  assert.ok(labels.includes("Tables and schema"));
  assert.ok(labels.includes("Stored procedures, functions and views"));
  assert.ok(labels.includes("Data migration and checks"));
  assert.equal(r.database.items.find((i) => i.label.startsWith("Stored")).count, 13);
});

test("a new language costs more than the legacy language", () => {
  const same = E.build({ ...facts, targetMatchesLegacy: true });
  const other = E.build(facts);
  assert.ok(other.coding.high > same.coding.high);
});

test("lift and contain moves the code as it is and adds container work", () => {
  const r = E.build({ ...facts, template: "lift-contain" });
  assert.equal(r.coding.items.find((i) => i.label.startsWith("Container")).days[0] > 0, true);
  const screens = r.coding.items.find((i) => i.label === "Screens and pages");
  assert.ok(screens.days[1] / screens.count <= 1, "at most a day per screen");
});

test("the team and the plan stay within limits, and phases follow one another", () => {
  const r = E.build(facts);
  assert.ok(r.team >= 2 && r.team <= 12);
  assert.ok(r.resources.some((x) => x.role === "Developers"));
  assert.equal(r.phases[0].startWeek, 1);
  for (let i = 1; i < r.phases.length; i++) assert.equal(r.phases[i].startWeek, r.phases[i - 1].endWeek + 1);
  assert.equal(r.weeks, r.phases[r.phases.length - 1].endWeek);
  for (const ph of r.phases) assert.ok(ph.tasks.length > 0, ph.name);
});

test("missing findings are named, not guessed", () => {
  const r = E.build({ template: "web-modern" });
  assert.ok(r.notes.some((n) => /No screens were found/.test(n)));
  assert.ok(r.notes.some((n) => /No target language/.test(n)));
});

test("the portal shows the card, the plan toggle and the exports", () => {
  assert.ok(html.includes('id="effortCard"'));
  assert.ok(html.includes('src="effort.js"'));
  assert.ok(html.includes("exportCardPdf(\"effortCard\""));
  assert.ok(html.includes("View the project plan"));
});
