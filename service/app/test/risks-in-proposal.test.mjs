// The accepted risks and fallbacks go into the project plan that is shared with the customer and the team lead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../plan.js", import.meta.url), "utf8");
const ctx = { globalThis: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const Plan = ctx.globalThis.Plan;

const contingencies = [
  { risk: "A release fails its smoke test", contingency: "Keep the previous release package.", rollback_step: "Deploy the previous package.", trigger_condition: "Smoke test fails after cutover.", owner_email: "eng@example.com", status: "accepted" },
];

test("the plan document has a section for the risks and fallbacks, with each one's steps", () => {
  const md = Plan.build({ template: "lift-contain", findings: {}, contingencies });
  assert.match(md, /^## Cutover risks and fallbacks$/m);
  assert.match(md, /A release fails its smoke test/);
  assert.match(md, /Fallback: Keep the previous release package\./);
  assert.match(md, /Roll back by: Deploy the previous package\./);
  assert.match(md, /Trigger: Smoke test fails after cutover\./);
  assert.match(md, /Status: accepted/);
});

test("with no risks recorded, the section says so", () => {
  const md = Plan.build({ template: "lift-contain", findings: {}, contingencies: [] });
  assert.match(md, /No cutover risks and fallbacks recorded\./);
});
