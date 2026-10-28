// The halo on the confidence ring: a glow, a turning dashed ring and an orbiting dot, in the colour of the status.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the confidence ring has a halo that takes the colour of the status under the pointer", () => {
  assert.match(html, /ring\.append\(el\("div", null, "conf-halo"\), el\("div", null, "conf-spin"\), el\("div", null, "conf-orbit"\)\);/);
  assert.match(html, /ring\.style\.setProperty\("--halo", hit \? hit\.c1 : defaultHalo\);/);
  assert.match(html, /\.conf-halo\{[^}]*\}/);
  assert.doesNotMatch(html, /\.conf-halo\{[^}]*animation:/);
  assert.doesNotMatch(html, /\.conf-spin\{[^}]*animation:/);
});

test("the halo holds still: no pulse, no turning ring", () => {
  assert.doesNotMatch(html, /\.conf-orbit\{[^}]*animation:/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The confidence ring has a halo/);
});
