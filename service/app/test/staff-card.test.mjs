// The Staff tab: its markup, the API routes it calls, and who may see it.
//   node --test service/app/test/staff-card.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const workerSrc = readFileSync(new URL("../../worker/src/index.mjs", import.meta.url), "utf8");

test("the staff card and its tabs exist on the page", () => {
  for (const id of ["staffCard", "tabStaff", "staffTabTracker", "staffTabHeat", "staffTabAccess", "staffKpis",
    "staffFunnel", "staffRows", "staffSearch", "staffWs", "staffCsv", "staffHeat", "staffHeatCanvas", "staffAccess",
    "staffForm", "staffList"]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
});

test("the staff card calls only routes the Worker serves", () => {
  const calls = [...html.matchAll(/api\(`?"?(\/api\/[^`"?]+)/g)].map((m) => m[1]);
  assert.ok(calls.includes("/api/staff/invitations"));
  assert.ok(calls.includes("/api/staff"));
  assert.ok(workerSrc.includes('path === "/api/staff/invitations"'));
  assert.ok(workerSrc.includes('path === "/api/staff" && method === "POST"'));
  assert.ok(workerSrc.includes("const staffOne = path.match("));
});

test("the tab shows to anyone with a platform role; the heat map is for super users and admins; access is for those who can invite", () => {
  assert.ok(html.includes('if (staffRoles.length) available.push("staff");'));
  assert.ok(html.includes('$("staffTabAccess").hidden = !staffRoles.some((r) => ["super_user", "admin", "sales"].includes(r));'));
  assert.ok(html.includes('$("staffTabHeat").hidden = !staffRoles.some((r) => r === "super_user" || r === "admin");'));
  assert.ok(html.includes('if (who === "staff") return !!((me.staff_roles || []).length);'));
});

test("the heat map in the staff card stays anonymous: it reads the same route as the workspace heat map", () => {
  assert.ok(html.includes("/heatmap?screen="));
  assert.ok(!/staff[^\n]*user_id|clicked_by|clicker/i.test(html.slice(html.indexOf("Staff: invitation tracker"), html.indexOf("The database size against"))));
});
