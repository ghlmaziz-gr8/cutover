import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");

test("a file cannot be converted until a target language is chosen", () => {
  const start = src.indexOf("async function startConversion(request, env, id)");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(body.includes('if (!row.target_language) return json({ error: "Choose the target language first." }, 409);'));
});
