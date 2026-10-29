// Run as is, in containers changes no code, so its page leaves out the look, the page flow and the screen layouts.
// Services over a modern database keeps the same screens, so it leaves out the look and calls its layouts conceptual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../templates/preview.js", import.meta.url), "utf8");

test("the look is shown only for the web front end, and the page flow and layouts are not shown for Run as is, in containers", () => {
  assert.ok(src.includes('if (id === "web-modern") {'));
  assert.ok(src.includes('if (id !== "lift-contain") {'));
  const look = src.slice(src.indexOf('if (id === "web-modern") {'), src.indexOf('if (id !== "lift-contain") {'));
  assert.ok(look.includes('section("How it could look")') && !look.includes('section("Wireframes")'));
});

test("the services over a database layouts are called conceptual wireframes for data flow", () => {
  assert.ok(src.includes('section(id === "services-data" ? "Conceptual wireframes for data flow" : "Wireframes")'));
});
