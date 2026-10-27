// The bell is hidden on the progress screen, and on the deeper assessment page only while its run is going.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the bell is hidden on the progress screen, and on the deeper page only while a run is going", () => {
  assert.match(html, /const hide = !\$\("s-run"\)\.hidden \|\| \(!\$\("s-deeper"\)\.hidden && running\);/);
  assert.match(html, /const running = !!cur && \(cur\.status === "queued" \|\| cur\.status === "running"\);/);
});

test("the bell state is set when a screen opens and when the deeper run changes", () => {
  assert.match(html, /renderHeader\(id\);\s*updateBellVisibility\(\);/);
  assert.match(html, /function renderDeeperRun\(\) \{\s*const busy[^\n]*\n\s*updateBellVisibility\(\);/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The bell is hidden on the deeper assessment page while a deeper run is queued or running/);
});
