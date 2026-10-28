// The drawn screens fold as one section, and a platform engineer can delete one screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the screens section is a folding section with its heading in the summary", () => {
  assert.match(html, /const c = document\.createElement\("details"\);\s*c\.className = "rcard arch-card screens-section";\s*c\.open = true;/);
  assert.match(html, /summary\.append\(el\("p", "Deep AI assessment results", "eyebrow-sm"\), el\("h3", "Screens drawn from the code"\)\);/);
  assert.match(html, /\.screens-section>summary\{cursor:pointer/);
});

test("an engineer can delete one screen, after a confirmation, and the page shows the change", () => {
  assert.match(html, /if \(canActOnResults\(\) && sc\.id\) \{\s*const del = el\("button", "Delete", "ghost small-btn"\);/);
  assert.match(html, /window\.confirm\(`Delete the screen "\$\{sc\.name\}"\? A later redraw can draw it again\.`\)/);
  assert.match(html, /api\(`\/api\/analyses\/\$\{cur\.id\}\/screens\/\$\{sc\.id\}`, \{ method: "DELETE" \}\)/);
  assert.match(html, /drawnScreensCard\(screens, \(\) => reloadAnalysis\(\)\.then\(renderReview\)\)/);
  assert.match(html, /drawnScreensCard\(drawn, \(\) => reloadAnalysis\(\)\.then\(\(\) => showFiles\(\)\)\)/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /can delete one drawn screen/);
});

test("the screens section has the same background as the architecture panel", () => {
  assert.match(html, /\.screens-section\.arch-card\{background:linear-gradient\(180deg,color-mix\(in srgb,var\(--accent,#6d28d9\) 6%,var\(--card,#fff\)\),var\(--card,#fff\)\)\}/);
});
