// Capabilities: each names features by position, every feature is in exactly one capability, and any member can rename one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkCapabilities, checkGroups } from "../src/index.mjs";

const group = (name, paths) => ({ name, summary: "", paths });
const allowed = new Set(["a.asp", "b.asp", "c.asp"]);
const groups = [group("Upload", ["a.asp"]), group("Storage", ["b.asp"]), group("Callback", ["c.asp"])];

test("a capability can hold more than one feature, and every feature is in one capability", () => {
  const r = checkCapabilities([{ name: "Uploads", summary: "s", features: [0, 1] }, { name: "Returns", features: [2] }], 3);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.capabilities.map((c) => c.features), [[0, 1], [2]]);
});

test("a feature in no capability, or in two, is refused", () => {
  assert.match(checkCapabilities([{ name: "Uploads", features: [0, 1] }], 3).error, /Every feature must be in a capability/);
  assert.match(checkCapabilities([{ name: "Uploads", features: [0, 1] }, { name: "Other", features: [1, 2] }], 3).error, /one capability only/);
});

test("a capability that names a feature not in the grouping is refused", () => {
  assert.match(checkCapabilities([{ name: "Uploads", features: [0, 5] }], 3).error, /not in the grouping/);
});

test("a capability needs a name and at least one feature", () => {
  assert.match(checkCapabilities([{ name: "  ", features: [0] }], 1).error, /needs a name/);
  assert.match(checkCapabilities([{ name: "Uploads", features: [] }], 1).error, /at least one feature/);
});

test("a grouping without capabilities stays as it was, with capabilities set to null", () => {
  const r = checkGroups(groups, allowed);
  assert.equal(r.error, undefined);
  assert.equal(r.capabilities, null);
});

test("a grouping with capabilities checks both levels together", () => {
  const r = checkGroups(groups, allowed, [{ name: "Uploads", features: [0, 1] }, { name: "Returns", features: [2] }]);
  assert.equal(r.error, undefined);
  assert.equal(r.capabilities.length, 2);
  assert.equal(r.groups.length, 3);
});

test("the capability level is stored, read back and renamed by any member", () => {
  const sql = readFileSync(new URL("../../supabase/add-capabilities.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists capabilities jsonb/);
  assert.match(sql, /'capability_rename'/);
  const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.match(src, /feature_groupings\?analysis_id=eq\.\$\{id\}&status=eq\.approved&select=id,groups,capabilities/);
  assert.ok(src.includes("path.match(/^\\/api\\/analyses\\/([^/]+)\\/capabilities$/)"));
  // The rename checks membership only, not the platform engineer role.
  const fn = src.slice(src.indexOf("async function renameCapability"), src.indexOf("async function startGrouping"));
  assert.match(fn, /analysisAccess\(env, request, id\)/);
  assert.doesNotMatch(fn, /canStart/);
  assert.match(fn, /capability_rename/);
});
