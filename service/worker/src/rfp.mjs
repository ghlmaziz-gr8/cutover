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

// The baseline: what the built Cutover portal does. Staff approve each entry before a review uses it.
export const STARTER_CAPABILITIES = [
  ["Legacy application assessment", "Reads a repository's code, identifies the languages and frameworks (Node, Python, .NET, PHP and Java), and lists the components and any missing items."],
  ["Business rule discovery", "Lists each business rule found in the code, with the file and line it comes from."],
  ["Per-file findings", "Gives every file its purpose and suggested improvements, one row per file, with a confidence level."],
  ["Deeper business, systems and data analysis", "Produces business, systems and data analysis documents, workflows and an architecture diagram from the assessment."],
  ["Capability and feature grouping", "Groups features into business capabilities. Any signed-in user can rename a capability."],
  ["Readiness checks and user stories", "Checks each feature for readiness and drafts user stories that trace back to the rules they come from."],
  ["Scope and effort ranges", "Sets scope with effort ranges. Modernize and migrate stay locked until the deeper assessment is complete."],
  ["Contingency planning and signed PDF export", "Plans contingencies after the review and exports the report as a signed PDF built from stored rows."],
  ["Modernization proposals", "Three future-state options for a web application, each with its trade-offs, built from the deeper assessment."],
  ["Cloud choice and Terraform draft", "Records the chosen cloud (Google Cloud, AWS or Azure) and a short intake form, then generates a Terraform draft that lists its inputs. Every version is kept."],
  ["Module specifications and build package", "A specification per feature with worked examples, and a package of Markdown and JSON that any AI agent can build from."],
  ["Jira push of features and stories", "Pushes approved features and stories to Jira, updating existing items instead of creating duplicates."],
  ["Sample data and personal-data scanning", "Outputs use sample data only. A scanner checks for email addresses, phone numbers, national ID and record-number patterns before anything is saved."],
  ["Bring-your-own language model", "Each workspace uses its own model key, stored encrypted and never shown again. Model use needs a current privacy sign-off."],
  ["Roles, workspace access and assessment locks", "Platform engineers, application owners, security, informatics, CIO and CTO, and auditors each see what their role needs. One assessment runs at a time per workspace."],
];
