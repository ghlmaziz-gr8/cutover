// A file result approved at an older commit than the latest run is flagged, and nothing else changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("only approved or edited results with a different commit are flagged", () => {
  assert.match(html, /\(f\.review_status === "approved" \|\| f\.review_status === "edited"\) && f\.commit_sha && cur && cur\.commit_sha && f\.commit_sha !== cur\.commit_sha/);
});

test("the flag names both commits and never changes the approval", () => {
  assert.match(html, /Approved at commit \$\{String\(f\.commit_sha\)\.slice\(0, 7\)\}; the latest run read \$\{String\(cur\.commit_sha\)\.slice\(0, 7\)\}/);
  const flagBlock = html.slice(html.indexOf("An approved result read at an older commit"), html.indexOf("An approved result read at an older commit") + 700);
  assert.doesNotMatch(flagBlock, /reviewFile\(/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /A file purpose approved at an older commit than the latest run is flagged/);
});
