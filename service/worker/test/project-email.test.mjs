// Project emails: the checks on what a sender writes, and the rich email built from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITY_CATALOGUE, checkProjectEmail, checkProjectFields, renderProjectEmail, esc } from "../src/project-email.mjs";

const PDF = Buffer.from("%PDF-1.4 test file").toString("base64");
const PPTX = Buffer.from("PK\u0003\u0004 test deck").toString("base64");
const TXT = Buffer.from("plain text that is not a PDF").toString("base64");
const good = (extra = {}) => ({ found: "Their COBOL codebase has 40 programs.", how_helps: "Cutover maps the rules first.", ...extra });

test("a project email needs what we found or how Cutover helps", () => {
  assert.match(checkProjectEmail({}).error, /what you found/);
  assert.ok(checkProjectEmail({ found: "x" }).value);
  assert.ok(checkProjectEmail({ how_helps: "y" }).value);
});

test("the share and hours must be whole numbers in range", () => {
  assert.match(checkProjectEmail(good({ cutover_share: 101 })).error, /0 to 100/);
  assert.match(checkProjectEmail(good({ cutover_share: 33.5 })).error, /0 to 100/);
  assert.match(checkProjectEmail(good({ human_hours_saved: -4 })).error, /whole number/);
  assert.equal(checkProjectEmail(good({ cutover_share: 60, human_hours_saved: 1200 })).value.human_hours_saved, 1200);
});

test("capabilities default to the full approved list, and a chosen subset keeps the catalogue order", () => {
  assert.equal(checkProjectEmail(good()).value.capability_ids, "all");
  assert.equal(CAPABILITY_CATALOGUE.length, 15);
  const picked = checkProjectEmail(good({ capability_ids: ["C07", "C02"] })).value.capability_ids;
  assert.deepEqual(picked, ["C02", "C07"]);
  assert.match(checkProjectEmail(good({ capability_ids: ["C99"] })).error, /approved list/);
  assert.match(checkProjectEmail(good({ capability_ids: [] })).error, /at least one/);
});

test("only PDF and PowerPoint files are attached, recognised by their first bytes", () => {
  const ok = checkProjectEmail(good({ attachments: [{ filename: "Findings.pdf", content_base64: PDF }, { filename: "Deck.pptx", content_base64: PPTX }] }));
  assert.deepEqual(ok.value.attachments.map((a) => a.filename), ["Findings.pdf", "Deck.pptx"]);
  assert.match(checkProjectEmail(good({ attachments: [{ filename: "notes.pdf", content_base64: TXT }] })).error, /PDF or a PowerPoint/);
  assert.match(checkProjectEmail(good({ attachments: [{ filename: "deck.docx", content_base64: PDF }] })).error, /PDF or a PowerPoint/);
  assert.match(checkProjectEmail(good({ attachments: [{ filename: "x.pdf", content_base64: "not base64!" }] })).error, /could not be read/);
  const six = Array.from({ length: 6 }, (_, i) => ({ filename: `f${i}.pdf`, content_base64: PDF }));
  assert.match(checkProjectEmail(good({ attachments: six })).error, /up to 5/);
});

test("a project needs a name of 2 to 120 characters", () => {
  assert.match(checkProjectFields({ name: "x" }, true).error, /2 to 120/);
  assert.equal(checkProjectFields({ name: "  Maryland FMIS  " }, true).value.name, "Maryland FMIS");
  assert.deepEqual(checkProjectFields({}, false).value, {});
});

test("the email escapes what the sender typed, shows the share, hours, advantages and every capability", () => {
  const mail = renderProjectEmail({
    projectName: "Maryland FMIS", greetingName: "Pat", note: "Good to meet you", found: "<script>alert(1)</script> 40 programs",
    howHelps: "Maps the rules", share: 60, hours: 1200, advantages: ["Faster discovery"], attachments: [{ filename: "Findings.pdf" }],
    senderName: "Mustafa Aziz", senderEmail: "sales@cutover.test", bookingUrl: "https://cutover.site/book/?t=abc", capabilityIds: "all",
  });
  assert.match(mail.html, /&lt;script&gt;/);
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.html, /Cutover: 60%/);
  assert.match(mail.html, /Your team and partners: 40%/);
  assert.match(mail.html, /1,200 hours/);
  assert.match(mail.html, /Faster discovery/);
  assert.match(mail.html, /https:\/\/cutover\.site\/book\/\?t=abc/);
  for (const c of CAPABILITY_CATALOGUE) assert.match(mail.html, new RegExp(esc(c.name)));
  assert.match(mail.text, /Hi Pat,/);
  assert.match(mail.text, /- Findings\.pdf/);
  assert.equal(mail.subject, "Maryland FMIS: what we found and how Cutover helps");
});

test("a chosen subset shows only those capabilities", () => {
  const mail = renderProjectEmail({ projectName: "P", found: "x", advantages: [], attachments: [], senderEmail: "a@b.test", capabilityIds: ["C01", "C02"] });
  assert.match(mail.html, /Legacy application assessment/);
  assert.doesNotMatch(mail.html, /Jira push of features/);
  assert.match(mail.html, /2 Cutover capabilities for this project/);
});
