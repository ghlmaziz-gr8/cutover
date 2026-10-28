// The agent package: manifest, brief and one module per approved feature, packed as a store-only zip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { inflateRawSync } from "node:zlib";

const load = (file) => {
  const sandbox = {};
  vm.runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), sandbox);
  return sandbox;
};
const { PackageBuilder } = load("package-builder.js");
const { ModuleSpec } = load("module-spec.js");
const { Confidence } = load("confidence.js");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const assessment = {
  dropped: 0,
  functions: [{ name: "SaveOrder", purpose: "Stores an order.", calls: [] }],
  rules: [{ id: "R1", statement: "An order needs a customer.", condition: "a customer is given", outcome: "refused", function: "SaveOrder", lines: [4, 9] }],
  examples: [{ rule: "R1", given: "no customer", expect: "refused" }],
  database: { tables: [], queries: [] },
};
const data = {
  grouping: { id: "g-1", approved_by_email: "cio@acme.test", approved_at: "2026-10-27T20:00:00Z" },
  features: [
    { name: "Ordering", summary: "Takes orders.", files: [{ path: "src/Orders.asp", purpose: "Takes orders.", assessment }], stories: [] },
    { name: "Ordering", summary: "", files: [{ path: "src/Pending.asp", purpose: "", assessment: null }], stories: [] },
  ],
};
const ctx = { app: "ManageIT", approach: "Modern web front end over an API", scope: "modernize", targetLanguage: "TypeScript", targetChosenBy: "eng@acme.test", confidenceOf: Confidence.confidenceOf, ModuleSpec };

test("the package holds a manifest, a brief and one module per approved feature", () => {
  const { files, file } = PackageBuilder.build(data, ctx);
  assert.deepEqual(Object.keys(files).sort(), ["brief.md", "manifest.json", "modules/module-ordering-2.md", "modules/module-ordering.md"]);
  assert.equal(file, "cutover-package-manageit.zip");
});

test("the manifest lists each module with its approval, version and file status, and says sample data only", () => {
  const { files } = PackageBuilder.build(data, ctx);
  const m = JSON.parse(files["manifest.json"]);
  assert.equal(m.sample_data_only, true);
  assert.equal(m.agent_neutral, true);
  assert.equal(m.approval.approved_by, "cio@acme.test");
  assert.equal(m.target_language, "TypeScript");
  assert.equal(m.modules.length, 2);
  assert.equal(m.modules[0].status, "approved");
  assert.equal(m.modules[0].version, "g-1");
  assert.deepEqual(m.modules[1].files_without_approved_assessment, ["src/Pending.asp"]);
});

test("the brief holds the scope, approach, target and the rules every module follows", () => {
  const { files } = PackageBuilder.build(data, ctx);
  assert.match(files["brief.md"], /Scope: Modernize/);
  assert.match(files["brief.md"], /Approach: Modern web front end over an API/);
  assert.match(files["brief.md"], /Target language: TypeScript \(chosen by eng@acme\.test\)/);
  assert.match(files["brief.md"], /sample data only/i);
  assert.match(files["brief.md"], /Do not copy source code/);
  assert.match(files["brief.md"], /Do not add a module that is not listed/);
});

test("no agent or model is named anywhere in the package", () => {
  const { files } = PackageBuilder.build(data, ctx);
  const text = Object.values(files).join("\n");
  assert.doesNotMatch(text, /claude|anthropic|gpt|openai|gemini|haiku|sonnet|opus/i);
});

test("with no grouping approved there is no package", () => {
  assert.equal(PackageBuilder.build({ grouping: null, features: [] }, ctx), null);
});

test("the zip is readable, and each entry matches its text and CRC", () => {
  const { files } = PackageBuilder.build(data, ctx);
  const bytes = PackageBuilder.zip(files);
  const buf = Buffer.from(bytes);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50);
  assert.equal(buf.readUInt16LE(eocd + 10), Object.keys(files).length);
  let at = 0;
  const seen = {};
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const name = buf.toString("utf8", at + 30, at + 30 + nameLen);
    const data = buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    seen[name] = data.toString("utf8");
    assert.equal(PackageBuilder.crc32(data), buf.readUInt32LE(at + 14));
    at += 30 + nameLen + size;
  }
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(files).sort());
  assert.equal(seen["brief.md"], files["brief.md"]);
});

test("the zip stores the text as UTF-8 and is the same for the same input", () => {
  const files = { "a.md": "Café – ünïcode ✓" };
  assert.equal(Buffer.from(PackageBuilder.zip(files)).toString("utf8").includes("Café – ünïcode ✓"), true);
  assert.deepEqual(PackageBuilder.zip(files), PackageBuilder.zip(files));
});

test("the app offers a package download from the features card", () => {
  assert.match(html, /<script src="package-builder\.js"><\/script>/);
  assert.match(html, /Download package/);
  assert.match(html, /PackageBuilder\.build\(/);
});
