// The modernized templates: rules pick the options from the findings, and each has its own preview page.
// Run: node --test service/app/test/modernize.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../modernize.js", import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(src, sandbox);
const { choose, TEMPLATES } = sandbox.Modernize;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const point = (value, extra = {}) => ({ point: true, value, ...extra });

test("the three templates each have a preview page in templates/", () => {
  assert.equal(TEMPLATES.length, 3);
  for (const t of TEMPLATES) {
    assert.ok(t.href.startsWith("templates/"), t.href);
    assert.ok(existsSync(new URL(`../${t.href}`, import.meta.url)), `${t.href} exists`);
    const page = readFileSync(new URL(`../${t.href}`, import.meta.url), "utf8");
    assert.ok(page.includes("../index.html"), "each preview links back to Cutover");
    assert.ok(page.includes("--accent:#6d28d9"), "each preview uses the portal's colours");
  }
});

test("the portal loads the rules and shows a section per template", () => {
  assert.ok(html.includes('<script src="modernize.js"></script>'));
  assert.ok(html.includes("function modernizeSection"));
  assert.ok(html.includes("modernizeSection(Object.fromEntries"));
});

test("legacy pages and screens recommend the web template, with the matched reasons", () => {
  const picks = choose({
    "legacy.languages": point(["Classic ASP", "JavaScript"]),
    "ui.screens": point({ count: 12 }),
  });
  assert.equal(picks[0].id, "web-modern");
  assert.equal(picks[0].fit, "recommended");
  assert.ok(picks[0].reasons.includes("Legacy page code was found"));
  assert.ok(picks[0].reasons.includes("Screens were found in the code"));
});

test("stored procedures and tables recommend the services template", () => {
  const picks = choose({
    "data.routines_in_code": point(["GetOrders"]),
    "data.tables_in_code": point(["Orders", "Items"]),
  });
  assert.equal(picks[0].id, "services-data");
});

test("with no findings the containers template is the recommendation, and the rest are weaker", () => {
  const picks = choose({});
  assert.equal(picks[0].id, "lift-contain");
  assert.equal(picks[0].fit, "recommended");
  assert.notEqual(picks[1].fit, "recommended");
});

test("a finding that found nothing does not count as a point", () => {
  const picks = choose({
    "legacy.languages": point(["Classic ASP"], { point: false }),
  });
  assert.ok(!picks[0].reasons.includes("Legacy page code was found"));
});

test("a broken finding does not stop the choice", () => {
  const picks = choose({ "ui.screens": null, "data.routines_in_code": { point: true } });
  assert.equal(picks.length, 3);
});
