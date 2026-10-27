// The elapsed-time card on the progress screen: a live clock, a bar against the expected wait, and reduced motion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const start = html.indexOf("  function setClock(sec) {");
const update = html.slice(html.indexOf("  function updateWait() {"), html.indexOf("  setInterval(() => { if (!$(\"s-run\").hidden) updateWait(); }, 1000);"));

test("the clock is built from text nodes, one span per character", () => {
  assert.notEqual(start, -1);
  const body = html.slice(start, html.indexOf("  function updateWait() {"));
  assert.match(body, /el\("span", text\[i\], "rw-d"\)/);
  assert.doesNotMatch(body, /innerHTML/);
});

test("the bar and the tone follow the elapsed time against the expected wait", () => {
  assert.match(update, /Math\.min\(sec \/ 600, 1\) \* 100/);
  assert.match(update, /sec > 8 \* 60 \? "late" : sec > 5 \* 60 \? "long" : "ok"/);
  assert.match(update, /box\.classList\.toggle\("no-band", !ai\)/);
});

test("a note only animates when it changes", () => {
  assert.match(update, /if \(note\.textContent !== next\)/);
});

test("the card is turned still when the device asks for less motion", () => {
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{\s*\.runWait,\.rw-radar/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The progress screen shows the elapsed time as a live clock/);
});
