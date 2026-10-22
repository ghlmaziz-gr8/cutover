// Run: node --test service/app/test/review-cards.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("  function summaryRows(shown, role) {");
const end = html.indexOf("  // Three summary cards from the demo", start);
assert.ok(start > 0 && end > start, "summaryRows is in the page");
// sees() is the page's own role rule; here only the two roles the tests use.
const sandbox = { sees: (role, cat) => role === "platform_engineer" || (role === "security_officer" && cat === "security") };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end).replace("  function summaryRows", "function summaryRows"), sandbox);
const summaryRows = sandbox.summaryRows;
const f = (value) => ({ value, confidence: "verified" });

test("the application facts sit on What it is, and the hosting fact on How it is hosted", () => {
  const out = summaryRows({
    "app.purpose": f({ name: "ManageIt", summary: "Clinic scheduling" }),
    "runtime.java": f("11"),
    "ui.endpoints": f({ endpoint_annotations: 41, controllers: 6 }),
    "ui.client_facing": f("yes"),
    "infrastructure.as_code": f({ terraform: 3 }),
  }, "platform_engineer");
  const labels = out.app.map((r) => r[0]);
  assert.equal(JSON.stringify(labels), JSON.stringify(["Name", "Purpose", "Runtime", "Entry points", "Client-facing"]));
  assert.equal(JSON.stringify(out.hosting), JSON.stringify([["Infrastructure as code", "3 files"]]));
  assert.ok(!labels.includes("Hosting"), "the duplicate Hosting row is gone");
});

test("with one database type, only the quantity of databases is shown", () => {
  const out = summaryRows({
    "legacy.databases": f([
      "Microsoft Access (tier 1): db/a.mdb (by file signature)",
      "Microsoft Access (tier 1): db/b.mdb (by file signature)",
    ]),
  }, "platform_engineer");
  assert.equal(JSON.stringify(out.data), JSON.stringify([["Databases found", "2"]]));
});

test("with several database types, the quantity and the types are both shown", () => {
  const out = summaryRows({
    "legacy.databases": f([
      "Microsoft Access (tier 1): db/a.mdb (by file signature)",
      "SQLite (tier 1): data/app.db (by file signature)",
      "SQLite (tier 1): data/cache.db (by file signature)",
    ]),
  }, "platform_engineer");
  assert.equal(JSON.stringify(out.data), JSON.stringify([
    ["Databases found", "3"],
    ["Database types", "2 types: Microsoft Access, SQLite"],
  ]));
});

test("an unidentified .db file counts as a database but not as a type", () => {
  const out = summaryRows({
    "legacy.databases": f([
      "Microsoft Access (tier 1): db/a.mdb (by file signature)",
      "Unrecognised .db file (tier 3): x/y.db (not identified; contents not read)",
    ]),
  }, "platform_engineer");
  assert.equal(JSON.stringify(out.data), JSON.stringify([["Databases found", "2"]]));
});

test("a role that cannot see the data gets no database rows", () => {
  const out = summaryRows({ "legacy.databases": f(["Microsoft Access (tier 1): a.mdb (x)"]) }, "security_officer");
  assert.equal(out.data.length, 0);
});

test("the What it is row shows the number of roles, and the names stay in the findings", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes('item.id === "security.roles" && Array.isArray(item.value)'));
  assert.ok(html.includes("The names stay in \"Show findings\"."));
});

test("the names under Show the names are a bulleted list, one name per bullet", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes('list.className = "ds-names-list";'));
  assert.ok(html.includes("for (const n of item.value.names) list.appendChild(el(\"li\", n));"));
  assert.ok(html.includes("list-style:disc"));
});

test("lists and multi-part objects are shown as bullets, and single values stay as text", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes("function valueNode(v, depth = 0)"));
  assert.ok(html.includes('ul.className = "vlist";'));
  assert.ok(html.includes("const value = el(\"span\", null, \"kv-value\");"));
  assert.ok(html.includes("value.appendChild(item.id === \"security.roles\" ? document.createTextNode(kvValue(item)) : valueNode(item.value));"));
  assert.ok(html.includes('summaryBox.appendChild(valueNode(summary));'));
  assert.ok(html.includes(".vlist{list-style:disc"));
});
