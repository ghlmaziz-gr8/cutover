// The three Modernize proposals sit with the approach choice on Advance with Cutover, not under the deeper assessment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the proposals render into the approach card, not the deeper assessment", () => {
  assert.ok(html.includes('<div id="approachProposals"></div>'));
  assert.ok(!html.includes('<div id="deeperModern"></div>'));
  assert.ok(html.includes('const box = $("approachProposals");'));
  assert.ok(html.includes("renderModernize(row.findings && row.findings.deeper);"));
});
