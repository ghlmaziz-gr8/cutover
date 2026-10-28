// Run: node --test service/app/test/file-map.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sandbox = {};
vm.runInNewContext(readFileSync(new URL("../file-map.js", import.meta.url), "utf8"), sandbox);
const { tree, statusOf } = sandbox.FileMap;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const files = (...paths) => paths.map((path) => ({ path }));

test("files are grouped by folder, with nested folders", () => {
  const map = tree({ files: files("src/web/Home.asp", "src/web/admin/Users.asp", "README.md") });
  const folders = map.children.filter((c) => c.kind === "folder");
  assert.equal(folders.length, 1);
  assert.equal(folders[0].label, "src");
  assert.equal(folders[0].meta, "2 files");
  const web = folders[0].children.find((c) => c.label === "web");
  assert.ok(web.children.some((c) => c.kind === "folder" && c.label === "admin"));
  assert.ok(map.children.some((c) => c.kind === "leaf" && c.path === "README.md"));
});

test("each file shows where it stands in conversion", () => {
  const map = tree({
    files: files("a/one.asp", "a/two.asp", "a/three.asp", "a/four.asp", "a/five.asp"),
    conversions: [
      { path: "a/one.asp", status: "ok", decision: "accepted" },
      { path: "a/two.asp", status: "ok", decision: null },
      { path: "a/three.asp", status: "ok", decision: "rejected" },
      { path: "a/four.asp", status: "blocked" },
    ],
  });
  const leaves = map.children[0].children;
  const tone = (p) => leaves.find((l) => l.path === p).tone;
  assert.equal(tone("a/one.asp"), "pro");
  assert.equal(tone("a/two.asp"), "possible");
  assert.equal(tone("a/three.asp"), "con");
  assert.equal(tone("a/four.asp"), "fit");
  assert.equal(tone("a/five.asp"), "plain");
  assert.ok(map.meta.includes("1 accepted") && map.meta.includes("1 not started"));
});

test("a status with no decision is a proposal waiting for review", () => {
  assert.equal(statusOf({ status: "ok", decision: "pending" }).text, "Proposed, to review");
  assert.equal(statusOf(undefined).text, "Not started");
});

test("a very large repository is capped and the note says so", () => {
  const many = Array.from({ length: 450 }, (_, i) => ({ path: `f/${i}.asp` }));
  const map = tree({ files: many });
  assert.ok(map.meta.includes("Showing the first 400 of 450 files."));
});

test("the conversion card shows the file map and picks a file into the input", () => {
  assert.ok(html.includes('<script src="file-map.js"></script>'));
  assert.ok(html.includes("FileMap.tree("));
  assert.ok(html.includes("onLeaf:"));
  assert.ok(html.includes("function drawNode("));
  assert.ok(html.includes('className = "mm-pick"') || html.includes('"mm-pick"'));
});

test("on the map, a draft ready file has its own tone, not the approved green", () => {
  const { deepStatusOf } = sandbox.FileMap;
  assert.equal(deepStatusOf({ state: "draft" }).tone, "draft");
  assert.equal(deepStatusOf({ state: "approved" }).tone, "pro");
  assert.match(html, /\.mm-leaf\.tone-draft \.mm-dot\{background:#4f46e5\}/);
  assert.match(html, /tones: \[\["pro", "Accepted or approved"\], \["draft", "Draft ready"\]/);
});
