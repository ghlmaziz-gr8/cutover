// Each assessment is tied to the commit it read, and the review says when the branch has moved on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const guide = readFileSync(new URL("../guide.js", import.meta.url), "utf8");

test("the review screen has a notice for results that may be out of date, with a way to run again", () => {
  assert.ok(html.includes('id="outOfDateCard"'));
  assert.ok(html.includes("function renderOutOfDate(row)"));
  assert.ok(html.includes("renderOutOfDate(row);"));
  assert.ok(html.includes('api(`/api/analyses/${cur.id}/rerun`, { method: "POST" });'));
});

test("the notice shows only when the analysis says it is out of date", () => {
  assert.ok(html.includes("card.hidden = !row.out_of_date;"));
});

test("the change is in the what's new list", () => {
  assert.ok(guide.includes("Each assessment records the commit it read"));
});
