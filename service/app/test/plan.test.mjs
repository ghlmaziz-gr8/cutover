import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const code = readFileSync(new URL("../plan.js", import.meta.url), "utf8");
const ctx = { globalThis: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const Plan = ctx.globalThis.Plan;

const findings = {
  "ui.screens": { value: ["Home", "Work list", "Record details"], severity: null },
  "data.tables": { value: ["visits", "patients"] },
  "stack.languages": { value: ["Classic ASP", "JavaScript"] },
  "ui.roles": { value: ["AdminFlag = 3", "superuser"] },
  "legacy.dependencies": { value: [{ name: "jquery", version: "1.8" }] },
  "data.routines_in_code": { value: [] },
  "infrastructure.as_code": { value: null },
  "data.migrations": { value: "Patient record 555-0100 example", severity: "high", title: "Schema changes kept in code" },
  "ui.endpoints": { value: ["/visits.asp"], severity: "medium", title: "Endpoints need an owner" },
};

test("the plan names the approach, who chose it, and the order of work", () => {
  const md = Plan.build({ appName: "Example", repo: "acme/app", template: "web-modern", chosenBy: "eng@example.com", chosenAt: "2026-10-22", findings });
  assert.match(md, /^# Modernization plan: Example/m);
  assert.match(md, /Approach: Modern web front end over an API/);
  assert.match(md, /Chosen by: eng@example.com on 2026-10-22/);
  assert.match(md, /1\. \*\*Put a clean API in front of the existing data\*\*/);
  assert.match(md, /Screens: 3/);
  assert.match(md, /Tables: 2/);
  assert.match(md, /Infrastructure as code: not found/);
});

test("each approach has its own order of work", () => {
  for (const id of Object.keys(Plan.PHASES)) {
    const md = Plan.build({ template: id, findings: {} });
    assert.equal(Plan.PHASES[id].length, 4);
    assert.match(md, new RegExp(Plan.TITLES[id].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the plan never copies a value from the code", () => {
  const md = Plan.build({ template: "services-data", findings });
  assert.ok(!md.includes("555-0100"), "a sample value from the code must not appear");
  assert.ok(!md.includes("/visits.asp"), "an endpoint value must not appear");
});

test("high findings become risks, medium findings become gaps, and empty findings say so", () => {
  const md = Plan.build({ template: "lift-contain", findings });
  assert.match(md, /Schema changes kept in code: decide how this is handled/);
  assert.match(md, /Endpoints need an owner: confirm before relying on it/);
  const empty = Plan.build({ template: "lift-contain", findings: {} });
  assert.match(empty, /No high-severity risks were found/);
  assert.match(empty, /No medium-severity gaps were found/);
});

test("the rough size follows the number of screens and tables", () => {
  assert.equal(Plan.sizeOf(5, 5), "Small");
  assert.equal(Plan.sizeOf(30, 20), "Medium");
  assert.equal(Plan.sizeOf(100, 40), "Large");
});
