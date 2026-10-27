// The portal footer states what clicks record, and long web addresses wrap inside their finding card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the footer says what clicks record and what they never record", () => {
  assert.match(html, /Clicks in the portal are recorded only as a position on the screen and the id of the button used/);
  assert.match(html, /Cutover does not record who clicked, or any text or values\./);
});

test("the privacy sign-off text for language models is left unchanged", () => {
  const worker = readFileSync(join(here, "..", "..", "worker", "src", "index.mjs"), "utf8");
  assert.match(worker, /const PRIVACY_NOTICE_VERSION = "2026-10-18\.1";/);
});

test("finding cards and their values wrap long addresses inside the card", () => {
  assert.match(html, /\.finding,\.finding \.fvalue,\.finding li\{min-width:0;overflow-wrap:anywhere;word-break:break-word\}/);
});

test("the changes are listed in What's new", () => {
  assert.match(guide, /The notice at the foot of the portal now says what clicks record/);
});
