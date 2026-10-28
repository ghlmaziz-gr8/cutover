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

test("the card shows time per workspace, and the portal sends the workspace with each heartbeat", () => {
  assert.match(html, /Time in each workspace/);
  assert.match(html, /workspace_id: ws && ws\.id \? ws\.id : null/);
  assert.match(html, /wc-badge-level/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /A card on the home screen greets you when you sign in/);
});

test("the level stays on the home screen as a chip that reopens the rewards card", () => {
  assert.match(html, /<button type="button" id="levelChip" class="wc-badge wc-badge-level level-chip" hidden><\/button>/);
  assert.match(html, /async function loadLevelChip\(\) \{/);
  assert.match(html, /chip\.onclick = \(\) => showWelcome\(\);/);
  assert.match(html, /loadLevelChip\(\);\n/);
});

test("a failed rewards load says so in the card instead of staying silent", () => {
  assert.match(html, /Your time and rewards could not be loaded just now/);
});

test("each badge is a small pill with its own character, popping in and shining now and then, and it stays still for reduced motion", () => {
  assert.match(html, /const TIER_LOOK = \{/);
  assert.match(html, /"level-5": \{ body: "#f9a8d4", accent: "#9d174d", look: "cape" \},/);
  assert.match(html, /const HOUR_EMBLEM = \{ 1: "clock", 5: "star", 25: "flame", 100: "gem" \};/);
  assert.match(html, /function characterFor\(b\) \{/);
  assert.match(html, /data\.badges\.forEach\(\(b, i\) => row\.append\(badgePill\(b, i\)\)\);/);
  assert.match(html, /@keyframes badgePop/);
  assert.match(html, /@keyframes badgeShine/);
  assert.match(html, /@keyframes avBlink/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{\.wc-badge\.cute,\.wc-badge\.cute \.av,\.wc-badge\.cute::after,\.av-eyes\{animation:none\}/);
});
