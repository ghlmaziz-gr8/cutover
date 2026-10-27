// The file map shows each file's deep state, and the deep view opens under a file. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
function loadFileMap() {
  const sandbox = {};
  vm.runInNewContext(readFileSync(join(here, "..", "file-map.js"), "utf8"), sandbox);
  return sandbox.FileMap;
}
const html = readFileSync(join(here, "..", "index.html"), "utf8");

test("a deep state replaces the conversion status on the map", () => {
  const fileMap = loadFileMap();
  const tree = fileMap.tree({
    label: "x",
    files: [{ path: "src/A.asp" }, { path: "src/B.asp" }],
    conversions: [],
    deep: { "src/A.asp": { state: "running" }, "src/B.asp": { state: "draft" } },
  });
  const leaves = tree.children.flatMap((c) => c.children || [c]);
  const labels = leaves.map((l) => l.label);
  assert.ok(labels.some((l) => l.endsWith("A.asp · Assessing")), labels.join(" | "));
  assert.ok(labels.some((l) => l.endsWith("B.asp · Draft ready")), labels.join(" | "));
});

test("without a deep state, the conversion status stays", () => {
  const fileMap = loadFileMap();
  const tree = fileMap.tree({ label: "x", files: [{ path: "src/C.asp" }], conversions: [], deep: {} });
  const leaf = tree.children[0].children ? tree.children[0].children[0] : tree.children[0];
  assert.ok(leaf.label.endsWith("C.asp · Not started"));
});

test("the states are read from the summary, for engineers, and the map is redrawn when a run ends", () => {
  assert.ok(html.includes("api(`/api/analyses/${cur.id}/deep-files/summary`)"));
  assert.ok(html.includes("if (wasRunning && !running && businessFiles.analysis === cur.id) renderBusinessFiles();"));
});
