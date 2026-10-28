// The model of an analysis can be switched from the Deep view panel. Text only, never markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
// The model picker is shared by the Business and Deep views: it lives in analysisModelRow.
const panel = html.slice(html.indexOf("  function analysisModelRow(msg) {"), html.indexOf("  function deepPanel(li, f, onClose"));

test("the panel lists the workspace's active model keys", () => {
  assert.ok(panel.includes("api(`/api/workspaces/${ws.id}/model-keys`)"));
  assert.ok(panel.includes("loadModels();"));
});

test("choosing a model in the list applies it, with no separate button", () => {
  assert.ok(panel.includes('modelPick.addEventListener("change"'));
  assert.ok(panel.includes("api(`/api/analyses/${cur.id}/model`, { method: \"PATCH\", body: JSON.stringify({ model_key_id: modelPick.value }) })"));
  assert.ok(panel.includes("Model set to ${res.label}. You can run the assessment now."));
  assert.ok(!panel.includes("Use this model"));
});

test("the list shows the analysis's own key, and asks for a choice when that key is no longer set up", () => {
  assert.ok(panel.includes("modelPick.value = cur.model_key_id || \"\";"));
  assert.ok(panel.includes('appendChild(el("option", "Choose a model"))'));
});
