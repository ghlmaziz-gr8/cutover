// While the AI drafts the user stories, the draft shows an animated indicator and its button is disabled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the draft shows an animated indicator, and its Draft user stories button is disabled, while the AI drafts", () => {
  assert.match(html, /let storyDrafting = null;/);
  assert.match(html, /storyDrafting = g\.id;\s*renderGroupings\(groupRows\);/);
  assert.match(html, /const drafting = storyDrafting === g\.id;/);
  assert.match(html, /drafting \? "Drafting…" : "Draft user stories"/);
  assert.match(html, /draft\.disabled = drafting;/);
  assert.match(html, /if \(drafting\) box\.insertBefore\(storiesWorking\(\), actions\);/);
  assert.match(html, /<span class="fg-dots">|dots\.append\(el\("i"\), el\("i"\), el\("i"\)\);/);
});

test("the indicator ends when the stories are ready, or when the wait runs out", () => {
  assert.match(html, /const finish = \(text\) => \{\s*storyDrafting = null;/);
  assert.match(html, /finish\("The user stories are ready\./);
  assert.match(html, /else finish\("The drafting is taking longer than expected\./);
});

test("the indicator is animated, and holds still for reduced motion", () => {
  assert.match(html, /@keyframes fgBounce/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{\.fg-dots i\{animation:none;opacity:\.7\}\}/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /While the AI drafts the user stories, the draft shows an animated indicator/);
});
