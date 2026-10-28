// The live card for a deep run starts with the connection to the model, and ticks it only when the runner reports it. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const wait = html.slice(html.indexOf("  function deepWait(a, opts = {}) {"), html.indexOf("  // The confidence halo"));

test("the deep card has a connection step first, shown only for the deep run", () => {
  assert.ok(wait.includes('const connectItem = opts.connection ? el("li", "Connected to the AI engine") : null;'));
  assert.ok(html.includes("waitCard = deepWait(a, { connection: true });"));
});

test("until the runner reports the connection, the card says so and ticks nothing else", () => {
  assert.ok(wait.includes("const connected = !!(progress && progress.connected_at);"));
  assert.ok(wait.includes('stageText.textContent = "Connecting to the AI engine";'));
  assert.ok(wait.includes("stageItems.forEach((li) => { li.className = \"\"; });"));
});

test("the runner marks the size report as connected, and the Worker keeps that time", () => {
  const runner = readFileSync(join(here, "..", "..", "..", "engine", "deep_file_run.py"), "utf8");
  assert.ok(runner.includes('{**payload, "connected": True}'));
  const worker = readFileSync(join(here, "..", "..", "worker", "src", "index.mjs"), "utf8");
  assert.ok(worker.includes("connected_at: now"));
});
