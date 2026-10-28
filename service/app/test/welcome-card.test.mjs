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

test("the level badge sits on the home screen next to the Change role button and opens the rewards card", () => {
  assert.match(html, /<span class="row home-actions">\n        <button type="button" id="levelBadge" class="level-badge" hidden><\/button>\n        <button type="button" class="ghost small-btn" id="changeRole">Change role<\/button>/);
  assert.match(html, /async function loadLevelBadge\(\) \{/);
  assert.match(html, /badge\.onclick = \(\) => showWelcome\(\);/);
  assert.match(html, /loadLevelBadge\(\);\n/);
  assert.doesNotMatch(html, /headerBadge|header-badge/);
});

test("a failed rewards load says so in the card instead of staying silent", () => {
  assert.match(html, /Your time and rewards could not be loaded just now/);
});

test("each badge is a shield plate with a glowing medal, a pill, a divider and points, popping in and bobbing, and it stays still for reduced motion", () => {
  assert.match(html, /const TIER_LOOK = \{/);
  assert.match(html, /"level-5": \{ look: "cape" \},/);
  assert.match(html, /const HOUR_EMBLEM = \{ 1: "clock", 5: "star", 25: "flame", 100: "gem" \};/);
  assert.match(html, /function badgeArt\(b, index, level\) \{/);
  assert.match(html, /data\.badges\.forEach\(\(b, i\) => row\.append\(badgePill\(b, i, lvl\)\)\);/);
  assert.match(html, /M12 76 L100 36 L188 76 L188 206 L100 284 L12 206 Z/);
  assert.match(html, /@keyframes badgePop/);
  assert.match(html, /@keyframes badgeBob/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{\.bplate,\.bplate-glyph\{animation:none\}/);
});

test("the plate shows the level, the points, and the time on the system without any character art", () => {
  assert.match(html, /`Level \$\{lvl\[1\]\}`/);
  assert.match(html, /String\(level && typeof level\.points === "number" \? level\.points : 0\)/);
  assert.match(html, /"Earned"/);
  assert.doesNotMatch(html, /function characterFor/);
});

test("each level has its own colours, and time badges keep the blue", () => {
  assert.match(html, /const PLATE_COLOURS = \{/);
  for (const n of [1, 2, 3, 4, 5]) assert.match(html, new RegExp(`\\n    ${n}: \\{ body: \\[`));
  assert.match(html, /const colours = PLATE_COLOURS\[lvl \? lvl\[1\] : "time"\] \|\| PLATE_COLOURS\.time;/);
  assert.match(html, /const k = lvl \? lvl\[1\] : "time";/);
  assert.match(html, /url\(#bpBody-\$\{k\}\)/);
});
