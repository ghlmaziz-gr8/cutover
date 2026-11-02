// Project emails: a rich email to a prospect about one project of theirs. This module only checks the request and
// builds the HTML and text. The Worker sends it. Nothing here touches the database or the network.

export const PROJECT_NAME_MAX = 120;
export const PROJECT_SUMMARY_MAX = 1000;
export const PROJECT_EMAIL_SUBJECT_MAX = 200;
export const PROJECT_EMAIL_NOTE_MAX = 1000;
export const PROJECT_EMAIL_TEXT_MAX = 2000;
export const PROJECT_ADVANTAGES_MAX = 8;
export const PROJECT_ADVANTAGE_MAX = 200;
export const PROJECT_ATTACHMENTS_MAX = 5;
export const PROJECT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PROJECT_ATTACHMENTS_TOTAL_MAX_BYTES = 20 * 1024 * 1024;

// The approved Cutover capabilities, in the order they are shown. The ids are stable, and an email stores them.
export const CAPABILITY_CATALOGUE = [
  { id: "C01", name: "Legacy application assessment", description: "Reads a repository's code, identifies the languages and frameworks (Node, Python, .NET, PHP and Java), and lists the components and any missing items." },
  { id: "C02", name: "Business rule discovery", description: "Lists each business rule found in the code, with the file and line it comes from." },
  { id: "C03", name: "Per-file findings", description: "Gives every file its purpose and suggested improvements, one row per file, with a confidence level." },
  { id: "C04", name: "Deeper business, systems and data analysis", description: "Produces business, systems and data analysis documents, workflows and an architecture diagram from the assessment." },
  { id: "C05", name: "Capability and feature grouping", description: "Groups features into business capabilities. Any signed-in user can rename a capability." },
  { id: "C06", name: "Readiness checks and user stories", description: "Checks each feature for readiness and drafts user stories that trace back to the rules they come from." },
  { id: "C07", name: "Scope and effort ranges", description: "Sets scope with effort ranges. Modernize and migrate stay locked until the deeper assessment is complete." },
  { id: "C08", name: "Contingency planning and signed PDF export", description: "Plans contingencies after the review and exports the report as a signed PDF built from stored rows." },
  { id: "C09", name: "Modernization proposals", description: "Three future-state options for a web application, each with its trade-offs, built from the deeper assessment." },
  { id: "C10", name: "Cloud choice and Terraform draft", description: "Records the chosen cloud (Google Cloud, AWS or Azure) and a short intake form, then generates a Terraform draft that lists its inputs. Every version is kept." },
  { id: "C11", name: "Module specifications and build package", description: "A specification per feature with worked examples, and a package of Markdown and JSON that any AI agent can build from." },
  { id: "C12", name: "Jira push of features and stories", description: "Pushes approved features and stories to Jira, updating existing items instead of creating duplicates." },
  { id: "C13", name: "Sample data and personal-data scanning", description: "Outputs use sample data only. A scanner checks for email addresses, phone numbers, national ID and record-number patterns before anything is saved." },
  { id: "C14", name: "Bring-your-own language model", description: "Each workspace uses its own model key, stored encrypted and never shown again. Model use needs a current privacy sign-off." },
  { id: "C15", name: "Roles, workspace access and assessment locks", description: "Platform engineers, application owners, security, informatics, CIO and CTO, and auditors each see what their role needs. One assessment runs at a time per workspace." },
];

const PDF_MIME = "application/pdf";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// Checks the name and summary of a project. Returns { value } or { error }.
export function checkProjectFields(value, requireName) {
  const out = {};
  if (value.name !== undefined || requireName) {
    const name = String(value.name ?? "").trim();
    if (name.length < 2 || name.length > PROJECT_NAME_MAX) return { error: `The project name must be 2 to ${PROJECT_NAME_MAX} characters.` };
    out.name = name;
  }
  if (value.summary !== undefined) {
    const summary = String(value.summary ?? "").trim();
    if (summary.length > PROJECT_SUMMARY_MAX) return { error: `The summary must be ${PROJECT_SUMMARY_MAX} characters or fewer.` };
    out.summary = summary || null;
  }
  return { value: out };
}

