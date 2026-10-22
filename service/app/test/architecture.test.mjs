// Run: node --test service/app/test/architecture.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../architecture.js", import.meta.url), "utf8"), sandbox);
const { build } = sandbox.Architecture;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("layers are ordered from users down to hosting, whatever order they arrive in", () => {
  const boxes = build([
    { layer: "Data", detail: "3 tables", basis: "data.tables" },
    { layer: "Users", detail: "Admin", basis: "ui.roles" },
    { layer: "Hosting", detail: "containers", basis: "containers.images" },
    { layer: "Services", detail: "41 endpoints", basis: "ui.endpoints" },
  ], {});
  assert.equal(JSON.stringify(boxes.map((b) => b.layer)), JSON.stringify(["Users", "Services", "Data", "Hosting"]));
  assert.equal(boxes[3].band, true);
  assert.equal(boxes[0].band, false);
});

test("each box names its source finding and whether it is verified in code", () => {
  const boxes = build([{ layer: "Data", detail: "3 tables", basis: "data.tables" }], {
    "data.tables": { title: "Tables in the migrations", confidence: "verified" },
  });
  assert.equal(boxes[0].source, "Tables in the migrations");
  assert.equal(boxes[0].confidence, "verified");
});

test("an inferred source is shown as inferred, and a missing one as unknown", () => {
  const boxes = build([
    { layer: "Users", detail: "Admin", basis: "ui.roles" },
    { layer: "Screens", detail: "2 screens", basis: "ui.screens" },
  ], { "ui.roles": { title: "Roles named in access rules", confidence: "inferred" } });
  assert.equal(boxes[0].confidence, "inferred");
  assert.equal(boxes[1].confidence, "unknown");
  assert.equal(boxes[1].source, null, "a source the viewer cannot see is not named");
});

test("no layers gives no boxes", () => {
  assert.equal(build(undefined, {}).length, 0);
});

test("the page draws the diagram right after What we found, and before the findings map", () => {
  assert.ok(html.includes('<script src="architecture.js"></script>'));
  assert.ok(html.includes("function architectureSection("));
  assert.ok(html.includes("Architecture.build("));
  const grid = html.indexOf("box.appendChild(grid);");
  const arch = html.indexOf("box.appendChild(architectureSection(");
  const map = html.indexOf("box.appendChild(findingsMapSection(all, cur.viewer_role));");
  assert.ok(grid > 0 && arch > grid && map > arch, "order: what we found, architecture, findings map");
});
