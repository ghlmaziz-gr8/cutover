// The region list the intake form shows must match the list the Worker checks. Run: node --test service/app/test/regions.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REGIONS } from "../../worker/src/index.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the app's region list matches the Worker's, cloud by cloud", () => {
  const match = html.match(/const REGION_OPTS = (\{[\s\S]*?\n\s*\});/);
  assert.ok(match, "REGION_OPTS found in the app");
  const appList = Function(`"use strict"; return (${match[1]});`)();
  assert.deepEqual(Object.keys(appList).sort(), Object.keys(REGIONS).sort());
  for (const cloud of Object.keys(REGIONS)) assert.deepEqual(appList[cloud], REGIONS[cloud], cloud);
});
