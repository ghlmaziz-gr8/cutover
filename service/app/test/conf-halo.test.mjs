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
  assert.match(html, /\.conf-halo\{[^}]*animation:dhPulse/);
  assert.match(html, /\.conf-spin\{[^}]*animation:dhSpin/);
});

test("the halo stops moving under reduced motion", () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{\.conf-halo,\.conf-spin,\.conf-orbit\{animation:none\}\}/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The confidence ring has a halo/);
});
