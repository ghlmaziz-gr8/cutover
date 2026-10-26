import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");

test("a file cannot be converted until a target language is chosen", () => {
  const start = src.indexOf("async function startConversion(request, env, id)");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(body.includes('if (!row.target_language) return json({ error: "Choose the target language first." }, 409);'));
});

test("the chosen language is sent to the conversion workflow and its name is checked", () => {
  assert.ok(src.includes("language: languageName, model_token") || src.includes("language: languageName,"));
  assert.ok(src.includes("if (!/^[A-Za-z0-9 #.()+\\/-]{1,80}$/.test(languageName))"));
  const wf = readFileSync(new URL("../../../.github/workflows/convert.yml", import.meta.url), "utf8");
  assert.ok(wf.includes("language:"));
  assert.ok(wf.includes('--language "$TARGET_LANGUAGE"'));
});
