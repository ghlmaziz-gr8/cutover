// Every AI-drawn screen is shown, each with a PNG download. The frames stay sandboxed. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

test("every screen is shown in a grid, not one at a time", () => {
  const block = html.slice(html.indexOf("function drawnScreensCard(screens)"), html.indexOf("  // A screen drawn by the model, as a PNG."));
  assert.ok(block.includes("for (const sc of screens)"));
  assert.ok(block.includes('el("div", null, "screen-grid")'));
  assert.ok(!block.includes("dp-tabs"));
});

test("each screen can be downloaded as a PNG, and the drawing fetches nothing", () => {
  const block = html.slice(html.indexOf("function drawnScreensCard(screens)"), html.indexOf("  // A screen drawn by the model, as a PNG."));
  assert.ok(block.includes('"Download PNG"'));
  assert.ok(block.includes("screenPng(sc.html)"));
  assert.ok(block.includes('frame.setAttribute("sandbox", "")'));
  const fn = html.slice(html.indexOf("  function screenPng(html) {"), html.indexOf("  // Whether the workspace's own model may draw screens."));
  assert.ok(fn.includes('doc.querySelectorAll("script,link,iframe,object,embed,base,meta")'));
  assert.ok(fn.includes("attachShadow"));
  assert.ok(fn.includes("toBlob"));
});

test("the screens show on the file-level results screen as well as the overview", () => {
  assert.ok(html.includes('<div id="filesScreens"></div>'));
  assert.ok(html.includes('screensBox.appendChild(drawnScreensCard(drawn))'));
  assert.ok(html.includes("const c = drawnScreensCard(screens);"));
});

test("an old business draft says it must be assessed again to see the rules", () => {
  assert.ok(html.includes("Made before the rules, checks and worked examples were added. Run the business assessment again to see them."));
});
