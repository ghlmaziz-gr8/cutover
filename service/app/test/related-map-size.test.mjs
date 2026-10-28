// The related-files map grows with the number of related files, up to a limit. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

test("the map's width follows the number of related files, with a floor and a cap", () => {
  assert.ok(html.includes("Math.min(620, Math.max(400, 320 + 60 * near.length))"));
  assert.ok(html.includes("grid-template-columns:minmax(260px,var(--chord-w,400px)) minmax(0,1fr)"));
  assert.ok(!html.includes(".rel-chord svg{width:100%;max-width:400px"));
});
