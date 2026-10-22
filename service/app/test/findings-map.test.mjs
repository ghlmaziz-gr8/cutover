// Run: node --test service/app/test/findings-map.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../findings-map.js", import.meta.url), "utf8"), sandbox);
const { tree } = sandbox.FindingsMap;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const item = (title, extra = {}) => ({ title, severity: "low", confidence: "verified", detail: "", ...extra });

test("each review card is a branch, in the order given", () => {
  const map = tree({ cards: [
    { id: "a", title: "What it is", visible: true, items: [item("Screens")] },
    { id: "b", title: "Its data", visible: true, items: [item("Tables")] },
  ] });
  assert.equal(map.kind, "root");
  assert.equal(JSON.stringify(map.children.map((c) => c.label)), JSON.stringify(["What it is", "Its data"]));
});

test("findings are split into verified and inferred, with their own icons", () => {
  const map = tree({ cards: [{ id: "a", title: "X", visible: true, items: [
    item("One"), item("Two", { confidence: "inferred" }),
  ] }] });
  const groups = map.children[0].children;
  assert.equal(JSON.stringify(groups.map((g) => g.label)), JSON.stringify(["Verified in code", "Inferred, needs review"]));
  assert.equal(groups[0].children[0].label, "One");
  assert.equal(groups[1].children[0].label, "Two");
});

test("the branch colour follows the worst severity in the card", () => {
  const map = tree({ cards: [
    { id: "a", title: "High", visible: true, items: [item("x", { severity: "low" }), item("y", { severity: "high" })] },
    { id: "b", title: "Mid", visible: true, items: [item("x", { severity: "medium" })] },
    { id: "c", title: "None", visible: true, items: [] },
  ] });
  assert.equal(map.children[0].tone, "high");
  assert.equal(map.children[1].tone, "medium");
  assert.equal(map.children[2].tone, "clear");
  assert.equal(map.children[2].fitText, "Nothing detected");
});

test("a card the viewer may not see shows no findings", () => {
  const map = tree({ cards: [{ id: "p", title: "Personal data", visible: false, items: [item("secret")] }] });
  assert.equal(map.children[0].fitText, "Not shown for your role");
  assert.equal(map.children[0].children.length, 0);
});

test("the meter counts verified findings, and is left out above ten", () => {
  const few = tree({ cards: [{ id: "a", title: "A", visible: true, items: [item("1"), item("2", { confidence: "inferred" })] }] });
  assert.equal(few.children[0].score, 1);
  assert.equal(few.children[0].max, 2);
  const many = tree({ cards: [{ id: "a", title: "A", visible: true, items: Array.from({ length: 12 }, (_, i) => item(`f${i}`)) }] });
  assert.equal(many.children[0].max, 0);
  assert.equal(many.children[0].meterLabel, "12 of 12 verified in code");
});

test("the page shows the findings map under the cards, using the same renderer", () => {
  assert.ok(html.includes('<script src="findings-map.js"></script>'));
  assert.ok(html.includes("function findingsMapSection("));
  assert.ok(html.includes("FindingsMap.tree("));
  assert.ok(html.includes("Findings map"));
  assert.ok(html.includes("box.appendChild(findingsMapSection(all, cur.viewer_role));"));
});
