import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

const code = readFileSync(new URL("../starter.js", import.meta.url), "utf8");
const ctx = { globalThis: {}, TextEncoder };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const Starter = ctx.globalThis.Starter;

const findings = {
  "ui.screens": { value: ["Home", "Work list", "Work list"] },
  "ui.endpoints": { value: ["/visits.asp"] },
  "data.tables": { value: ["visits", "patients"] },
  "data.routines_in_code": { value: [{ name: "CalcTotals" }] },
  "legacy.dependencies": { value: [{ name: "jquery", version: "1.8" }] },
};

const paths = (input) => Starter.files(input).map((f) => f.path);

test("the web starter has a page per screen and a route per endpoint, with duplicates kept apart", () => {
  const list = paths({ template: "web-modern", findings });
  assert.ok(list.includes("web/pages/home.html"));
  assert.ok(list.includes("web/pages/work-list.html"));
  assert.ok(list.includes("web/pages/work-list-2.html"), "a duplicate screen name gets its own page");
  assert.ok(list.includes("api/routes/visits-asp.md"));
  assert.ok(list.includes("MAPPING.md") && list.includes("README.md"));
});

test("the data starter has a service per routine and a folder per table", () => {
  const list = paths({ template: "services-data", findings });
  assert.ok(list.includes("services/calctotals/README.md"));
  assert.ok(list.includes("db/tables/visits.md") && list.includes("db/tables/patients.md"));
  assert.ok(list.includes("db/migrations/.gitkeep"));
});

test("the container starter has a Dockerfile placeholder and the dependencies to upgrade", () => {
  const files = Starter.files({ template: "lift-contain", findings });
  const docker = files.find((f) => f.path === "Dockerfile");
  assert.match(docker.text, /REPLACE_WITH_BASE_IMAGE/);
  const deps = files.find((f) => f.path === "DEPENDENCIES.md");
  assert.match(deps.text, /- jquery: upgrade to a supported version/);
});

test("the map lists every old item with its new place and says nothing has started", () => {
  const map = Starter.files({ template: "web-modern", findings }).find((f) => f.path === "MAPPING.md").text;
  assert.match(map, /\| Work list \| Screen \| web\/pages\/work-list-2\.html \| Not started \|/);
  assert.match(map, /\| \/visits\.asp \| Endpoint \| api\/routes\/visits-asp\.md \| Not started \|/);
});

test("no value from the code is copied into the starter", () => {
  const withValue = { ...findings, "data.tables": { value: ["visits 555-0100"] } };
  const leak = Starter.files({ template: "web-modern", findings: { "ui.endpoints": { value: ["/x?ssn=555-0100", "jane@example.com", "/visits.asp"] } } });
  const text = leak.map((f) => f.text).join("\n");
  assert.ok(!text.includes("555-0100"), "a number that looks like personal data must not appear");
  assert.ok(!text.includes("jane@example.com"), "an email address must not appear");
  assert.ok(text.includes("/visits.asp"), "ordinary structure names still appear");
});

test("the zip is readable by a standard zip tool and holds every file", () => {
  const files = Starter.files({ template: "lift-contain", findings });
  const bytes = Starter.zip(files.map((f) => ({ path: f.path, text: f.text })));
  const dir = mkdtempSync(join(tmpdir(), "starter-"));
  const file = join(dir, "starter.zip");
  writeFileSync(file, bytes);
  const listing = execFileSync("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('\\n'.join(z.namelist()))", file], { encoding: "utf8" });
  const names = listing.trim().split("\n").sort();
  assert.deepEqual(names, Array.from(files.map((f) => f.path)).sort());
});

test("the crc32 check value is right", () => {
  assert.equal(Starter.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
