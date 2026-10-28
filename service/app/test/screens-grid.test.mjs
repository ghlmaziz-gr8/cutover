// Every AI-drawn screen is shown, each with a PNG download. The frames stay sandboxed. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

test("every screen is shown in a grid, not one at a time", () => {
  const block = html.slice(html.indexOf("// Every screen is shown, each in its own frame"), html.indexOf("out.push(c);", html.indexOf("// Every screen is shown, each in its own frame")));
  assert.ok(block.includes("for (const sc of screens)"));
  assert.ok(block.includes('el("div", null, "screen-grid")'));
  assert.ok(!block.includes("dp-tabs"));
});

test("each screen can be downloaded as a PNG, and the drawing fetches nothing", () => {
  const block = html.slice(html.indexOf("// Every screen is shown, each in its own frame"), html.indexOf("out.push(c);", html.indexOf("// Every screen is shown, each in its own frame")));
  assert.ok(block.includes('"Download PNG"'));
  assert.ok(block.includes("screenPng(sc.html)"));
  assert.ok(block.includes('frame.setAttribute("sandbox", "")'));
  const fn = html.slice(html.indexOf("  function screenPng(html) {"), html.indexOf("  // Whether the workspace's own model may draw screens."));
  assert.ok(fn.includes('doc.querySelectorAll("script,link,iframe,object,embed,base,meta")'));
  assert.ok(fn.includes("attachShadow"));
  assert.ok(fn.includes("toBlob"));
});
