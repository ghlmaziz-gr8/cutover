// The module spec for an approved feature: shared rules, open questions, and the decisions before building.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "module-spec.js"), "utf8");
const pkg = readFileSync(join(here, "..", "package-builder.js"), "utf8");
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const root = {};
new Function("globalThis", src)(root);
const { build } = root.ModuleSpec;

const confidenceOf = () => ({ score: 80 });
const upload = {
  name: "Upload",
  summary: "Uploads",
  stories: [{ story: "As a user I can upload", rules: [{ file: "a.asp", id: "R1", lines: [1, 2] }] }],
  files: [{
    path: "a.asp",
    assessment: {
      rules: [{ id: "R1", statement: "A file is valid only if it was modified today", condition: "When verifying", outcome: "Returns true", lines: [1, 2] }],
      examples: [],
      functions: [],
      database: { tables: [], queries: [] },
      dropped: 0,
    },
  }],
};
const storage = { name: "Storage", stories: [{ story: "As a system I can save", rules: [{ file: "a.asp", id: "R1", lines: [1, 2] }] }], files: [] };

test("a rule that another feature also cites is listed under Shared rules", () => {
  const spec = build(upload, { app: "App", confidenceOf, allFeatures: [upload, storage] }).markdown;
  assert.match(spec, /## Shared rules/);
  assert.match(spec, /a\.asp · R1 is also used by Storage\. Keep one copy; the other module refers to it\./);
});

test("a rule that depends on the date the code runs is an open question, and a rule with no acceptance test is too", () => {
  const spec = build(upload, { app: "App", confidenceOf, allFeatures: [upload] }).markdown;
  assert.match(spec, /## Open questions/);
  assert.match(spec, /Confirm R1 in a\.asp: it depends on the date the code runs\./);
  assert.match(spec, /Add an acceptance test for R1 in a\.asp\./);
});

test("the decisions still open are listed before building", () => {
  const spec = build(upload, { app: "App", confidenceOf, allFeatures: [upload] }).markdown;
  assert.match(spec, /## Decisions before building/);
  assert.match(spec, /Target language: not chosen yet\. Decide it before building\./);
});

test("the target language and approach are used when chosen", () => {
  const spec = build(upload, { app: "App", confidenceOf, allFeatures: [upload], targetLanguage: "Java", targetChosenBy: "eng@x.test", approach: "Modernize" }).markdown;
  assert.match(spec, /Target language: Java \(chosen by eng@x\.test\)/);
  assert.match(spec, /Approach: Modernize/);
});

test("the package and the Download button pass the whole feature list and the target to the module spec", () => {
  assert.match(pkg, /allFeatures: data\.features,/);
  assert.match(pkg, /targetLanguage: ctx\.targetLanguage,/);
  assert.match(html, /allFeatures: data\.features,/);
});
