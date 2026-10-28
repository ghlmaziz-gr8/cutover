// A failed business run says so with its reason, and a business run shows the connection step. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const biz = html.slice(html.indexOf("  function bizCard(a, reload, msg) {"), html.indexOf("  // Replaces one file's purpose"));

test("a failed business run says the AI assessment failed, with the reason and how to try again", () => {
  assert.ok(biz.includes('a.review_status === "failed"'));
  assert.ok(biz.includes("The AI assessment for the business failed."));
  assert.ok(biz.includes("a.content.failure.reason"));
  assert.ok(biz.includes("Press Assess for the business to try again."));
  assert.ok(html.includes('failed: "Failed" };'));
});

test("a business run shows the connection step first", () => {
  assert.ok(html.includes("{ fallbackSeconds: BIZ_FALLBACK_SECONDS, connection: true }"));
});

test("the runner and the Worker report the connection for business runs, and keep the failure", () => {
  const runner = readFileSync(join(here, "..", "..", "..", "engine", "business_run.py"), "utf8");
  assert.ok(runner.includes("/business-progress"));
  assert.ok(runner.includes("explain_failure(err)"));
  const worker = readFileSync(join(here, "..", "..", "worker", "src", "index.mjs"), "utf8");
  assert.ok(worker.includes("/business-progress$/"));
  assert.ok(worker.includes('review_status: "failed"'));
});
