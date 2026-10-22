// The Cutover AI assessment: effort, resources and the project plan, end to end.
// Run: node --test service/app/test/effort.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../effort.js", import.meta.url), "utf8"), sandbox);
const E = sandbox.Effort;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const facts = {
  template: "web-modern", screens: 75, endpoints: 0, controllers: 0, routines: { procedures: 8, functions: 3, views: 2 },
  tables: 14, dependencies: 6, roles: 4, accessDbs: 2, sourceFiles: 17, notRead: 3, needsReview: 2, personalData: false,
  hasIac: false, hasCi: false, targetLanguage: "cs-aspnet", targetLabel: "C# with ASP.NET Core", targetMatchesLegacy: false,
};
const group = (r, key) => r.groups.find((g) => g.key === key);

test("the assessment is labelled as a Cutover AI assessment", () => {
  assert.equal(E.LABEL, "Cutover AI assessment");
});

test("without an approach there is no estimate", () => {
  const r = E.build({});
  assert.equal(r.ready, false);
  assert.ok(r.message);
});

test("project management and onboarding are counted once, not replacing other items", () => {
  const r = E.build(facts);
  assert.equal(group(r, "governance").items.filter((i) => /Project management/.test(i.label)).length, 1);
  assert.ok(group(r, "governance").items.some((i) => /Steering/.test(i.label)));
  assert.equal(group(r, "access").items.filter((i) => /Team onboarding/.test(i.label)).length, 1);
});

test("the totals are the sum of the groups, low to high", () => {
  const r = E.build(facts);
  assert.equal(r.ready, true);
  const low = r.groups.reduce((a, g) => a + g.low, 0);
  const high = r.groups.reduce((a, g) => a + g.high, 0);
  assert.ok(Math.abs(r.total.low - low) < 0.5, `${r.total.low} vs ${low}`);
  assert.ok(Math.abs(r.total.high - high) < 0.5, `${r.total.high} vs ${high}`);
  for (const g of r.groups) assert.ok(g.low <= g.high, g.title);
});

test("every end-to-end area is covered", () => {
  const r = E.build(facts);
  const titles = r.groups.map((g) => g.title).join(" | ");
  for (const word of ["Discovery", "Mobilise", "Requirements", "Application build", "Database", "Testing", "Security", "Approvals", "Training", "Cutover"]) {
    assert.ok(titles.includes(word), word);
  }
});

test("onboarding, access, stories and stakeholder reviews are counted", () => {
  const r = E.build(facts);
  assert.ok(group(r, "access").items.some((i) => /onboarding/i.test(i.label) && i.days[1] > 0));
  assert.ok(group(r, "access").items.some((i) => /Access grants/.test(i.label)));
  assert.ok(group(r, "requirements").items.some((i) => /User stories/.test(i.label)));
  assert.ok(group(r, "requirements").items.some((i) => /workshops/.test(i.label)));
  assert.ok(group(r, "testing").items.some((i) => /acceptance/.test(i.label)));
});

test("files that were not read and databases that were not read are counted and named", () => {
  const r = E.build({ ...facts, tables: 0 });
  assert.ok(group(r, "discovery").items.some((i) => /not read/.test(i.label) && i.count === 3));
  assert.ok(group(r, "database").items.some((i) => /database files|Access/i.test(i.label) && i.count === 2));
  assert.ok(r.notes.some((n) => /found but not read/.test(n)));
});

test("missing infrastructure and pipeline add their own work", () => {
  const without = E.build(facts);
  const withIt = E.build({ ...facts, hasIac: true, hasCi: true });
  assert.ok(without.total.high > withIt.total.high);
  assert.ok(group(without, "build").items.some((i) => /Infrastructure as code/.test(i.label)));
});

test("no REST endpoints means the logic in the pages is counted", () => {
  const r = E.build(facts);
  assert.ok(group(r, "build").items.some((i) => /Page logic/.test(i.label) && i.days[1] > 0));
  assert.ok(r.notes.some((n) => /inside the pages/.test(n)));
});

test("a new language costs more than the legacy one", () => {
  const same = E.build({ ...facts, targetMatchesLegacy: true });
  const other = E.build(facts);
  assert.ok(other.total.high > same.total.high);
});

test("lift and contain adds container work and drops the rebuild of endpoints", () => {
  const r = E.build({ ...facts, template: "lift-contain" });
  assert.ok(group(r, "build").items.some((i) => /Container packaging/.test(i.label)));
  assert.ok(!group(r, "build").items.some((i) => /Endpoints and controllers/.test(i.label)));
});

