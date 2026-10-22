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
    assert.ok(page.includes(`data-template="${t.id}"`), "each page renders its own template");
    assert.ok(page.includes("preview.js"), "each page uses the shared renderer");
  }
  const renderer = readFileSync(new URL("../templates/preview.js", import.meta.url), "utf8");
  assert.ok(renderer.includes("../index.html"), "previews link back to Cutover");
  assert.ok(renderer.includes("Back to the assessment"), "previews can go back to the assessment");
  assert.ok(renderer.includes("cutover.pendingTemplate"), "a choice on a preview is handed to the review");
  const css = readFileSync(new URL("../templates/preview.css", import.meta.url), "utf8");
  assert.ok(css.includes("--accent:#6d28d9"), "previews use the portal's colours");
});

test("each preview shows the proposal and the two other options, with fit from the review", () => {
  const renderer = readFileSync(new URL("../templates/preview.js", import.meta.url), "utf8");
  assert.ok(renderer.includes("What we are proposing"));
  assert.ok(renderer.includes("Other options, for comparison"));
  assert.ok(renderer.includes("Recommended for this application"));
  assert.ok(renderer.includes('params.get("fit")'));
  assert.ok(renderer.includes('params.get("rec")'));
});

test("the portal loads the rules and shows a section per template", () => {
  assert.ok(html.includes('<script src="modernize.js"></script>'));
  assert.ok(html.includes("function modernizeSection"));
  assert.ok(html.includes("modernizeSection(currentFindings"));
  assert.ok(html.includes("?fit=${p.fit}&rec="), "the review passes this template's fit and the recommended one");
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

test("with no findings nothing is recommended, because absences are not evidence", () => {
  const picks = choose({});
  assert.ok(picks.every((p) => p.score === 0));
  assert.ok(picks.every((p) => p.fit !== "recommended"));
});

test("a missing infrastructure-as-code file is not scored or shown as evidence", () => {
  const picks = choose({});
  const lift = picks.find((p) => p.id === "lift-contain");
  assert.equal(lift.score, 0);
  assert.equal(lift.evidence.length, 0);
});

test("dependencies to upgrade recommend the containers template", () => {
  const picks = choose({ "legacy.dependencies": point(["jquery 1.x", "log4j 1.x"]) });
  assert.equal(picks[0].id, "lift-contain");
  assert.equal(picks[0].fit, "recommended");
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

test("each option has a fit percentage and a level from its matched weights", () => {
  const picks = choose({
    "legacy.languages": { value: [{ language: "Classic ASP", files: 3 }], severity: "high" },
    "ui.screens": { value: 4, severity: "info" },
  });
  for (const p of picks) {
    assert.ok(Number.isInteger(p.percent) && p.percent >= 0 && p.percent <= 100);
    assert.equal(p.percent, Math.round((100 * p.score) / p.max));
    assert.ok(["Strong fit", "Partial fit", "Light evidence"].includes(p.level));
  }
  const none = choose({});
  assert.ok(none.every((p) => p.percent === 0 && p.level === "Light evidence"));
});
