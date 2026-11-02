// RFP reviews: pure helpers with no database or network calls, so they can be tested on their own.
// The Worker uses them for the requirement list and the sensitive-data check.

export const RFP_TEXT_MAX = 200000;
export const RFP_REQUIREMENT_MIN = 3;
export const RFP_REQUIREMENT_MAX = 2000;
export const RFP_REQUIREMENTS_MAX = 400;

// Words that make a sentence a requirement in an RFP or RFI. Softer words such as "should" or "support" are left out,
// since they are common in background text. Bullet points always count, so a list is never missed.
const REQUIREMENT_WORDS = /\b(shall|must|will|required|requires?|mandatory|minimum)\b/i;
// A heading: a short line with a section number, or all capitals, and no full stop at the end.
const SECTION_NUMBER = /^(\d+(\.\d+)*|[A-Z])[.)]?\s+\S/;
const LABEL_PREFIX = /^(section|part|attachment|appendix)\s+\S+/i;

function isHeading(line) {
  if (line.length > 90 || /[.;:]$/.test(line)) return false;
  if (LABEL_PREFIX.test(line)) return true;
  if (line === line.toUpperCase() && /[A-Z]{3,}/.test(line)) return true;
  return SECTION_NUMBER.test(line) && line.split(/\s+/).length <= 10;
}

// Each candidate line is a requirement: a bullet or numbered item, or a sentence with a requirement word.
// Sentences in one paragraph are split on full stops, so each requirement is its own row.
export function extractRequirements(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  const seen = new Set();
  let section = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeading(line)) {
      section = line.replace(/\s+/g, " ").slice(0, 200);
      continue;
    }
    const bullet = /^([-*•]|\(?[a-z0-9]{1,3}[.)])\s+/i.test(line);
    const body = line.replace(/^([-*•]|\(?[a-z0-9]{1,3}[.)])\s+/i, "");
    const pieces = body.split(/(?<=[.!?])\s+(?=[A-Z(])/);
    for (const piece of pieces) {
      const sentence = piece.replace(/\s+/g, " ").trim();
      if (sentence.length < RFP_REQUIREMENT_MIN || sentence.length > RFP_REQUIREMENT_MAX) continue;
      if (!bullet && !REQUIREMENT_WORDS.test(sentence)) continue;
      const key = sentence.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ section, text: sentence });
      if (out.length >= RFP_REQUIREMENTS_MAX) return out;
    }
  }
  return out;
}

// Finds sensitive-looking values in RFP text. Returns counts per kind only, never the values themselves.
// The same patterns as the sample scrubber, with phone numbers held to a stricter format so dates are not flagged.
const SENSITIVE_KINDS = [
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ["national ID number", /\b\d{3}-\d{2}-\d{4}\b/g],
  ["phone number", /(?:\+\d{1,3}[\s-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g],
  ["IP address", /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  ["long record number", /\b\d{9,}\b/g],
];

export function findSensitive(text) {
  const found = [];
  const source = String(text || "");
  for (const [kind, pattern] of SENSITIVE_KINDS) {
    const count = (source.match(pattern) || []).length;
    if (count) found.push({ kind, count });
  }
  return found;
}

// The starter list of what the Cutover portal does. Staff review it before any bid uses it.
export const STARTER_CAPABILITIES = [
  ["Code and business-rule discovery", "Reads source code, schemas and integration files, and lists each business rule with its file and line references."],
  ["Per-file and whole-application assessment", "Describes each file's purpose, functions, rules, data access and tables, with a confidence score per file."],
  ["Deeper business, systems and data assessment", "Produces business, systems and data analysis documents, workflows and an architecture diagram from the assessment."],
  ["Feature grouping and user stories", "Proposes capabilities and features from the code, and drafts user stories that trace back to the rules they come from."],
  ["Owner approval and named sign-off", "Only approved features and stories move on. Each approval records who signed and when, in an append-only action log."],
  ["Feature map and module specifications", "A mind map of approved features with confidence on each branch, and a specification per feature with worked examples as acceptance tests."],
  ["Agent-neutral build package", "A zip of Markdown and JSON, with a manifest and one module per approved feature, that any AI agent can build from."],
  ["Modernization proposals", "Three future-state options for an application, each with its trade-offs, built from the deeper assessment."],
  ["Cloud migration planning and Terraform drafts", "Records the chosen cloud, collects an intake form, and generates Terraform as a draft that lists the inputs used. Every version is kept."],
  ["Sample data protection", "Outputs use sample data only. A scanner checks for personal and identifying patterns before anything is saved."],
  ["Bring-your-own language model", "Each workspace uses its own model key, stored encrypted. Requires a current privacy sign-off before any code is sent to a provider."],
  ["Roles and workspace access", "Platform engineers, application owners, security, informatics, CIO and CTO, and auditors each see what their role needs."],
  ["Assessment locks and commit tracking", "One assessment runs at a time per workspace. Results are tied to the commit they read and marked out of date when it changes."],
  ["Jira push of features and stories", "Pushes approved capabilities, features and stories to Jira, updating existing items instead of duplicating them."],
  ["Data migration planning (planned, not built)", "Planned: inventory, schema conversion scripts, a migration strategy per system, reconciliation after each copy, and approval gates before any copy runs."],
];
