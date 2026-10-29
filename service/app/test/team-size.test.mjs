// The team card shows the team size that was chosen, when the roles allow it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../effort.js", import.meta.url), "utf8"), sandbox);
const E = sandbox.Effort;
const facts = { template: "web-modern", screens: 40, endpoints: 20, controllers: 6, tables: 25, roles: 4, sourceFiles: 300, targetLanguage: "python", targetMatchesLegacy: false, hasIac: true, hasCi: true };

test("the team is the size chosen, for each size in the dropdown", () => {
  for (const n of [4, 6, 8, 10]) {
    const est = E.build(facts, { scenario: "expected", teamSize: n });
    assert.equal(est.headcount, n, `chosen ${n}`);
  }
});

test("without a chosen size, the team is the one the build sizes", () => {
  const auto = E.build(facts, { scenario: "expected" });
  assert.ok(auto.headcount >= 2);
});
