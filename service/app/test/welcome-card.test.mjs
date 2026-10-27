// The login card and the time tracking on the portal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the welcome card sits on the home screen and is filled from the engagement summary", () => {
  assert.match(html, /<section id="s-home" class="screen" hidden>\s*<p class="eyebrow">Your workspace<\/p>\s*<div id="welcomeCard"/);
  assert.match(html, /api\("\/api\/me\/engagement"\)/);
  assert.match(html, /This seems to be your favourite page/);
});

test("the card shows once per browser session, and is shown again after sign-out", () => {
  assert.match(html, /sessionStorage\.getItem\("cutover\.greeted"\)/);
  assert.match(html, /sessionStorage\.removeItem\("cutover\.greeted"\)/);
  assert.match(html, /if \(id === "s-home" && me\) maybeGreet\(\);/);
});

test("the portal sends a heartbeat only while the tab is visible and the person was active", () => {
  assert.match(html, /api\("\/api\/me\/time", \{ method: "POST"/);
  assert.match(html, /document\.hidden/);
  assert.match(html, /Date\.now\(\) - lastActivity > 120000/);
  assert.match(html, /timeScreen === "s-login"/);
});

test("the progress bar and the card respect reduced motion", () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{\.welcome-card\{animation:none\}\.wc-fill\{transition:none\}\}/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /A card on the home screen greets you when you sign in/);
});
