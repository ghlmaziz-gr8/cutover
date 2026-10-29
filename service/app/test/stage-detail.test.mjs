// Every stage on the path opens a detail panel: what the stage holds, and a button to change it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const guide = readFileSync(new URL("../guide.js", import.meta.url), "utf8");

test("each stage card opens a detail panel below the path, by click, Enter or Space", () => {
  assert.ok(html.includes('card.setAttribute("role", "button");'));
  assert.ok(html.includes('card.addEventListener("click", (e) => { if (!e.target.closest("button")) setOpen(s.id); });'));
  assert.ok(html.includes('if ((e.key === "Enter" || e.key === " ") && e.target === card)'));
  assert.ok(html.includes('detail.id = "stageDetail";'));
  assert.ok(html.includes("wrap.appendChild(detail);"));
});

test("the scope is listed after the approach on the path, and the plan waits for the scope", () => {
  const server = readFileSync(new URL("../../worker/src/index.mjs", import.meta.url), "utf8");
  const order = server.indexOf('{ id: "approach"');
  assert.ok(order > 0 && server.indexOf('{ id: "scope"') > order);
});

test("a stage's change button goes to the card that holds its choice", () => {
  assert.ok(html.includes('label: "Change the scope", run: () => goTo("scopeCard")'));
  assert.ok(html.includes('label: "Change the approach", run: () => goTo("approachCard")'));
  assert.ok(html.includes('label: "Open the plan on What next"'));
});

test("the change is in What's new", () => {
  assert.ok(guide.includes("2026-10-28: Each stage on the path is now clickable."));
});
