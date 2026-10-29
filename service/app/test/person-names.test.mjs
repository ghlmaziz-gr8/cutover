// Each step shows who did it by name, with the email beside it, when the workspace has the name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../../worker/src/index.mjs", import.meta.url), "utf8");

test("the page builds the name and email label for each step", () => {
  assert.ok(html.includes("function personLabel(email)"));
  assert.ok(html.includes("personLabel(cur.scope_set_by_email)"));
  assert.ok(html.includes("personLabel(s.cleared_by)"));
});

test("the analysis carries the names of the workspace's members", () => {
  assert.ok(worker.includes("members?workspace_id=eq.${row.workspace_id}&select=user_id,email,name"));
  assert.ok(worker.includes("    started_by_email: startedBy,\n  });"));
});