// Decoded size of a base64 string, without decoding it.
export function base64DecodedBytes(b64) {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

// Recognises the file by its first bytes, not by its name. Returns the MIME type, or null.
export function attachmentType(filename, b64) {
  const lower = filename.toLowerCase();
  const head = atob(b64.slice(0, 8));
  if (lower.endsWith(".pdf") && head.startsWith("%PDF")) return PDF_MIME;
  if (lower.endsWith(".pptx") && head.startsWith("PK\u0003\u0004")) return PPTX_MIME;
  return null;
}

// Checks the attachments of one email: PDF or PPTX only, each within its size limit, and the total within its limit.
export function checkAttachments(list) {
  if (list === undefined || list === null) return { value: [] };
  if (!Array.isArray(list)) return { error: "Attachments must be a list." };
  if (list.length > PROJECT_ATTACHMENTS_MAX) return { error: `Attach up to ${PROJECT_ATTACHMENTS_MAX} files.` };
  const out = [];
  let total = 0;
  for (const item of list) {
    const filename = String(item?.filename ?? "").trim().slice(0, 120);
    const b64 = String(item?.content_base64 ?? "").replace(/\s+/g, "");
    if (!filename) return { error: "Each attachment needs a file name." };
    if (!b64 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return { error: `${filename} could not be read.` };
    const bytes = base64DecodedBytes(b64);
    if (bytes > PROJECT_ATTACHMENT_MAX_BYTES) return { error: `${filename} is larger than 10 MB.` };
    total += bytes;
    if (total > PROJECT_ATTACHMENTS_TOTAL_MAX_BYTES) return { error: "The attachments together are larger than 20 MB." };
    const type = attachmentType(filename, b64);
    if (!type) return { error: `${filename} must be a PDF or a PowerPoint (.pptx) file.` };
    out.push({ filename, content_type: type, content_base64: b64, bytes });
  }
  return { value: out };
}

function cleanLine(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

// Checks the content of one project email. Returns { value } or { error }.
export function checkProjectEmail(body) {
  const found = cleanLine(body.found, PROJECT_EMAIL_TEXT_MAX);
  const howHelps = cleanLine(body.how_helps, PROJECT_EMAIL_TEXT_MAX);
  if (!found && !howHelps) return { error: "Write what you found, or how Cutover helps, or both." };
  const note = cleanLine(body.note, PROJECT_EMAIL_NOTE_MAX);
  const subject = cleanLine(body.subject, PROJECT_EMAIL_SUBJECT_MAX);

  let share = null;
  if (body.cutover_share !== undefined && body.cutover_share !== null && body.cutover_share !== "") {
    share = Number(body.cutover_share);
    if (!Number.isInteger(share) || share < 0 || share > 100) return { error: "The Cutover share must be a whole number from 0 to 100." };
  }
  let hours = null;
  if (body.human_hours_saved !== undefined && body.human_hours_saved !== null && body.human_hours_saved !== "") {
    hours = Number(body.human_hours_saved);
    if (!Number.isInteger(hours) || hours < 0 || hours > 1000000) return { error: "The hours saved must be a whole number of hours." };
  }

  const rawAdvantages = body.advantages === undefined || body.advantages === null ? [] : body.advantages;
  if (!Array.isArray(rawAdvantages)) return { error: "Advantages must be a list." };
  const advantages = rawAdvantages.map((a) => cleanLine(a, PROJECT_ADVANTAGE_MAX)).filter(Boolean);
  if (advantages.length > PROJECT_ADVANTAGES_MAX) return { error: `List up to ${PROJECT_ADVANTAGES_MAX} advantages.` };

  // "all" (the default) sends the full approved list. Otherwise the sender picks some of the approved ids.
  let capabilityIds = "all";
  if (body.capability_ids !== undefined && body.capability_ids !== null && body.capability_ids !== "all") {
    if (!Array.isArray(body.capability_ids)) return { error: "Choose the capabilities as a list, or leave it on all." };
    const known = new Set(CAPABILITY_CATALOGUE.map((c) => c.id));
    const picked = [...new Set(body.capability_ids.map(String))];
    if (!picked.length) return { error: "Choose at least one capability, or send the full list." };
    const unknown = picked.filter((id) => !known.has(id));
    if (unknown.length) return { error: "One of the chosen capabilities is not on the approved list." };
    capabilityIds = CAPABILITY_CATALOGUE.map((c) => c.id).filter((id) => picked.includes(id));
  }

  const attachments = checkAttachments(body.attachments);
  if (attachments.error) return { error: attachments.error };

  return { value: { subject, note: note || null, found: found || null, how_helps: howHelps || null, cutover_share: share, human_hours_saved: hours, advantages, capability_ids: capabilityIds, attachments: attachments.value } };
}

// Escapes text for HTML. Every piece of user text goes through this.
export function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function paragraphs(text) {
  return String(text).split(/\n{2,}|\n/).filter((p) => p.trim()).map((p) => `<p style="margin:0 0 12px;line-height:1.55">${esc(p)}</p>`).join("");
}

function section(title, inner) {
  return `<tr><td style="padding:0 32px 24px"><h2 style="margin:0 0 10px;font-size:17px;color:#1d1640">${esc(title)}</h2>${inner}</td></tr>`;
}

// Builds the subject, HTML and plain-text versions of one project email.
export function renderProjectEmail(input) {
  const { projectName, greetingName, note, found, howHelps, senderName, senderEmail, bookingUrl } = input;
  const share = input.share ?? null;
  const hours = input.hours ?? null;
  const advantages = input.advantages ?? [];
  const attachments = input.attachments ?? [];
  const capabilityIds = input.capabilityIds ?? "all";
  const caps = CAPABILITY_CATALOGUE.filter((c) => capabilityIds === "all" || capabilityIds.includes(c.id));
  const subject = input.subject || `${projectName}: what we found and how Cutover helps`;

  const sections = [];
  if (found) sections.push(section("What we found", paragraphs(found)));
  if (howHelps) sections.push(section("How Cutover helps", paragraphs(howHelps)));

  if (share !== null) {
    const rest = 100 - share;
    sections.push(section("Where Cutover takes the work",
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px"><tr>` +
      `<td width="${share}%" style="background:#7c3aed;height:16px;font-size:0;line-height:0">&nbsp;</td>` +
      `<td width="${rest}%" style="background:#e5e0f3;height:16px;font-size:0;line-height:0">&nbsp;</td></tr></table>` +
      `<p style="margin:0 0 4px;font-size:14px"><b style="color:#7c3aed">Cutover: ${share}%</b> &middot; Your team and partners: ${rest}%</p>`));
  }
  if (hours !== null) {
    sections.push(section("Human hours saved", `<p style="margin:0;font-size:30px;font-weight:bold;color:#db2777">${hours.toLocaleString("en-US")} hours</p><p style="margin:4px 0 0;font-size:13px;color:#6b6480">Hours of manual analysis and specification work that Cutover handles.</p>`));
  }
  if (advantages.length) {
    sections.push(section("Advantages", `<ul style="margin:0;padding-left:20px;line-height:1.6">${advantages.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`));
  }

  const cards = [];
  for (let i = 0; i < caps.length; i += 2) {
    const pair = caps.slice(i, i + 2).map((c) => `<td width="50%" valign="top" style="padding:8px;background:#f7f5fc;border-radius:12px"><b style="font-size:14px;color:#1d1640">${esc(c.name)}</b><div style="font-size:13px;color:#4b4566;margin-top:4px;line-height:1.45">${esc(c.description)}</div></td>`);
    if (pair.length === 1) pair.push('<td width="50%"></td>');
    cards.push(`<tr>${pair.join('<td style="width:8px"></td>')}</tr><tr><td style="height:8px"></td></tr>`);
  }
  const capHeading = capabilityIds === "all" ? `All ${caps.length} approved Cutover capabilities` : `${caps.length} Cutover capabilities for this project`;
  sections.push(section(capHeading, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${cards.join("")}</table>`));

  if (attachments.length) {
    sections.push(section("Attached", `<ul style="margin:0;padding-left:20px;line-height:1.6">${attachments.map((a) => `<li>${esc(a.filename)}</li>`).join("")}</ul>`));
  }

  const cta = bookingUrl ? `<tr><td align="center" style="padding:8px 32px 32px"><a href="${esc(bookingUrl)}" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:13px 26px;border-radius:999px;text-decoration:none;font-weight:bold">Book a meeting</a></td></tr>` : "";
  const greeting = greetingName ? `Hi ${esc(greetingName)},` : "Hello,";
  const noteHtml = note ? `<p style="margin:0 0 16px;line-height:1.55">${esc(note)}</p>` : "";

  const html = `<div style="background:#f4f1fb;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1d1640">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden">` +
    `<tr><td style="background:linear-gradient(135deg,#7c3aed,#db2777);padding:28px 32px;color:#ffffff">` +
    `<div style="font-size:13px;opacity:.85">Cutover</div><div style="font-size:22px;font-weight:bold;margin-top:6px">${esc(projectName)}</div></td></tr>` +
    `<tr><td style="padding:28px 32px 16px"><p style="margin:0 0 14px;line-height:1.55">${greeting}</p>${noteHtml}</td></tr>` +
    sections.join("") + cta +
    `<tr><td style="padding:16px 32px;background:#faf9fd;font-size:12px;color:#6b6480;line-height:1.5">Sent by ${esc(senderName || senderEmail)} from Cutover. Reply to this email to reach ${esc(senderName || senderEmail)}.</td></tr>` +
    `</table></td></tr></table></div>`;

  const textLines = [greeting, "", ...(note ? [note, ""] : [])];
  if (found) textLines.push("What we found", found, "");
  if (howHelps) textLines.push("How Cutover helps", howHelps, "");
  if (share !== null) textLines.push(`Where Cutover takes the work: Cutover ${share}%, your team and partners ${100 - share}%`, "");
  if (hours !== null) textLines.push(`Human hours saved: ${hours}`, "");
  if (advantages.length) textLines.push("Advantages", ...advantages.map((a) => `- ${a}`), "");
  textLines.push(capHeading, ...caps.map((c) => `- ${c.name}: ${c.description}`), "");
  if (attachments.length) textLines.push("Attached", ...attachments.map((a) => `- ${a.filename}`), "");
  if (bookingUrl) textLines.push(`Book a meeting: ${bookingUrl}`, "");
  textLines.push(`Sent by ${senderName || senderEmail} from Cutover. Reply to this email to reach them.`);

  return { subject, html, text: textLines.join("\n") };
}
