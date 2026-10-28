// The feature groups card: progress steps, the AI working animation while a run goes, and a tidier draft.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the card shows three progress steps, and the step in progress pulses", () => {
  assert.match(html, /<ol id="groupSteps" class="fg-steps"/);
  assert.match(html, /label: "Business views approved"/);
  assert.match(html, /label: "AI proposes the groups"/);
  assert.match(html, /label: "Owner approves"/);
  assert.match(html, /\.fg-step\.now \.fg-dot\{background:var\(--accent,#6d28d9\);color:#fff;animation:fgPulse/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{\.fg-step\.now \.fg-dot\{animation:none\}\}/);
});

test("while the AI groups the files, the card shows the scanning animation with how long it has run", () => {
  assert.match(html, /<div id="groupRunning"><\/div>|id="groupRunning"/);
  assert.match(html, /function paintRunning\(g\) \{/);
  assert.match(html, /"The AI is grouping the approved files into capabilities"/);
  assert.match(html, /Started \$\{minutes < 1 \? "just now" : minutes \+ " min ago"\}/);
  assert.match(html, /const running = rows\.find\(\(g\) => g\.status === "running"\) \|\| null;/);
});

test("the card checks for the draft every few seconds while a run is going, and stops when none is", () => {
  assert.match(html, /if \(running\) groupPollTimer = setTimeout\(\(\) => loadGroupings\(\), 5000\);/);
  assert.match(html, /clearTimeout\(groupPollTimer\);/);
});

test("the draft is laid out as tidy tiles, a toolbar and a footer, with no inline layout", () => {
  assert.match(html, /\.gr-feature\{margin-top:10px;padding:12px 14px;border:1px solid/);
  assert.match(html, /const box = el\("div", null, "gr-card"\);/);
  assert.match(html, /const actions = el\("div", null, "row fg-foot"\);/);
  assert.doesNotMatch(html, /box\.style\.borderTop = "1px solid var\(--line, #ddd\)";\s*box\.style\.paddingTop/);
});

test("proposing shows the run at once", () => {
  assert.match(html, /The AI is grouping the files\. The draft appears here when it is ready\./);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The feature groups card shows three steps/);
});
