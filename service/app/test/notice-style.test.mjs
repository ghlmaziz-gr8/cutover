// The bell sits in the header corner at a fixed size, and notices use a lighter type than before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const guide = readFileSync(new URL("../guide.js", import.meta.url), "utf8");

test("the bell is a small button pinned to the header corner, not centred on a tall header", () => {
  assert.ok(html.includes(".bell{position:absolute;right:16px;top:12px;width:34px;height:34px;"));
  assert.ok(!html.includes("top:50%;transform:translateY(-50%);width:42px"));
  assert.ok(html.includes(".bell svg{width:16px;height:16px;"));
});

test("notices use a lighter, smaller type", () => {
  assert.ok(html.includes(".notif .t,.toast .t{font:600 12.5px var(--body);"));
  assert.ok(html.includes(".notif .b,.toast .b{font:400 12px var(--body);"));
  assert.ok(!html.includes("font:800 13.5px system-ui"));
});

test("the change is in the what's new list", () => {
  assert.ok(guide.includes("The bell sits in the header corner, and notices use a lighter type."));
});
