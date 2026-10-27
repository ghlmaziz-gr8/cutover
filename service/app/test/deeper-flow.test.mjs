// The deeper assessment comes between Review findings and Next steps. Modernize and Migrate wait for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const guide = readFileSync(new URL("../guide.js", import.meta.url), "utf8");

test("Review findings goes to the deeper assessment, not straight to Next steps", () => {
  assert.ok(html.includes('$("toNext").addEventListener("click", () => showDeeper());'));
  assert.ok(html.includes('next.addEventListener("click", () => showDeeper());'));
  assert.ok(!html.includes('$("toNext").addEventListener("click", () => showNext());'));
});

test("Next steps can only be reached from the deeper assessment, once one of its views is opened", () => {
  assert.ok(html.includes('$("deeperNext").disabled = !(ready && opened);'));
  assert.ok(html.includes('$("deeperNextBottom").disabled = !(ready && opened);'));
  assert.ok(html.includes("const opened = lensState.analysis === cur.id && lensState.opened;"));
});

test("the three deeper assessments are data, business and system, each showing its part of the report", () => {
  const block = html.slice(html.indexOf("const LENSES = ["), html.indexOf("];", html.indexOf("const LENSES = [")));
  assert.ok(block.includes('key: "data"') && block.includes('sections: ["data"]'));
  assert.ok(block.includes('key: "business"') && block.includes('sections: ["business", "workflows"]'));
  assert.ok(block.includes('key: "system"') && block.includes('sections: ["systems"], arch: true'));
  assert.ok(html.includes("(deeper.sections || []).filter((x) => !!lens && lens.sections.includes(x.id))") && html.includes("arch.hidden = !(lens && lens.arch);"));
});

test("Modernize and Migrate are not drawn until the deeper assessment is done", () => {
  assert.ok(html.includes("if (o.needsDeeper && !deeperDone) continue;"));
  assert.ok(html.includes('$("scopeLockBox").hidden = deeperDone;'));
  assert.ok(!html.includes("Locked until the deeper assessment is complete"));
});

test("the target language and effort plan sit on the deeper assessment page, not on Next steps", () => {
  const deeper = html.slice(html.indexOf('<section id="s-deeper"'), html.indexOf('<script', html.indexOf('<section id="s-deeper"')));
  assert.ok(deeper.includes('id="targetCard"') && deeper.includes('id="effortCard"'));
  const next = html.slice(html.indexOf('id="s-next"'), html.indexOf('<!-- 9. Contingency planning -->'));
  assert.ok(!next.includes('id="targetCard"') && !next.includes('id="effortCard"'));
});

test("the header counts the deeper assessment as its own step and the weights still add up to 100", () => {
  const block = html.slice(html.indexOf("const STAGES = ["), html.indexOf("];", html.indexOf("const STAGES = [")));
  const weights = [...block.matchAll(/w: (\d+)/g)].map((m) => Number(m[1]));
  assert.equal(weights.reduce((a, b) => a + b, 0), 100);
  assert.ok(block.includes('id: "s-deeper"'));
});

test("the change is in the what's new list", () => {
  assert.ok(guide.includes("2026-10-27: After Review findings comes the deeper assessment"));
});

test("the business view shows every file as a tree, and only that view does", () => {
  assert.ok(html.includes('$("deeperFiles").hidden = !businessView;'));
  assert.ok(html.includes("if (businessView) renderBusinessFiles();"));
  assert.ok(html.includes("window.FileMap.tree({ label: \"Files in the application\", files: rows, conversions: cur.conversions || [], deep })"));
  assert.ok(html.includes("onLeaf: (node) => showBusinessFile(node.path),"));
});

test("the files are loaded once per analysis, through the existing files list", () => {
  assert.ok(html.includes("if (businessFiles.analysis !== cur.id) {"));
  assert.ok(html.includes("businessFiles = { analysis: cur.id, rows: await loadFiles() };"));
});
