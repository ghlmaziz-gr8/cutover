// The toasts and the notification panel sit outside the sticky header. The header has a backdrop filter, which would
// make fixed elements inside it position against the header, so the toasts were cut off at the top. Text only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const header = html.slice(html.indexOf('<header class="top">'), html.indexOf("</header>") + "</header>".length);

test("the toast container and the notification panel are not inside the header", () => {
  assert.ok(!header.includes('id="toasts"'));
  assert.ok(!header.includes('id="notifPanel"'));
  assert.ok(html.includes('<div class="toasts" id="toasts" aria-live="polite"></div>'));
});

test("the toasts stay at the bottom right of the screen", () => {
  assert.ok(html.includes(".toasts{position:fixed;right:16px;bottom:16px;"));
});
