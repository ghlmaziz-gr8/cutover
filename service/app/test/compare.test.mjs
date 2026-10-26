import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../compare.js", import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(src, sandbox);
const { changedLines } = sandbox.Compare;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("a line is marked when the other side does not have it", () => {
  assert.deepEqual(changedLines(["a", "b", "c"], ["a", "c", "d"]), [false, true, false]);
  assert.deepEqual(changedLines(["a", "c", "d"], ["a", "b", "c"]), [false, false, true]);
});

test("blank lines are never marked", () => {
  assert.deepEqual(changedLines(["a", "", "b"], ["a"]), [false, false, true]);
});

test("the comparison module is loaded with the page", () => {
  assert.ok(html.includes('<script src="compare.js"></script>'));
  assert.ok(html.includes("function renderComparison(row, c, card)"));
  assert.ok(html.includes("/conversions/original?path="));
  assert.ok(html.includes("Lines that changed are shaded."));
});
