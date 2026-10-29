// The estimate follows the scope: deeper assessment only, with Modernize, with Migrate, or with both.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../effort.js", import.meta.url), "utf8"), sandbox);
const E = sandbox.Effort;

const facts = { template: "web-modern", screens: 40, endpoints: 20, controllers: 6, tables: 25, roles: 4, sourceFiles: 300, targetLanguage: "python", targetMatchesLegacy: false, hasIac: true, hasCi: true };
const total = (scope) => E.build(facts, { scenario: "expected", scope }).total.value;

test("the groups in each scope: deeper is always in, and each stage adds its own", () => {
  assert.deepEqual([...E.groupsInScope("deeper")].sort(), [...E.SCOPE_GROUPS.base].sort());
  for (const k of E.SCOPE_GROUPS.modernize) assert.ok(E.groupsInScope("deeper_modernize").has(k));
  for (const k of E.SCOPE_GROUPS.migrate) assert.ok(E.groupsInScope("deeper_migrate").has(k));
  assert.equal(E.groupsInScope(null), null, "no scope counts every group");
});

test("the estimate grows with the scope: deeper only, then Modernize or Migrate, then both", () => {
  const deeper = total("deeper");
  const modern = total("deeper_modernize");
  const migrate = total("deeper_migrate");
  const both = total("deeper_modernize_migrate");
  assert.ok(deeper < modern, "Modernize adds build and testing");
  assert.ok(deeper < migrate, "Migrate adds the cloud move");
  assert.ok(modern < both && migrate < both, "both adds everything");
});

test("the plan shows only the phases of the scope: no build without Modernize, no cutover without Migrate", () => {
  const deeper = E.build(facts, { scenario: "expected", scope: "deeper" });
  assert.ok(!deeper.phases.some((p) => p.name === "Application build"));
  assert.ok(!deeper.phases.some((p) => p.name === "Cutover and go-live"));
  assert.ok(deeper.phases.some((p) => p.name === "Discover and confirm findings"));
  const both = E.build(facts, { scenario: "expected", scope: "deeper_modernize_migrate" });
  assert.ok(both.phases.some((p) => p.name === "Application build") && both.phases.some((p) => p.name === "Cutover and go-live"));
});
