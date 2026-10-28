// The business rules, worked examples and data access sit under the functions in the deep card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const guide = readFileSync(join(here, "..", "guide.js"), "utf8");

test("the deep card shows business rules and data and interfaces after the functions", () => {
  const card = html.indexOf("function deepCard(");
  assert.notEqual(card, -1);
  const body = html.slice(card, html.indexOf("if (a.dropped)", card));
  const rules = body.indexOf("appendRules(c, content)");
  assert.ok(rules > body.indexOf("content.functions") || rules > 0, "rules are drawn by the shared helper");
  assert.ok(rules < body.indexOf('"Data and interfaces"'), "data after the rules");
  const helper = html.slice(html.indexOf("function appendRules(c, content)"), html.indexOf("function deepCard("));
  assert.ok(helper.includes('"Business rules"'));
});

test("each rule shows its lines, and its examples are matched by rule id", () => {
  assert.match(html, /lines \$\{rule\.lines\[0\]\}–\$\{rule\.lines\[1\]\}/);
  assert.match(html, /e\.rule === rule\.id/);
  assert.match(html, /Given \$\{ex\.given\} → expect \$\{ex\.expect\}/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /lists the business rules in each file, with the lines they come from/);
});
