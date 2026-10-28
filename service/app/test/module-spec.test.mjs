// The module spec: one approved feature, with its stories, rules, functions, data, acceptance tests and confidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const load = (file) => {
  const sandbox = {};
  vm.runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), sandbox);
  return sandbox;
};
const { ModuleSpec } = load("module-spec.js");
const { Confidence } = load("confidence.js");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const feature = {
  name: "Ordering & checkout",
  summary: "Takes and checks orders.",
  files: [{
    path: "src/Orders.asp",
    purpose: "Takes orders.",
    assessment: {
      dropped: 1,
      functions: [{ name: "SaveOrder", purpose: "Stores an order.", calls: ["CheckCustomer"] }],
      rules: [{ id: "R1", statement: "An order needs a customer.", condition: "a customer is given", outcome: "the order is refused", function: "SaveOrder", lines: [4, 9] }],
      examples: [{ rule: "R1", given: "no customer", expect: "refused" }],
      database: { tables: [{ name: "orders", operations: ["INSERT"], fields: ["customer_id"] }], queries: [{ function: "SaveOrder", operation: "INSERT", tables: ["orders"] }] },
    },
  }, { path: "src/Pending.asp", purpose: "", assessment: null }],
  stories: [{ id: "S1", story: "As a clerk I can place an order so that it is checked.", rules: [{ file: "src/Orders.asp", id: "R1", lines: [4, 9], current: true }] }],
};
const ctx = { app: "ManageIT", approvedBy: "cio@acme.test", approvedAt: "2026-10-27T20:00:00Z", confidenceOf: Confidence.confidenceOf };

test("the spec names the feature, the approval, and that it is sample data only", () => {
  const { markdown, file } = ModuleSpec.build(feature, ctx);
  assert.match(markdown, /^# Module: Ordering & checkout/m);
  assert.match(markdown, /Approved by: cio@acme\.test on 2026-10-27/);
  assert.match(markdown, /Sample data only/);
  assert.equal(file, "module-ordering-checkout.md");
});

test("each story carries its rule and lines, and each rule has its source lines and conditions", () => {
  const { markdown } = ModuleSpec.build(feature, ctx);
  assert.match(markdown, /- As a clerk I can place an order so that it is checked\.\n  - Rule R1 in src\/Orders\.asp \(lines 4–9\)/);
  assert.match(markdown, /### src\/Orders\.asp · R1\n\nAn order needs a customer\.\n\n- When: a customer is given\n- Then: the order is refused\n- Function: SaveOrder\n- Source lines: 4–9 in src\/Orders\.asp/);
});

test("functions, data and worked examples become acceptance tests", () => {
  const { markdown } = ModuleSpec.build(feature, ctx);
  assert.match(markdown, /- SaveOrder \(src\/Orders\.asp\): Stores an order\. — calls CheckCustomer/);
  assert.match(markdown, /- Table orders \(src\/Orders\.asp\): INSERT; fields customer_id/);
  assert.match(markdown, /- INSERT in SaveOrder on orders \(src\/Orders\.asp\)/);
  assert.match(markdown, /- Rule R1 \(src\/Orders\.asp\)\n  - Given: no customer\n  - Expect: refused/);
});

test("a file with no approved assessment is marked and does not count toward confidence", () => {
  const { markdown } = ModuleSpec.build(feature, ctx);
  assert.match(markdown, /- src\/Pending\.asp: no approved assessment yet/);
  const score = Confidence.confidenceOf({ functions: feature.files[0].assessment.functions, rules: feature.files[0].assessment.rules, examples: feature.files[0].assessment.examples }, 1).score;
  assert.match(markdown, new RegExp(`Confidence: (High|Medium|Low) \\(${score}\\)`));
});

test("names left out of the assessment are said in the limits section", () => {
  const { markdown } = ModuleSpec.build(feature, ctx);
  assert.match(markdown, /src\/Orders\.asp: 1 name was left out, not found in the code\./);
});

test("the download button sits on each approved feature and uses the module builder", () => {
  assert.match(html, /<script src="module-spec\.js"><\/script>/);
  assert.match(html, /ModuleSpec\.build\(f, \{/);
  assert.match(html, /Download module spec/);
});
