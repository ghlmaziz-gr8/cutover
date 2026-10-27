// The model of an analysis can be switched from the Deep view panel. Text only, never markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const panel = html.slice(html.indexOf("  function deepPanel(li, f, onClose"), html.indexOf("  function businessPanel(li, f) {"));

test("the panel lists the workspace's active model keys", () => {
  assert.ok(panel.includes("api(`/api/workspaces/${ws.id}/model-keys`)"));
  assert.ok(panel.includes("loadModels();"));
});

test("Use this model sends the chosen key to the analysis, and the result is shown", () => {
  assert.ok(panel.includes("api(`/api/analyses/${cur.id}/model`, { method: \"PATCH\", body: JSON.stringify({ model_key_id: modelPick.value }) })"));
  assert.ok(panel.includes("Model changed to ${res.label}. You can run the assessment now."));
});
