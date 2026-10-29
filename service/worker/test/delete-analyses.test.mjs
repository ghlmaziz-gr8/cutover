// Deleting analyses: the list says which ones you may delete, and a running analysis is not deleted under its run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");

test("the list says whether you may delete each analysis: its starter, or a workspace admin", () => {
  assert.ok(src.includes("can_delete: isMine || isAdmin"));
});

test("an analysis that is still queued or running is not deleted", () => {
  const start = src.indexOf("async function deleteAnalysis(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(body.includes('access.row.status === "queued" || access.row.status === "running"'));
  assert.ok(body.indexOf("still running") < body.indexOf("recordDeletion("), "the check comes before anything is removed");
});

test("the deletion removes the uploaded code and the analysis, and the child data goes with it by cascade", () => {
  const start = src.indexOf("async function deleteAnalysis(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(body.includes("deleteSourceFile(env, access.row)"));
  assert.ok(body.includes("analyses?id=eq.${id}"));
});
