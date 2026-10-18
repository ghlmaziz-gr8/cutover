// Keeps the in-app guide in step with the page. Run: node --test service/app/test/guide.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const guideSrc = readFileSync(new URL("../guide.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(guideSrc, sandbox);
const G = sandbox.window.CUTOVER_GUIDE;
const WHO = ["everyone", "engineers", "admins", "operators"];
const TABS = ["analyses", "workspaces", "guide"];

test("guide has an update date and at least one whats-new line", () => {
  assert.match(G.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(G.whatsNew.length >= 1);
});

test("step ids are unique and every step has a title and body", () => {
  const ids = G.steps.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of G.steps) {
    assert.ok(s.title && s.title.length > 0, `title for ${s.id}`);
    assert.ok(Array.isArray(s.body) && s.body.length > 0, `body for ${s.id}`);
    assert.ok(WHO.includes(s.who || "everyone"), `who for ${s.id}`);
  }
});

test("every element id a step refers to exists on the page", () => {
  for (const s of G.steps) {
    for (const ref of s.refs || []) {
      assert.ok(html.includes(`id="${ref}"`), `step ${s.id} refers to #${ref}, which is not in index.html`);
    }
  }
});

test("every action is well formed", () => {
  for (const s of G.steps) {
    for (const a of s.actions || []) {
      assert.ok(a.label, `label in ${s.id}`);
      if (a.type === "link") assert.match(a.href, /^https:\/\//, `https link in ${s.id}`);
      else if (a.type === "go") assert.ok(TABS.includes(a.tab), `tab in ${s.id}`);
      else assert.equal(a.type, "repo-check", `known action type in ${s.id}`);
    }
  }
});

test("every FAQ entry has a question and answer, and points at a real guide step", () => {
  const stepIds = new Set(G.steps.map((s) => s.id));
  for (const f of G.faq || []) {
    assert.ok(f.q && f.a, "question and answer");
    if (f.step) assert.ok(stepIds.has(f.step), `FAQ "${f.q}" refers to missing step ${f.step}`);
  }
});

test("every web address in the guide and FAQ is valid https", () => {
  const texts = [];
  for (const s of G.steps) { texts.push(...s.body); for (const a of s.actions || []) if (a.href) texts.push(a.href); }
  for (const f of G.faq || []) texts.push(f.a);
  for (const t of texts) {
    for (const m of t.match(/https?:\/\/[^\s)]+/g) || []) {
      const url = new URL(m.replace(/[.,;:]+$/, ""));
      assert.equal(url.protocol, "https:", `https address: ${m}`);
    }
  }
});
