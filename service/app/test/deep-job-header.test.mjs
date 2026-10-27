// Each deep file run shows a job header: a colour-coded status, the job id, and when it started, finished and how long it took. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("each status has its own colour: running, passed, approved, replaced and failed", () => {
  for (const cls of ["dj-running", "dj-passed", "dj-approved", "dj-superseded", "dj-failed"]) assert.ok(html.includes(`.${cls}{`), cls);
  assert.ok(html.includes('failed: ["Failed", "dj-failed"]'));
  assert.ok(html.includes('running: ["In progress", "dj-running"]'));
});

test("the header shows the job id, the start, the finish and the time taken", () => {
  assert.ok(html.includes("const job = el(\"span\", `Job ${String(a.id || \"\").slice(0, 8)}`, \"dj-job\");"));
  assert.ok(html.includes('times.append(`Started ${fmt(started)}`);'));
  assert.ok(html.includes("times.append(el(\"span\", `took ${deepFmt((finishedRaw - started) / 1000)}`, \"dj-took\"));"));
});

test("every deep card and the live card show the header", () => {
  assert.ok(html.includes("c.append(...deepJobHead(a));"));
  assert.ok(html.includes("card.append(...jobNodes, head, scan"));
});

test("the pulse stops for people who ask for reduced motion", () => {
  assert.ok(html.includes("@media (prefers-reduced-motion: reduce){.dj-running .dj-dot{animation:none}}"));
});

test("What's new describes the job header", () => {
  assert.ok(guide.includes("job") && guide.includes("colour"));
});
