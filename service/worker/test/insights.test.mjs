// The insights are counts only, for members of the workspace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");

test("the insights route is open to members of the workspace and returns counts", () => {
  assert.ok(src.includes('if (path === "/api/insights" && method === "GET") return workspaceInsights(request, env);'));
  const start = src.indexOf("async function workspaceInsights(");
  const body = src.slice(start, src.indexOf("\n// ---- Notifications", start));
  assert.ok(body.includes("workspaceAccess(env, request"), "membership is checked");
  assert.ok(!/select=[^`"&]*\b(source_path|purpose|suggestions|findings)\b/.test(body), "no code or findings are selected");
  assert.ok(body.includes('prefer: "count=exact"'), "file counts are counted in the database, not fetched");
});
