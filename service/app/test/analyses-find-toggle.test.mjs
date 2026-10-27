// The search and filters on the Analyses list are hidden until the person asks to find an assessment. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

test("the filter block starts hidden and is opened by the Find an assessment button", () => {
  assert.ok(html.includes('<div class="list-tools" id="listTools" hidden'));
  assert.ok(html.includes('id="findToggle"'));
  assert.ok(html.includes('$("findToggle").addEventListener("click"'));
  assert.ok(html.includes('$("listTools").hidden = !open;'));
});
