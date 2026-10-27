// The live card while a deep file assessment runs: the code scan, the clock, the estimate and the stages.
// It refreshes while the assessment runs and stops when the panel closes. Text only, never markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const wait = html.slice(html.indexOf("  function deepWait(a) {"), html.indexOf("  function deepCard(a, reload, msg) {"));
const panel = html.slice(html.indexOf("  function deepPanel(li, f, onClose"), html.indexOf("  function businessPanel(li, f) {"));

test("the running card shows the estimate as a range, from the size the runner reported", () => {
  assert.ok(wait.includes("progress.estimate_seconds"));
  assert.ok(wait.includes("usually ${deepFmt(estimate * 0.8)} to ${deepFmt(estimate * 1.25)}"));
  assert.ok(wait.includes("${progress.lines.toLocaleString()} lines"));
  assert.ok(wait.includes("Measuring the file to estimate the time"));
});

test("the card animates: a sweep, lit lines, a moving bar and the stages", () => {
  for (const cls of ["dw-sweep", "dw-line", "dw-fill", "dw-stages", "dw-orb"]) assert.ok(wait.includes(cls), cls);
  assert.ok(html.includes("@keyframes dwSweep"));
  assert.ok(html.includes("@keyframes dwFlow"));
  assert.ok(html.includes("@keyframes dwRing"));
});

test("the card respects reduced motion", () => {
  assert.ok(html.includes("@media (prefers-reduced-motion: reduce){.dw-card,.dw-card *{animation:none!important"));
});

test("the panel keeps the live card up to date while the assessment runs, and stops when it closes", () => {
  assert.ok(panel.includes("const running = res.assessments.find((a) => a.status === \"running\")"));
  assert.ok(panel.includes("waitCard.update(running)"));
  assert.ok(panel.includes("if (running) pollTimer = setTimeout(load, 4000);"));
  assert.ok(panel.includes("if (!panel.isConnected) return;"));
});

test("the card stops its clock when it is taken off the screen", () => {
  assert.ok(wait.includes("if (!card.isConnected) { clearInterval(timer); return; }"));
});

test("the stages say they follow the estimate, not a measured step", () => {
  assert.ok(html.includes("The stages follow the estimate, so they show how far along the work should be, not a measured step."));
});

test("What's new describes the live card", () => {
  assert.ok(guide.includes("live card") && guide.includes("estimate"));
});