test("the team, the phases and the plan line up", () => {
  const r = E.build(facts);
  assert.ok(r.headcount >= 2);
  assert.ok(r.team.some((x) => x.role === "Project manager"));
  assert.ok(r.team.some((x) => x.role === "Developers"));
  assert.equal(r.phases[0].startWeek, 1);
  for (let i = 1; i < r.phases.length; i++) assert.equal(r.phases[i].startWeek, r.phases[i - 1].endWeek + 1);
  assert.equal(r.weeks, r.phases[r.phases.length - 1].endWeek);
  for (const ph of r.phases) {
    assert.ok(ph.tasks.length > 0, ph.name);
    assert.ok(ph.deliverables.length > 0, ph.name);
    assert.ok(ph.approvals.length > 0, ph.name);
  }
  assert.ok(r.phases.some((p) => /Approvals/.test(p.name)));
});

test("the assumptions state the working basis and the gates", () => {
  const r = E.build(facts);
  assert.ok(r.assumptions.some((a) => /person-days/.test(a)));
  assert.ok(r.assumptions.some((a) => /approval gates/.test(a)));
  assert.ok(r.assumptions.some((a) => /not included/.test(a)));
});

test("the portal reads the real findings and shows the plan, the exports and the label", () => {
  assert.ok(html.includes('id="effortCard"'));
  assert.ok(html.includes('src="effort.js"'));
  assert.ok(html.includes('"ui.screens"') || html.includes("'ui.screens'") || html.includes('val("ui.screens")'));
  assert.ok(html.includes('val("legacy.databases")'));
  assert.ok(html.includes('val("legacy.not_read")'));
  assert.ok(html.includes('"Timeline"') && html.includes('"Cards"'), "the plan has a timeline and a cards view");
  assert.ok(html.includes("gantt-gate"), "approval gates are drawn on the timeline");
  assert.ok(html.includes('exportCardPdf("effortCard"'));
  assert.ok(html.includes("exportPlan(true)") && html.includes("exportPlan(false)"), "the plan exports as its own document, as PDF and HTML");
});

test("the plan document is a print-first page with a timeline, phase cards and gates", () => {
  const start = html.indexOf("function planDocumentHtml(");
  const end = html.indexOf("// Opens the plan as a document");
  assert.ok(start > 0 && end > start, "the generator is in the portal");
  const colors = html.slice(html.indexOf("const PLAN_COLORS"), html.indexOf("];", html.indexOf("const PLAN_COLORS")) + 2);
  const ctx = {};
  vm.runInNewContext(`${colors}\n${html.slice(start, end)}\nthis.planDocumentHtml = planDocumentHtml;`, ctx);
  const est = E.build(facts, { scenario: "expected", teamSize: 4 });
  assert.equal(est.ready, true);
  const page = ctx.planDocumentHtml({ est, title: "Demo <app>", app: "Demo", approach: "Run as is", language: "Not chosen yet", owner: "a@b.c", approved: "Awaiting approval", generated: "Oct 22, 2026", scenario: "expected", teamSize: 4 }, true);
  assert.ok(page.includes("@page{size:A4 landscape"), "the page is landscape A4");
  assert.ok(page.includes('class="gantt-svg"'), "the timeline is drawn as an SVG");
  assert.ok(page.includes(est.phases[0].name.replace(/&/g, "&amp;")), "phase names are kept");
  assert.ok(page.includes("Demo &lt;app&gt;"), "text is escaped");
  assert.ok(page.includes("window.print()"), "the PDF version opens the print dialog");
  assert.ok(page.includes('id="timeline"') && page.includes('id="phases"') && page.includes('id="people"'), "the timeline and the phase cards each have their own section");
  assert.ok(page.includes(".pg{break-after:page}"), "each section starts on a new page when printed");
  assert.ok(page.includes("class=\"gate\"") && est.phases.some((ph) => ph.gate), "gates are marked on the timeline");
  const htmlOnly = ctx.planDocumentHtml({ est, title: "Demo", app: "Demo", approach: "x", language: "y", owner: "z", approved: "w", generated: "g", scenario: "expected", teamSize: 4 }, false);
  assert.ok(!htmlOnly.includes("window.print()"), "the HTML download has no script");
});
