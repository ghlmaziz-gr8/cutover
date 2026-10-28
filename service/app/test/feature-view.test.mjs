// The feature view: read-only, approved features only, each story opens to the rules and lines it cites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the feature card sits on the files screen and loads with the groupings", () => {
  assert.match(html, /<div class="card" id="featureCard" hidden/);
  assert.match(html, /<div id="featureList"><\/div>/);
  assert.match(html, /renderFiles\(\);\n\s+loadGroupings\(\);\n\s+loadFeatureView\(\);/);
});

test("auditors do not load the feature view, and it reads the approved features endpoint only", () => {
  assert.match(html, /if \(!cur \|\| !ws \|\| ws\.role === "auditor"\) return;/);
  assert.match(html, /api\(`\/api\/analyses\/\$\{cur\.id\}\/features`\)/);
});

test("the card is hidden when no feature is approved", () => {
  assert.match(html, /if \(!data\.grouping\) \{\n\s+card\.hidden = true;/);
});

test("each story opens to its rules, with the rule's file and lines", () => {
  assert.match(html, /el\("summary", `Rules behind this story \(\$\{st\.rules\.length\}\)`\)/);
  assert.match(html, /`\$\{r\.id\} · \$\{r\.file\}\$\{Array\.isArray\(r\.lines\) \? ` · lines \$\{r\.lines\[0\]\}–\$\{r\.lines\[1\]\}` : ""\}`/);
  assert.match(html, /When: \$\{r\.condition\}/);
  assert.match(html, /Then: \$\{r\.outcome\}/);
});

test("a rule that has left the approved assessment is said so", () => {
  assert.match(html, /This rule is no longer in the approved assessment of its file\./);
});

test("the view is read-only: it has no approve, edit or draft control", () => {
  const start = html.indexOf("function renderFeatureView(");
  const end = html.indexOf("// Feature groupings. Platform engineers propose", start);
  const body = html.slice(start, end);
  assert.doesNotMatch(body, /<button|createElement\("button"|el\("button"|api\(/);
});

test("the animation respects reduced motion", () => {
  assert.match(html, /@keyframes fvIn/);
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{\.fv-feature\{animation:none\}\}/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The features the application owner approved now have a read-only view/);
});
