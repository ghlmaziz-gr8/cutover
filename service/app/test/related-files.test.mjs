// Related files for a chosen file, and the order to assess files in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const guide = readFileSync(join(root, "guide.js"), "utf8");
const sandbox = {};
vm.runInNewContext(readFileSync(join(root, "file-map.js"), "utf8"), sandbox);
const { related, processingOrder } = sandbox.FileMap;

const paths = ["src/uploadimage.asp", "src/uploadsuccess.asp", "src/AJAX/gethint.asp",
  "inc/inc_upload.asp", "src/other.asp", "src/AJAX/getvalue.asp"];

test("a file with a similar name in the same folder ranks first, with the reasons", () => {
  const found = related("src/uploadimage.asp", paths);
  assert.equal(found[0].path, "src/uploadsuccess.asp");
  assert.match(found[0].reason, /same folder/);
  assert.match(found[0].reason, /similar name/);
});

test("an include file that shares the name is found, even in another folder", () => {
  const found = related("src/uploadimage.asp", paths).map((r) => r.path);
  assert.ok(found.includes("inc/inc_upload.asp"));
});

test("files with nothing in common are not suggested", () => {
  const found = related("src/AJAX/gethint.asp", paths).map((r) => r.path);
  assert.ok(!found.includes("inc/inc_upload.asp"));
  assert.ok(!found.includes("src/uploadimage.asp"));
});

test("the chosen file comes first, then related files, then the rest in path order", () => {
  const order = processingOrder("src/uploadimage.asp", paths);
  assert.equal(order[0], "src/uploadimage.asp");
  assert.equal(order[1], "src/uploadsuccess.asp");
  assert.equal(order.length, paths.length);
  assert.deepEqual([...order].sort(), [...paths].sort());
});

test("the limit caps the suggestions", () => {
  assert.equal(related("src/uploadimage.asp", paths, 1).length, 1);
});

test("the file view shows related files and the suggested order", () => {
  assert.match(html, /"Related files"/);
  assert.match(html, /window\.FileMap\.related\(f\.path, paths, 6\)/);
  assert.match(html, /Suggested order:/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /Choosing a file now suggests related files/);
});
