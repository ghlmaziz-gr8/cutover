// The business card has the confidence halo, scored from the function names and their line numbers. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const confSrc = readFileSync(join(here, "..", "confidence.js"), "utf8");
const biz = html.slice(html.indexOf("  function bizCard(a, reload, msg) {"), html.indexOf("  // Replaces one file's purpose"));

function load() {
  const ctx = { globalThis: {} };
  vm.runInNewContext(confSrc, ctx);
  return ctx.globalThis.Confidence;
}

test("the business halo is scored from the names kept and the functions with line numbers", () => {
  const C = load();
  const full = C.businessConfidenceOf({ functions: [{ name: "a", lines: [1, 2] }, { name: "b", lines: [3, 4] }], dropped: 0 });
  assert.equal(full.parts.names, 100);
  assert.equal(full.parts.lines, 100);
  assert.equal(full.score, 100);
  assert.equal(full.band, "high");
  const weak = C.businessConfidenceOf({ functions: [{ name: "a", lines: null }, { name: "b", lines: null }], dropped: 2 });
  assert.equal(weak.parts.names, 50);
  assert.equal(weak.parts.lines, 0);
  assert.equal(weak.band, "low");
});

test("the card shows the halo and the dropped names, as the deep card does", () => {
  assert.ok(biz.includes("Confidence.businessConfidenceOf(content)"));
  assert.ok(biz.includes("deepHalo(conf.score, conf.band)"));
  assert.ok(biz.includes("Function names checked against the code:"));
  assert.ok(biz.includes("names were"));
});

test("an older draft without functions shows no halo", () => {
  assert.ok(biz.includes("if (Array.isArray(content.functions)) {"));
});
