// Pressing Run deep assessment keeps the page where it is, and brings the running card into view. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

test("the file map stays on screen while it reloads", () => {
  const fn = html.slice(html.indexOf("  async function renderBusinessFiles() {"), html.indexOf("  // After an approve or discard"));
  assert.ok(fn.indexOf("box.replaceChildren();\n    drawMap(") > fn.indexOf("await loadDeepLinks()"), "cleared only after the data arrives");
  assert.ok(!fn.includes("box.replaceChildren();\n    if (!rows.length) return;"));
});

test("after Run deep assessment, the running card is brought into view", () => {
  const start = html.slice(html.indexOf("Started. The live view below follows the assessment"), html.indexOf("refresh.addEventListener(\"click\", async () => {", html.indexOf("Started. The live view below follows the assessment")));
  assert.ok(start.includes("await load();"));
  assert.ok(!start.includes("renderBusinessFiles()"), "the map is not redrawn when a run starts");
  assert.ok(start.includes('panel.querySelector(".dw-card")'));
  assert.ok(start.includes("scrollIntoView"));
});
