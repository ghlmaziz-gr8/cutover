// Every screen in the page must be in the screen list, or show() hides it. Run: node --test service/app/test/screens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("every screen section is listed in SCREENS, so it can be shown", () => {
  const listed = html.match(/const SCREENS = \[([^\]]*)\]/);
  assert.ok(listed, "SCREENS list found");
  const names = [...listed[1].matchAll(/"(s-[a-z-]+)"/g)].map((m) => m[1]);
  const sections = [...html.matchAll(/<section id="(s-[a-z-]+)" class="screen"/g)].map((m) => m[1]);
  assert.ok(sections.length > 0);
  for (const id of sections) assert.ok(names.includes(id), `${id} is a screen but is not in SCREENS`);
});
