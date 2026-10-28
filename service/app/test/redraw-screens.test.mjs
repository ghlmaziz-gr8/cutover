// When an assessment drew no screens, a platform engineer can draw them again. The card says so; text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const card = html.slice(html.indexOf("    // Deep AI assessment results: screens the workspace's own model drew"), html.indexOf("    // Page previews: each page rendered"));

test("the no-screens card offers Draw the screens again to a platform engineer, for a finished assessment with a model", () => {
  assert.ok(card.includes("canActOnResults()"));
  assert.ok(card.includes('cur.status === "complete" || cur.status === "failed"'));
  assert.ok(card.includes("cur.model_provider && canActOnResults()"));
  assert.ok(card.includes("Draw the screens again"));
});

test("the button calls the redraw route and shows its message, and does not start a new assessment", () => {
  assert.ok(card.includes("`/api/analyses/${cur.id}/screens/redraw`"));
  assert.ok(card.includes("leaves the assessment as it is"));
  assert.ok(!card.includes("/rerun"));
});
