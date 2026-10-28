// The readiness score for a vibe-coding tool, from the draft feature groups. Pure: the script is run here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "readiness.js"), "utf8");
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const root = {};
new Function("globalThis", src)(root);
const { assess } = root.Readiness;

const rule = (id, lines = [1, 2]) => ({ file: "a.asp", id, lines });
const feature = (name, stories) => ({ name, stories });

test("features whose stories all cite rules with source lines are favourable", () => {
  const r = assess([
    feature("Upload", [{ story: "s1", rules: [rule("R1")] }]),
    feature("Storage", [{ story: "s2", rules: [{ file: "b.asp", id: "R1", lines: [3, 4] }] }]),
  ]);
  assert.equal(r.score, 100);
  assert.equal(r.verdict, "favourable");
});

test("a rule cited by two features is flagged on both, and lowers the score", () => {
  const r = assess([
    feature("Upload", [{ story: "s1", rules: [rule("R1")] }]),
    feature("Storage", [{ story: "s2", rules: [rule("R1")] }]),
  ]);
  assert.ok(r.score < 100);
  assert.equal(r.features[0].checks[3].ok, false);
  assert.equal(r.features[1].checks[3].ok, false);
  assert.match(r.features[1].checks[3].text, /1 rule is also used by another feature/);
});

test("a story with no rule, or a rule with no source lines, is a gap", () => {
  const r = assess([feature("Upload", [{ story: "s1", rules: [] }, { story: "s2", rules: [{ file: "a.asp", id: "R2" }] }])]);
  assert.equal(r.features[0].checks[1].ok, false);
  assert.equal(r.features[0].checks[2].ok, false);
});

test("an empty draft is not ready, and has no stories", () => {
  const r = assess([]);
  assert.equal(r.verdict, "not-ready");
  assert.equal(r.stories, 0);
});

test("the readiness panel is on top of the feature groups card, and the script loads before the page", () => {
  assert.match(html, /<script src="readiness\.js"><\/script>/);
  assert.match(html, /<div id="groupReadiness"><\/div>/);
  assert.match(html, /function paintReadiness\(rows\) \{/);
  assert.match(html, /Draft the user stories to see how ready this is for a vibe-coding tool\./);
  assert.match(html, /const r = window\.Readiness\.assess\(/);
  assert.match(html, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{ fill\.style\.width/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /shows how ready the draft is for a vibe-coding tool/);
});
