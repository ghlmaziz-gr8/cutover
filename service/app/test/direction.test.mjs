// The direction (scope and approach) is the owner's or a CIO's or CTO's choice. A CIO or CTO opens to the system assessment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the scope and the approach are open to every role for now", () => {
  assert.match(html, /const canChoose = true;/);
  assert.match(html, /if \(choosable && row\) \{/);
  assert.match(html, /Any role can choose it for now\./);
});

test("the target language stays with the engineer", () => {
  assert.match(html, /btn\.disabled = !row\.can_plan;/);
});

test("a CIO or CTO opens to the system assessment, and Show everything still shows all three", () => {
  assert.match(html, /if \(!lensState\.key && !lensState\.all && cur\.deeper_done === true && ws && ws\.role === "cio_cto"\) \{/);
  assert.match(html, /return LENSES\.find\(\(l\) => l\.key === "system"\) \|\| null;/);
  assert.match(html, /lensState = \{ analysis: cur\.id, key: null, opened: lensState\.opened, all: true \};/);
});
