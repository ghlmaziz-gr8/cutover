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

test("a file that calls a function another file defines is related, with the call as the reason", () => {
  const links = {
    "src/uploadimage.asp": { defines: ["SaveImage"], calls: ["CheckSize"] },
    "src/AJAX/gethint.asp": { defines: ["Hint"], calls: [] },
    "src/other.asp": { defines: ["CheckSize"], calls: ["Hint"] },
  };
  const found = related("src/uploadimage.asp", paths, 6, links);
  const other = found.find((r) => r.path === "src/other.asp");
  assert.match(other.reason, /calls CheckSize/);
  const hint = related("src/uploadimage.asp", paths, 6, links).find((r) => r.path === "src/AJAX/gethint.asp");
  assert.equal(hint, undefined, "no link to gethint without a shared name or folder");
});

test("the limit caps the suggestions", () => {
  assert.equal(related("src/uploadimage.asp", paths, 1).length, 1);
});

test("the file view shows related files as a chord diagram and the order as a tree", () => {
  assert.match(html, /window\.FileMap\.related\(f\.path, paths, 6, links\)/);
  assert.match(html, /function relatedView\(f, near, paths, links, deep = \{\}\)/);
  assert.match(html, /Order to assess/);
  assert.match(html, /\.rel-tree\.is-on \.rel-row/);
  assert.match(html, /\.rc-link\{[^}]*stroke-dashoffset:1/);
});

test("the chord diagram and tree stop animating under reduced motion, and the tree is one step at a time", () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{\.rc-link,\.rc-node,\.rel-row,\.rel-more\{transition:none!important\}\}/);
  assert.match(html, /row\.style\.setProperty\("--d", `\$\{i \* 110\}ms`\);/);
});

test("the change is listed in What's new", () => {
  assert.match(guide, /Choosing a file now suggests related files/);
});

test("each file in the order shows where it stands: approved and draft ready have different colours", () => {
  assert.match(html, /const STATE_COLOURS = \{ approved: "#059669", draft: "#4f46e5", running: "#d97706", failed: "#d0524a", superseded: "#6b7280" \};/);
  assert.match(html, /window\.FileMap\.deepStatusOf\(deep\[path\]\)/);
  assert.match(html, /num\.style\.background = colour;/);
  assert.match(html, /businessFiles\.deep = deep;/);
  assert.match(html, /relatedView\(f, near, paths, links, businessFiles\.deep \|\| \{\}\)/);
  assert.notEqual(
    html.match(/approved: "(#[0-9a-f]{6})"/)[1],
    html.match(/draft: "(#[0-9a-f]{6})"/)[1],
    "draft ready must not be green like approved",
  );
});

test("after an approve or discard, the file states are loaded again so the order shows the change", () => {
  assert.match(html, /deepCard\(a, \(\) => refreshAfterChange\(f\.path\), msg, f\.path\)/);
  assert.match(html, /async function refreshAfterChange\(path\) \{\n\s+businessFiles\.deep = await loadDeepStates\(\);\n\s+showBusinessFile\(path\);/);
});

test("the file colours hold still while a file is open: a finished run does not redraw the map, Refresh and your own actions do", () => {
  assert.doesNotMatch(html, /if \(wasRunning && !running && businessFiles\.analysis === cur\.id\) renderBusinessFiles\(\);/);
  assert.match(html, /refresh\.addEventListener\("click", async \(\) => \{\n\s+if \(businessFiles\.analysis === cur\.id\) await renderBusinessFiles\(\);\n\s+load\(\);/);
  assert.match(html, /if \(businessFiles\.analysis === cur\.id\) renderBusinessFiles\(\);\n\s+load\(\);/);
});
