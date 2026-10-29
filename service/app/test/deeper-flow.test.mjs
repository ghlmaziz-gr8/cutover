// The deeper assessment comes between Review findings and Next steps. Modernize and Migrate wait for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const guide = readFileSync(new URL("../guide.js", import.meta.url), "utf8");

test("Review findings goes to the deeper assessment, not straight to Next steps", () => {
  assert.ok(html.includes('$("toNext").addEventListener("click", () => showNext());'));
  assert.ok(html.includes('next.addEventListener("click", () => showDeeper());'));
  assert.ok(!html.includes('$("toNext").addEventListener("click", () => showDeeper());'));
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

test("the four scope options are offered before the deeper assessment runs, and the deeper lock still opens the deeper page", () => {
  assert.ok(!html.includes("if (o.needsDeeper && !deeperDone) continue;"));
  assert.ok(html.includes('key: "deeper_modernize_migrate"'));
  assert.ok(html.includes('$("scopeLockBox").hidden = deeperDone;'));
  assert.ok(!html.includes("Locked until the deeper assessment is complete"));
});

test("the tech stack and the estimate and plan are chosen on What next, not on the deeper assessment page", () => {
  const deeper = html.slice(html.indexOf('<section id="s-deeper"'), html.indexOf('<script', html.indexOf('<section id="s-deeper"')));
  assert.ok(!deeper.includes('id="targetCard"') && !deeper.includes('id="effortCard"'));
  const next = html.slice(html.indexOf('id="s-next"'), html.indexOf('<!-- 9. Contingency planning -->'));
  assert.ok(next.includes('id="targetCard"') && next.includes('id="effortCard"'));
  assert.ok(next.indexOf('id="targetCard"') < next.indexOf('id="effortCard"'), "the tech stack comes before the estimate");
});

test("the same estimate and plan follow every scope: the approach's rates with Modernize, lift and contain otherwise", () => {
  assert.ok(html.includes("function effortTemplateOf(row)"));
  assert.ok(html.includes('return "lift-contain";'));
  assert.ok(html.includes("const show = !!row && !!row.scope && !!window.Effort;"));
  assert.ok(html.includes("template: effortTemplateOf(row),"));
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

test("What next opens from the Review screen, so the scope is chosen before the deeper assessment", () => {
  const review = html.slice(html.indexOf('<section id="s-review"'), html.indexOf('<section id="s-deeper"') > 0 ? html.indexOf('<section id="s-deeper"') : html.length);
  assert.ok(review.includes('id="toNext"') && review.includes('id="toNextTop"'));
  assert.ok(!review.includes('id="toWhatNext"') && !review.includes("Deeper assessment</button>"));
  assert.ok(!html.includes('$("toWhatNext")'));
});

test("the scope options all draw: no check reads an undefined variable, which stopped the loop after the first option", () => {
  const start = html.indexOf("function renderScope()");
  const body = html.slice(start, html.indexOf("const CLOUD_OPTS", start));
  assert.ok(!body.includes("!locked"), "renderScope must not read the undefined locked variable");
});

test("the approach card points to What next instead of saying coming soon", () => {
  assert.ok(html.includes("Choose one of the three proposals on What next, under the scope."));
  assert.ok(html.includes('document.getElementById("approachCard")?.scrollIntoView'));
});

test("a stage outside the scope shows as not in scope, and the count leaves it out", () => {
  assert.ok(html.includes('skipped: "Not in scope"'));
  assert.ok(html.includes("const counted = stages.filter((s) => s.state !== \"skipped\").length;"));
});

test("a skipped approach points to the scope card to add Modernize", () => {
  assert.ok(html.includes('const add = el("button", "Add Modernize to the scope");'));
  assert.ok(html.includes('document.getElementById("scopeCard")?.scrollIntoView'));
});

test("choosing or clearing the scope redraws What next, and the scope can be cleared", () => {
  assert.ok(html.includes('id="scopeClear"'));
  assert.ok(html.includes('$("scopeClear").addEventListener("click", () => setScope(null));'));
  const start = html.indexOf("  async function setScope(key) {");
  const body = html.slice(start, html.indexOf("\n  }\n", start));
  assert.ok(body.includes("showNext();"), "setScope redraws every card, not only the scope");
});

test("the Modernize path sits above the scope card on What next", () => {
  const modern = html.indexOf('id="groupModernize"');
  const scope = html.indexOf('id="scopeCard"');
  assert.ok(modern > 0 && scope > 0 && modern < scope, "the Modernize path comes before Choose the scope");
});

test("every role can choose the approach, and the map fades the two it did not pick", () => {
  assert.ok(html.includes("Any role can choose it for now."));
  assert.ok(html.includes("if (choosable && row) {"));
  assert.ok(html.includes('box.classList.toggle("has-choice", !!chosenId);'));
  assert.ok(html.includes('bg.setAttribute("opacity", "0.3");'));
  assert.ok(!html.includes("if (cur.can_plan) await chooseTemplate"));
});
