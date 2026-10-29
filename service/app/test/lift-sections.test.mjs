// Run as is, in containers changes no code, so its page leaves out the look, the page flow and the screen layouts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../templates/preview.js", import.meta.url), "utf8");

test("the look, page flow and wireframes are not shown for Run as is, in containers", () => {
  assert.ok(src.includes('if (id !== "lift-contain") {'));
  const block = src.slice(src.indexOf('if (id !== "lift-contain") {'), src.indexOf("wrap.appendChild(frames);"));
  assert.ok(block.includes('section("How it could look")') && block.includes('section("Page flow")') && block.includes('section("Wireframes")'));
});
