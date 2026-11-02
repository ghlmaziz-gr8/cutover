// Tests for the RFP helpers: splitting an RFP into requirements, and finding personal values.
//   node --test service/worker/test/rfp.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRequirements, findSensitive, STARTER_CAPABILITIES } from "../src/rfp.mjs";

const RFI_EXCERPT = `SECTION 3: TECHNICAL REQUIREMENTS
3.1 Hosting and architecture
The proposed solution shall run on a commercial cloud platform with FedRAMP authorization.
The contractor must migrate the general ledger, including all open balances, without loss of history.
Proposers should describe their approach to decommissioning the legacy mainframe.
3.2 Interfaces
- The solution shall provide a secure interface for vendor payment files.
- Interfaces will be documented and tested before go-live.
Every interface is listed in the attachment.
Sample file format is attached to this document.
The total budget for this procurement is shown in Attachment B.
The contractor must provide the solution by the agreed date. The contractor must provide the solution by the agreed date.
`;

test("each requirement sentence becomes one item, with the section it came from", () => {
  const found = extractRequirements(RFI_EXCERPT);
  assert.equal(found.length, 5, JSON.stringify(found.map((f) => f.text)));
  assert.equal(found[0].section, "3.1 Hosting and architecture");
  assert.equal(found[0].text, "The proposed solution shall run on a commercial cloud platform with FedRAMP authorization.");
  assert.equal(found[2].section, "3.2 Interfaces");
  assert.equal(found[2].text, "The solution shall provide a secure interface for vendor payment files.");
});

test("a repeated requirement is kept once, and background sentences without requirement words are left out", () => {
  const found = extractRequirements(RFI_EXCERPT);
  const texts = found.map((f) => f.text);
  assert.equal(texts.filter((t) => t === "The contractor must provide the solution by the agreed date.").length, 1);
  assert.ok(!texts.some((t) => t.includes("total budget")), "a sentence with no requirement word is not a requirement");
  assert.ok(!texts.some((t) => t.includes("should describe")), "a soft word such as should does not make a requirement by itself");
});

test("empty or blank text gives no requirements", () => {
  assert.deepEqual(extractRequirements(""), []);
  assert.deepEqual(extractRequirements("   \n\n  "), []);
  assert.deepEqual(extractRequirements(undefined), []);
});

test("the sensitive check reports kinds and counts only, never the values", () => {
  const text = "Write to buyer@agency.example.gov or call (410) 555-0147. SSN 123-45-6789. Server 10.0.0.12.";
  const found = findSensitive(text);
  assert.deepEqual(found.map((f) => f.kind).sort(), ["IP address", "email address", "national ID number", "phone number"].sort());
  assert.ok(found.every((f) => typeof f.count === "number" && !("value" in f)));
});

test("dates, budget figures and contract numbers are not flagged", () => {
  const text = "The contract E00B5600025 runs from December 5, 2024 to 2028-12-04 for $72,666,343.60, with 29% MBE and reference COM660001.";
  assert.deepEqual(findSensitive(text), []);
});

test("the starter list has unique names and every entry has a description", () => {
  const names = STARTER_CAPABILITIES.map(([name]) => name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(STARTER_CAPABILITIES.every(([, description]) => description.length > 20));
});
