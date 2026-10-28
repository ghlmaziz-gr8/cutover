// The file-level results list only shows files whose deep assessment is approved. Text only, never markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const slice = (from, to) => html.slice(html.indexOf(from), html.indexOf(to));
const list = slice("  let deepFileStates = {};", "  // Shows where the file review sits in the workflow: scanning");
const approveAll = slice('$("filesApproveAll").addEventListener', '$("reviewFilesTop").addEventListener');

test("the file list keeps only files whose deep assessment is approved", () => {
  assert.ok(list.includes('(deepFileStates[f.path] || {}).state === "approved"'));
  assert.ok(list.includes("for (const f of shown) list.appendChild(fileItem(f));"));
  assert.ok(list.includes("updateFlow(counts, shown.length)"));
});

test("the file screen loads the deep states with the files", () => {
  const show = slice("  async function showFiles() {", "  // Feature groups: platform engineers");
  assert.ok(show.includes("deepFileStates = await loadDeepStates();"));
});

test("Approve all drafts approves only the drafts listed on the screen", () => {
  assert.ok(approveAll.includes("filesAfterDeep().filter((x) => x.review_status === \"draft\")"));
  assert.ok(!approveAll.includes("files/approve-all"));
});
