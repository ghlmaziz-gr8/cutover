// Scopes that fit the chosen approach are open; the rest are shown as not for this approach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("Modernize scopes need the web front end, and Migrate scopes need one of the other two", () => {
  assert.ok(html.includes('if (scopeHas(key, "modernize")) return modern;'));
  assert.ok(html.includes('if (scopeHas(key, "migrate")) return !modern;'));
  assert.ok(html.includes('if (!fits) card.classList.add("unfit");'));
  assert.ok(html.includes('if (canChoose && !selected && fits) {'));
});
