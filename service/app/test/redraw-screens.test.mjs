// Drawing the screens again: a platform engineer picks the model, sees the drawing while it runs, and the page
// shows the new screens when they are ready. The assessment itself is never re-run. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const card = html.slice(html.indexOf("    // Deep AI assessment results: screens the workspace's own model drew"), html.indexOf("    // Page previews: each page rendered"));
const helpers = html.slice(html.indexOf("  // A screens run that started within this window"), html.indexOf("  function componentCards(shown, history, role) {"));

test("the screens card offers the redraw to a platform engineer, with a model drawn from the model picker", () => {
  assert.ok(card.includes("canActOnResults()"));
  assert.ok(card.includes("cur.model_provider && canActOnResults()"));
  assert.ok(helpers.includes("analysisModelRow(status)"), "the model is chosen with the same picker as the other views");
  assert.ok(helpers.includes('"Draw the screens again"'));
});

test("the redraw is allowed only for a finished assessment, and it does not start a new assessment", () => {
  assert.ok(helpers.includes('cur.status === "complete" || cur.status === "failed"'));
  assert.ok(helpers.includes("`/api/analyses/${cur.id}/screens/redraw`"));
  assert.ok(!helpers.includes("/rerun"));
});

test("while the screens are drawn, the card shows the drawing and the page checks until they are ready", () => {
  assert.ok(card.includes('firstRunCard("Drawing the screens"'));
  assert.ok(helpers.includes("SCREENS_RUN_WINDOW_MS = 35 * 60 * 1000"));
  assert.ok(helpers.includes("screens_started_at"));
  assert.ok(helpers.includes("}, 15000);"));
  assert.ok(helpers.includes("(cur.screens || []).length !== before"));
});
