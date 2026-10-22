// Run: node --test service/app/test/architecture.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../architecture.js", import.meta.url), "utf8"), sandbox);
const { build } = sandbox.Architecture;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const names = (boxes) => JSON.stringify(boxes.map((b) => b.layer));
const all = () => true;

test("layers are ordered from users down to hosting, whatever order they arrive in", () => {
  const boxes = build([
    { layer: "Data", detail: "3 tables", basis: "data.tables" },
    { layer: "Users", detail: "Admin", basis: "ui.roles" },
    { layer: "Hosting", detail: "containers", basis: "containers.images" },
    { layer: "Services", detail: "41 endpoints", basis: "ui.endpoints" },
    { layer: "Screens", detail: "2 screens", basis: "ui.screens" },
  ], {}, all);
  assert.equal(names(boxes), JSON.stringify(["Users", "Screens", "Services", "Data", "Hosting"]));
  assert.equal(boxes[4].band, true);
  assert.equal(boxes[0].band, false);
});

test("a layer that was not found is a placeholder, when the viewer may see it", () => {
  const boxes = build([{ layer: "Users", detail: "Admin", basis: "ui.roles" }], {}, all);
  const screens = boxes.find((b) => b.layer === "Screens");
  assert.equal(screens.missing, true);
  assert.equal(screens.detail, "Not found in the code");
  assert.equal(screens.confidence, "missing");
  assert.equal(boxes.length, 5);
});

test("a layer the viewer cannot see is left out, not shown as a placeholder", () => {
  const cannotSeeUi = (cat) => cat !== "ui_portal";
  const boxes = build([{ layer: "Data", detail: "3 tables", basis: "data.tables" }], {}, cannotSeeUi);
  assert.equal(names(boxes), JSON.stringify(["Data", "Hosting"]));
});

test("each box names its source finding and whether it is verified in code", () => {
  const boxes = build([{ layer: "Data", detail: "3 tables", basis: "data.tables" }], {
    "data.tables": { title: "Tables in the migrations", confidence: "verified" },
  }, all);
  const data = boxes.find((b) => b.layer === "Data");
  assert.equal(data.source, "Tables in the migrations");
  assert.equal(data.confidence, "verified");
});

test("an inferred source is shown as inferred, and a source not on the page as unknown", () => {
  const boxes = build([
    { layer: "Users", detail: "Admin", basis: "ui.roles" },
    { layer: "Screens", detail: "2 screens", basis: "ui.screens" },
  ], { "ui.roles": { title: "Roles named in access rules", confidence: "inferred" } }, all);
  assert.equal(boxes[0].confidence, "inferred");
  assert.equal(boxes[1].confidence, "unknown");
  assert.equal(boxes[1].source, null);
});

test("service names come through as items", () => {
  const boxes = build([{ layer: "Services", detail: "4 endpoints in 2 controllers", basis: "ui.endpoints", items: ["PortalController", "StaffController"] }], {}, all);
  assert.equal(JSON.stringify(boxes.find((b) => b.layer === "Services").items), JSON.stringify(["PortalController", "StaffController"]));
});

test("the page draws the diagram after What we found, with the placeholders and service names", () => {
  assert.ok(html.includes('<script src="architecture.js"></script>'));
  assert.ok(html.includes("function architectureSection("));
  assert.ok(html.includes("Architecture.build("));
  assert.ok(html.includes("arch-missing"));
  assert.ok(html.includes('el("ul", null, "arch-items")'));
  assert.ok(html.includes("architectureSection(report.deeper, Object.fromEntries(all.filter(Boolean).map((i) => [i.id, i])), cur.viewer_role)"));
  const heading = html.indexOf('el("h2", "What we found"');
  const map = html.indexOf("box.appendChild(findingsMapSection(all, cur.viewer_role));");
  const grid = html.indexOf("box.appendChild(grid);", heading);
  const arch = html.indexOf("box.appendChild(architectureSection(");
  // The findings map is its own section right under What we found, before the cards and the diagram.
  assert.ok(heading > 0 && map > heading && grid > map && arch > grid);
});

test("the architecture diagram is interactive: filters, selection, linked connectors and a detail panel", () => {
  assert.ok(html.includes('el("div", null, "arch-filters")'), "status filters");
  assert.ok(html.includes("Connects to:"), "the detail panel names the connected layers");
  assert.ok(html.includes('e.key === "Escape"'), "Escape clears the selection");
  assert.ok(html.includes('classList.toggle("is-lit"'), "connectors light up around the selected layer");
  assert.ok(!/\.arch-node\{[^}]*overflow:hidden/.test(html), "nodes do not clip their own height");
});

test("the confidence panel uses the animated view, with the ring, the rows and the count", () => {
  assert.ok(html.includes("confidenceChart(verified, all.length - verified)"));
  assert.ok(html.includes('"conf-ring"') && html.includes('"conf-row"') && html.includes("conf-center"));
});

test("links and domains have their own card, shown when found, and the same access as the worker", () => {
  assert.ok(html.includes('{ title: "Links and domains", cats: ["links"], onlyWhenFound: true }'));
  assert.ok(html.includes('security_officer: ["security", "privacy", "links"]'));
  assert.ok(html.includes('"links.domains": {') && html.includes('"links.credentials": {'));
});

test("every SVG element is created with an attribute object, so one bad call cannot stop the review from rendering", () => {
  assert.ok(!/svgEl\("[a-zA-Z]+"\)/.test(html), "svgEl needs an attribute object, even an empty one");
});

test("results show an animated AI badge only when an AI model was part of the assessment", () => {
  assert.ok(html.includes("if (row.model_provider) findingsHead.appendChild(aiBadge(row.model_provider));"));
  assert.ok(html.includes('"ai-badge"') && html.includes("@keyframes aiTwinkle"));
});

test("results always say whether an AI model was used, and recommend based on past assessments in the workspace", () => {
  assert.ok(html.includes("No AI model was used for this assessment. The findings come from the rules only."));
  assert.ok(html.includes("An AI model was used for this assessment: ${modelName}."));
  assert.ok(html.includes("Recommendation: decide per assessment."));
});
