// The bell is hidden from the moment an analysis is started, and returns if starting fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");
const handler = html.slice(html.indexOf('$("startNow").addEventListener("click"'), html.indexOf('$("startNow").addEventListener("click"') + 3000);

test("the bell is hidden as soon as Start is pressed", () => {
  assert.match(handler, /document\.body\.classList\.add\("no-bell"\);\s*\$\("startNow"\)\.disabled = true;/);
});

test("the bell returns when starting fails", () => {
  assert.match(handler, /catch \(err\) \{\s*updateBellVisibility\(\);/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /The bell is hidden from the moment an analysis is started/);
});
