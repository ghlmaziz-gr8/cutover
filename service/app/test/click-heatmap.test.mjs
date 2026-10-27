// Where people click: the tracker keeps positions and button ids only; the heat map is for workspace admins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const tracker = html.slice(html.indexOf("  const CLICK_FLUSH_MS"), html.indexOf("  async function loadHeatmap()"));
const drawing = html.slice(html.indexOf("  async function loadHeatmap()"), html.indexOf("  $(\"heatLoad\").addEventListener"));

test("the card is shown only to workspace admins on the Workspaces tab", () => {
  assert.match(html, /const heatHere = !!\(ws && ws\.is_admin && homeTab === "workspaces"\);/);
  assert.match(html, /\$\("heatCard"\)\.hidden = !heatHere;/);
});

test("the tracker sends the screen, the position, the width class and a button id, and nothing else", () => {
  assert.match(tracker, /clickBuffer\.push\(\{ screen: screen\.id, x, y, width: clickWidth\(\), target: clickName\(e\.target\) \}\)/);
  assert.doesNotMatch(tracker, /textContent|innerText|\.value\b|user_id|email/);
});

test("a button id must match the safe pattern before it is sent", () => {
  assert.match(tracker, /const CLICK_ID = \/\^\[a-z0-9-\]\{1,40\}\$\//);
  assert.match(tracker, /return CLICK_ID\.test\(raw\) \? raw : null;/);
});

test("clicks are sent to the click endpoint with the workspace, and only with a signed-in session", () => {
  assert.match(tracker, /if \(!token \|\| !ws \|\| !ws\.id\) return;/);
  assert.match(tracker, /fetch\(`\$\{cfg\.API_BASE\}\/api\/clicks`/);
  assert.match(tracker, /body: JSON\.stringify\(\{ workspace_id: ws\.id, events \}\)/);
});

test("the heat map is read from the admin endpoint and written as plain text", () => {
  assert.match(drawing, /api\(`\/api\/workspaces\/\$\{ws\.id\}\/heatmap\?screen=/);
  assert.doesNotMatch(drawing, /innerHTML\s*=\s*`/);
  assert.doesNotMatch(html.slice(html.indexOf("  // ---- Where people click"), html.indexOf("  // The database size against")), /insertAdjacentHTML/);
});

test("the change is listed in What's new, with the privacy limit", () => {
  assert.match(guide, /Where people click, on the Workspaces tab/);
  assert.match(guide, /It records only where a click landed on the screen and the id of the button used/);
});
