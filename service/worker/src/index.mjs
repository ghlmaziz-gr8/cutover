import { COST_RATES } from "./cost-rates.mjs";
import { MODEL_PROVIDERS, MODEL_NAME_PATTERN, customBaseUrl } from "./model-providers.mjs";
import { validateDbMetadata } from "./db-metadata.mjs";

// Cutover SaaS API (Cloudflare Worker).
//
// Each customer has a workspace. A person sees only the workspaces they were invited to,
// and holds one role in each. Every route that touches data checks membership in the
// workspace that owns the record. A workspace the person is not in answers "Not found",
// so nothing reveals that the record exists.
//
// Routes (all under /api). Every route needs a signed-in person, except the runner callback.
//   GET    /api/me                                        your email, operator flag, and your workspaces with roles
//   POST   /api/workspaces                                create a customer workspace and invite its first admin (Cutover operators)
//   PATCH  /api/workspaces/:id                             rename a workspace (operators)
//   DELETE /api/workspaces/:id                             delete a workspace and its analyses (operators; type the name to confirm)
//   GET    /api/admin/workspaces                           every workspace with counts; people shown only where the operator is a member (operators)
//   GET    /api/workspaces/:id/members                    list members (workspace admins)
//   DELETE /api/workspaces/:id/members/:userId            remove a member (workspace admins)
//   GET    /api/workspaces/:id/invitations                list pending invitations (workspace admins)
//   POST   /api/workspaces/:id/invitations                invite an email with a role (workspace admins)
//   DELETE /api/workspaces/:id/invitations/:email         remove a pending invitation (workspace admins)
//   GET    /api/repo-check?workspace=&repo=&ref=          check Cutover can read a repository (platform engineers)
//   GET    /api/admin/database                            database size against the free-tier limit (operators)
//   GET    /api/analyses?workspace=                       analyses in one workspace (members)
//   POST   /api/analyses                                  start an analysis (platform engineers)
//   POST   /api/analyses/upload                            start an analysis of a zip of the code (query: workspace_id, app_name, data_rules_confirmed, model_key_id)
//   GET    /api/analyses/:id                              one analysis, limited to what your role may see
//   DELETE /api/analyses/:id                              delete (the person who started it, or a workspace admin)
//   POST   /api/analyses/:id/comments                     add a comment (members)
//   DELETE /api/comments/:id                              delete a comment (its author, or a workspace admin)
//   POST   /api/analyses/:id/actions                      add an action item (not auditors)
//   PATCH  /api/actions/:id                               open or close an action item (not auditors)
//   GET    /api/analyses/:id/terraform                     the Terraform drafts, newest first (platform engineers and CIO/CTO)
//   POST   /api/analyses/:id/terraform                     make the next Terraform draft from the confirmed intake (platform engineers)
//   PATCH  /api/analyses/:id/cloud                         choose the target cloud for Migrate (platform engineers)
//   PUT    /api/analyses/:id/intake                        save the intake form for Migrate (platform engineers)
//   POST   /api/analyses/:id/intake/confirm                confirm the saved intake (platform engineers)
//   PATCH  /api/analyses/:id/scope                       choose deeper, modernize or migrate (platform engineers)
//   PUT    /api/analyses/:id/template                    choose the modernized template (platform engineers)
//   POST   /api/analyses/:id/contingencies                add a contingency plan (platform engineers)
//   PATCH  /api/contingencies/:id                         edit or set the status of a contingency (platform engineers)
//   DELETE /api/contingencies/:id                         remove a contingency (platform engineers)
//   GET    /api/analyses/:id/files                        file-level results, a page at a time (platform engineers)
//   POST   /api/analyses/:id/files/approve-all            approve every file still in draft (platform engineers)
//   PATCH  /api/file-findings/:id                         approve or edit one file's purpose and suggestions (platform engineers)
//   POST   /api/runner/:id/files                          one chunk of file-level results, up to 200 files (shared secret)
//   POST   /api/runner/:id/result                         runner callback with findings (shared secret)
//   POST   /api/runner/:id/model-key                      one-time exchange of a model token for the key (shared secret + token)
//   POST   /api/runner/:id/screens                        screens drawn from the code by the model (shared secret)
//   POST   /api/analyses/:id/rerun                        run a finished analysis again with the same settings (platform engineers)
//   GET    /api/analyses/:id/db-metadata                  whether a database structure is saved, and its counts (members)
//   PUT    /api/analyses/:id/db-metadata                  save a database structure file from access_metadata.py (platform engineers)
//   DELETE /api/analyses/:id/db-metadata                  remove it (platform engineers)
//   GET    /api/runner/:id/db-metadata                    the saved structure for the run (shared secret)
//
// A scheduled job deletes analyses past their expires_at, and writes a deletion record first.
//
// Required secrets (set with `wrangler secret put`, never in code):
//   SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GITHUB_DISPATCH_TOKEN, RUNNER_SECRET,
//   GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY
// Required vars (wrangler.toml): SUPABASE_URL, RUNNER_REPO, APP_ORIGIN, OPERATOR_EMAILS

// GitHub owner: letters, digits, hyphens. Repo name: no leading dot, so "." and ".." are rejected.
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const REF_PATTERN = /^(?!.*\.\.)[A-Za-z0-9_./-]{1,200}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const ROLES = ["platform_engineer", "security_officer", "informatics_lead", "cio_cto", "auditor"];
const MAX_BODY_BYTES = 5_000_000; // findings can be large, but not unbounded
const MAX_COMMENT = 2000;
const MAX_TITLE = 200;

// Which finding categories each role may see. "all" means every category.
// Summary facts (source, history, limitations, counts) are shown to every member.
const ROLE_CATEGORIES = {
  platform_engineer: "all",
  security_officer: ["security", "privacy", "links"],
  informatics_lead: ["data", "epic"],
  cio_cto: ["stack", "ui_portal", "containers", "delivery", "infrastructure", "links"],
  auditor: [],
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normalizeEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return EMAIL_PATTERN.test(email) && email.length <= 320 ? email : null;
}

function isOperator(env, email) {
  const list = String(env.OPERATOR_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(email || "").toLowerCase());
}

// Asks Supabase who the bearer token belongs to. Returns the user or null.
async function currentUser(env, request) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: auth, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
}

// The name Google gives this person, if any. Stored on their membership rows at sign-in.
function displayName(user) {
  const meta = user.user_metadata || {};
  const name = String(meta.full_name || meta.name || "").trim();
  return name.slice(0, 200);
}

// Turns every pending invitation for this person's email into a membership, then uses it up.
// Returns false if the check could not be completed.
async function acceptInvitations(env, user) {
  const email = normalizeEmail(user.email);
  if (!email) return true;
  const res = await serviceRest(env, `invitations?email=eq.${encodeURIComponent(email)}&select=workspace_id,email,role,is_admin`);
  if (!res.ok) return false;
  for (const inv of await res.json()) {
    const made = await serviceRest(env, "members?on_conflict=workspace_id,user_id", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        workspace_id: inv.workspace_id,
        user_id: user.id,
        email,
        role: inv.role,
        is_admin: inv.is_admin === true,
      }),
    });
    if (!made.ok) return false;
    await serviceRest(env, `invitations?workspace_id=eq.${inv.workspace_id}&email=eq.${encodeURIComponent(email)}`, {
      method: "DELETE",
      headers: { prefer: "return=minimal" },
    });
  }
  return true;
}

// Gate for every signed-in route. Responds 401 when not signed in.
async function requireUser(env, request) {
  const user = await currentUser(env, request);
  if (!user) return { response: json({ error: "Sign in first." }, 401) };
  if (!(await acceptInvitations(env, user))) {
    return { response: json({ error: "Could not check your invitations. Try again in a minute." }, 502) };
  }
  return { user };
}

// The person's membership in one workspace. Not being a member answers 404, not 403,
// so a workspace the person is not in cannot be detected.
async function membershipIn(env, userId, workspaceId) {
  const res = await serviceRest(env, `members?workspace_id=eq.${workspaceId}&user_id=eq.${userId}&select=workspace_id,user_id,email,role,is_admin`);
  if (!res.ok) return { failed: true };
  const [member] = await res.json();
  return { member: member || null };
}

// Access to a workspace named in a request body or query, for a person already signed in.
async function workspaceAccessAs(env, auth, workspaceId) {
  if (typeof workspaceId !== "string" || !UUID_PATTERN.test(workspaceId)) {
    return { response: json({ error: "Choose a workspace." }, 400) };
  }
  const found = await membershipIn(env, auth.user.id, workspaceId);
  if (found.failed) return { response: json({ error: "Could not check access. Try again in a minute." }, 502) };
  if (!found.member) return { response: json({ error: "Not found." }, 404) };
  return { user: auth.user, member: found.member, workspace_id: workspaceId };
}

// Access to a workspace named in the URL. Workspace admins only where noted.
async function workspaceAccess(env, request, workspaceId) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth;
  return workspaceAccessAs(env, auth, workspaceId);
}

async function workspaceAdmin(env, request, workspaceId) {
  const access = await workspaceAccess(env, request, workspaceId);
  if (access.response) return access;
  if (!access.member.is_admin) return { response: json({ error: "Only workspace admins can do this." }, 403) };
  return access;
}

// Access to one analysis. Its workspace decides who may see it.
async function analysisAccessAs(env, auth, analysisId) {
  const found = await loadAnalysis(env, analysisId);
  if (found.failed) return { response: json({ error: "Could not load the analysis." }, 502) };
  if (found.missing) return { response: json({ error: "Not found." }, 404) };
  const membership = await membershipIn(env, auth.user.id, found.row.workspace_id);
  if (membership.failed) return { response: json({ error: "Could not check access. Try again in a minute." }, 502) };
  if (!membership.member) return { response: json({ error: "Not found." }, 404) };
  return { user: auth.user, member: membership.member, row: found.row };
}

async function analysisAccess(env, request, analysisId) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth;
  return analysisAccessAs(env, auth, analysisId);
}

// Only platform engineers start analyses and connect code. Auditors do not change the work.
const canStart = (member) => member.role === "platform_engineer";
const canWorkItems = (member) => member.role !== "auditor";

// The deeper assessment follows the same rule as the findings: each point and layer carries the category
// of the finding it came from, and a role sees only the categories it may see. Points with no category
// (such as the version history) are shown to everyone.
function visibleDeeper(deeper, role) {
  if (!deeper || typeof deeper !== "object") return null;
  const allowed = Object.prototype.hasOwnProperty.call(ROLE_CATEGORIES, role) ? ROLE_CATEGORIES[role] : [];
  const allow = (category) => !category || allowed === "all" || allowed.includes(category);
  return {
    ...deeper,
    sections: (deeper.sections || []).map((section) => ({
      ...section,
      points: (section.points || []).filter((point) => allow(point.category)),
    })),
    architecture: deeper.architecture
      ? { ...deeper.architecture, layers: (deeper.architecture.layers || []).filter((layer) => allow(layer.category)) }
      : null,
    // A proposal is shown only when every category it relies on is one the role may see.
    modernize: Array.isArray(deeper.modernize)
      ? deeper.modernize.filter((proposal) => (proposal.categories || []).every((category) => allow(category)))
      : [],
  };
}

// Reports written before the point flag existed count every finding.
function isPoint(item) {
  return !item || item.point !== false;
}

// Keeps only the findings the role may see. Flags and counts follow the same rule.
function visibleReport(report, role) {
  if (!report || typeof report !== "object") return null;
  const allowed = Object.prototype.hasOwnProperty.call(ROLE_CATEGORIES, role) ? ROLE_CATEGORIES[role] : [];
  const all = report.findings || {};
  const shown = {};
  for (const [id, item] of Object.entries(all)) {
    if (allowed === "all" || allowed.includes(item.category)) shown[id] = item;
  }
  const flags = (report.flags || []).filter((id) => Object.prototype.hasOwnProperty.call(shown, id));
  return {
    ...report,
    deeper: visibleDeeper(report.deeper, role),
    findings: shown,
    flags,
    // A result that says nothing was found is kept but is not a point (see point in the engine).
    counts: {
      total: Object.values(all).filter(isPoint).length,
      shown: Object.values(shown).filter(isPoint).length,
    },
  };
}

// Calls PostgREST with the service role. Only used after the membership check in this file.
function serviceRest(env, path, init = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const text = await request.text();
  if (text.length > maxBytes) return { error: "Request body is too large." };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: "Request body must be JSON." };
  }
}

// Loads one analysis row. Returns { row }, { missing: true }, or { failed: true }.
async function loadAnalysis(env, id) {
  const res = await serviceRest(env, `analyses?id=eq.${id}&select=*`);
  if (!res.ok) return { failed: true };
  const [row] = await res.json();
  return row ? { row } : { missing: true };
}

// ---- Who am I, and which workspaces am I in ----

async function me(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const name = displayName(auth.user);
  if (name) {
    // Best effort: a failed name update must not stop sign-in.
    await serviceRest(env, `members?user_id=eq.${auth.user.id}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  }
  const res = await serviceRest(env,
    `members?user_id=eq.${auth.user.id}&select=workspace_id,role,is_admin,created_at,workspace:workspaces(id,name)&order=created_at.asc`);
  if (!res.ok) return json({ error: "Could not load your workspaces." }, 502);
  const rows = await res.json();
  return json({
    email: auth.user.email,
    is_operator: isOperator(env, auth.user.email),
    workspaces: rows.map((r) => ({
      id: r.workspace_id,
      name: r.workspace?.name || "Workspace",
      role: r.role,
      is_admin: r.is_admin === true,
    })),
  });
}

// ---- Workspaces (operators create them; their admins manage people) ----

async function createWorkspace(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  if (!isOperator(env, auth.user.email)) return json({ error: "Only Cutover operators can create workspaces." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_TITLE) {
    return json({ error: `Give the workspace a name of 1 to ${MAX_TITLE} characters.` }, 400);
  }
  const email = normalizeEmail(body.admin_email);
  if (!email) return json({ error: "Enter a valid email address for the first admin." }, 400);
  const role = body.admin_role || "platform_engineer";
  if (!ROLES.includes(role)) return json({ error: `Role must be one of: ${ROLES.join(", ")}.` }, 400);

  const created = await serviceRest(env, "workspaces", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name }),
  });
  if (!created.ok) return json({ error: "Could not create the workspace." }, 502);
  const [ws] = await created.json();

  const invite = await serviceRest(env, "invitations", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ workspace_id: ws.id, email, role, is_admin: true, invited_by: auth.user.id }),
  });
  if (!invite.ok) {
    // Do not leave an empty workspace behind.
    await serviceRest(env, `workspaces?id=eq.${ws.id}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    return json({ error: "Could not invite the first admin, so the workspace was not created." }, 502);
  }
  return json({ id: ws.id, name: ws.name, invited: email }, 201);
}

async function listMembers(request, env, workspaceId) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const res = await serviceRest(env, `members?workspace_id=eq.${workspaceId}&select=user_id,email,name,role,is_admin,created_at&order=created_at.asc`);
  if (!res.ok) return json({ error: "Could not load members." }, 502);
  return json(await res.json());
}

async function removeMember(request, env, workspaceId, userId) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  if (!UUID_PATTERN.test(userId)) return json({ error: "Not found." }, 404);
  if (userId === access.user.id) return json({ error: "You cannot remove yourself. Ask another admin." }, 400);
  const res = await serviceRest(env, `members?workspace_id=eq.${workspaceId}&user_id=eq.${userId}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (!res.ok) return json({ error: "Could not remove the member." }, 502);
  return json({ removed: true });
}

async function listInvitations(request, env, workspaceId) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const res = await serviceRest(env, `invitations?workspace_id=eq.${workspaceId}&select=email,role,is_admin,created_at&order=created_at.desc`);
  if (!res.ok) return json({ error: "Could not load invitations." }, 502);
  return json(await res.json());
}

async function createInvitation(request, env, workspaceId) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "Enter a valid email address." }, 400);
  if (!ROLES.includes(body.role)) return json({ error: `Role must be one of: ${ROLES.join(", ")}.` }, 400);
  const isAdmin = body.is_admin === true;

  const res = await serviceRest(env, "invitations?on_conflict=workspace_id,email", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ workspace_id: workspaceId, email, role: body.role, is_admin: isAdmin, invited_by: access.user.id }),
  });
  if (!res.ok) return json({ error: "Could not save the invitation." }, 502);
  // If this person already has access, update their role now as well.
  await serviceRest(env, `members?workspace_id=eq.${workspaceId}&email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ role: body.role, is_admin: isAdmin }),
  });
  return json({ invited: email, role: body.role, is_admin: isAdmin }, 201);
}

async function deleteInvitation(request, env, workspaceId, email) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const clean = normalizeEmail(email);
  if (!clean) return json({ error: "Not found." }, 404);
  const res = await serviceRest(env, `invitations?workspace_id=eq.${workspaceId}&email=eq.${encodeURIComponent(clean)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (!res.ok) return json({ error: "Could not remove the invitation." }, 502);
  return json({ removed: true });
}

// ---- Analyses ----

// ---- Operators: rename, delete and overview of workspaces ----

async function renameWorkspace(request, env, workspaceId) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  if (!isOperator(env, auth.user.email)) return json({ error: "Only Cutover operators can change workspaces." }, 403);
  if (!UUID_PATTERN.test(workspaceId)) return json({ error: "Not found." }, 404);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const name = typeof parsed.value?.name === "string" ? parsed.value.name.trim() : "";
  if (!name || name.length > MAX_TITLE) return json({ error: `Give the workspace a name of 1 to ${MAX_TITLE} characters.` }, 400);
  const res = await serviceRest(env, `workspaces?id=eq.${workspaceId}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return json({ error: "Could not rename the workspace." }, 502);
  const [row] = await res.json();
  if (!row) return json({ error: "Not found." }, 404);
  return json({ id: row.id, name: row.name });
}

// Deletes a workspace with everything in it. The person must type its name. Every analysis is
// recorded in the deletion log first; nothing is removed if that record cannot be saved.
async function deleteWorkspace(request, env, workspaceId) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  if (!isOperator(env, auth.user.email)) return json({ error: "Only Cutover operators can delete workspaces." }, 403);
  if (!UUID_PATTERN.test(workspaceId)) return json({ error: "Not found." }, 404);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const found = await serviceRest(env, `workspaces?id=eq.${workspaceId}&select=id,name`);
  if (!found.ok) return json({ error: "Could not check the workspace. Try again in a minute." }, 502);
  const [ws] = await found.json();
  if (!ws) return json({ error: "Not found." }, 404);
  if (String(parsed.value?.confirm_name || "").trim() !== ws.name) {
    return json({ error: `Type the workspace name exactly, "${ws.name}", to delete it.` }, 400);
  }
  const analyses = await serviceRest(env, `analyses?workspace_id=eq.${workspaceId}&select=id,repo`);
  if (!analyses.ok) return json({ error: "Could not list its analyses, so nothing was deleted." }, 502);
  const rows = await analyses.json();
  if (!(await recordDeletion(env, rows, "requested"))) {
    return json({ error: "Could not record the deletions, so nothing was deleted." }, 502);
  }
  const res = await serviceRest(env, `workspaces?id=eq.${workspaceId}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (!res.ok) return json({ error: "Could not delete the workspace." }, 502);
  return json({ deleted: true, analyses_deleted: rows.length });
}

// Every workspace, with counts. Member names and emails are shown only for workspaces the operator
// is a member of, so an operator cannot see a customer's people unless invited into that workspace.
// The free tier's database limit. Above it, Supabase makes the whole project read-only.
// ---- Privacy sign-off for a workspace (needed before the workspace can use its own language model) ----
// The text lives here, so the copy recorded is the copy the server holds. The browser cannot change it.
// Each sign-off or withdrawal is a new row. Nothing is ever updated or deleted.
const PRIVACY_NOTICE_VERSION = "2026-10-18.1";
const PRIVACY_NOTICE = "Cutover can send code from this workspace to a language model that the workspace sets up itself. This sign-off confirms that the workspace accepts the rules below. The provider's own terms apply to what it receives.";
const PRIVACY_STATEMENTS = [
  { id: "code_only", text: "Only the code I choose to analyze is sent to the language model I set up." },
  { id: "no_personal_data", text: "No patient or personal data is sent. Examples are sample data only." },
  { id: "provider_terms", text: "The provider I choose handles what it receives under its own terms, which I have read." },
  { id: "withdraw", text: "I can withdraw this sign-off at any time. Access to stored model keys stops when I do." },
];
const PRIVACY_TEXT = [PRIVACY_NOTICE, ...PRIVACY_STATEMENTS.map((s) => `- ${s.text}`)].join("\n");

// Every event for the workspace, newest first.
async function privacyEvents(env, workspaceId) {
  const res = await serviceRest(env, `privacy_signoffs?workspace_id=eq.${workspaceId}&select=id,action,full_name,email,notice_version,created_at`);
  if (!res.ok) return { failed: true };
  const rows = await res.json();
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { events: rows };
}

// The current sign-off: the newest event, if it is a sign-off that has not been withdrawn.
function privacyCurrent(events) {
  const latest = events[0] || null;
  return latest && latest.action === "signed_off" ? latest : null;
}

// Checks the name and the ticked statements a person sent with a sign-off or withdrawal.
function privacyInput(value, { needStatements }) {
  if (!value || typeof value !== "object") return { error: "Send the sign-off details." };
  const name = typeof value.full_name === "string" ? value.full_name.trim() : "";
  if (name.length < 2 || name.length > PRIVACY_NAME_MAX) return { error: "Type your full name." };
  if (needStatements) {
    const ticked = Array.isArray(value.statements) ? value.statements.filter((s) => typeof s === "string") : [];
    const wanted = PRIVACY_STATEMENTS.map((s) => s.id);
    const complete = wanted.every((id) => ticked.includes(id)) && ticked.length === wanted.length;
    if (!complete) return { error: "Read each statement and tick all of them to sign off." };
    if (value.notice_version !== PRIVACY_NOTICE_VERSION) {
      return { error: "The privacy notice has changed. Read it again before signing off.", status: 409 };
    }
  }
  return { name };
}

async function privacyStatus(request, env, workspaceId) {
  const access = await workspaceAccess(env, request, workspaceId);
  if (access.response) return access.response;
  const found = await privacyEvents(env, workspaceId);
  if (found.failed) return json({ error: "Could not load the sign-off. Try again in a minute." }, 502);
  const current = privacyCurrent(found.events);
  return json({
    notice_version: PRIVACY_NOTICE_VERSION,
    notice: PRIVACY_NOTICE,
    statements: PRIVACY_STATEMENTS,
    signed_off: !!current,
    current: current
      ? { full_name: current.full_name, email: current.email, signed_at: current.created_at, notice_version: current.notice_version }
      : null,
    can_change: access.member.is_admin === true,
    history: found.events.map((e) => ({
      action: e.action, full_name: e.full_name, email: e.email, notice_version: e.notice_version, at: e.created_at,
    })),
  });
}

async function recordPrivacyEvent(env, access, action, name, statements) {
  return serviceRest(env, "privacy_signoffs", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      workspace_id: access.workspace_id,
      user_id: access.user.id,
      email: normalizeEmail(access.user.email),
      full_name: name,
      action,
      notice_version: PRIVACY_NOTICE_VERSION,
      notice_text: PRIVACY_TEXT,
      statements,
    }),
  });
}

async function privacySignOff(request, env, workspaceId) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const body = await readJson(request, 20_000);
  if (body.error) return json({ error: body.error }, 400);
  const input = privacyInput(body.value, { needStatements: true });
  if (input.error) return json({ error: input.error }, input.status || 400);
  const found = await privacyEvents(env, workspaceId);
  if (found.failed) return json({ error: "Could not record the sign-off. Try again in a minute." }, 502);
  if (privacyCurrent(found.events)) return json({ error: "This workspace is already signed off." }, 409);
  const made = await recordPrivacyEvent(env, access, "signed_off", input.name, PRIVACY_STATEMENTS.map((s) => s.id));
  if (!made.ok) return json({ error: "Could not record the sign-off. Try again in a minute." }, 502);
  await notifyPeople(env, workspaceId, await adminIdsExcept(env, workspaceId, access.user.id), {
    kind: "privacy_signed_off", tone: "success", title: "Privacy sign-off recorded",
    body: `${input.name} signed off the privacy notice. Language models can now be set up for this workspace.`,
  });
  return json({ signed_off: true }, 201);
}

async function privacyWithdraw(request, env, workspaceId) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const body = await readJson(request, 20_000);
  if (body.error) return json({ error: body.error }, 400);
  const input = privacyInput(body.value, { needStatements: false });
  if (input.error) return json({ error: input.error }, 400);
  const found = await privacyEvents(env, workspaceId);
  if (found.failed) return json({ error: "Could not record the withdrawal. Try again in a minute." }, 502);
  if (!privacyCurrent(found.events)) return json({ error: "There is no sign-off to withdraw." }, 409);
  const made = await recordPrivacyEvent(env, access, "withdrawn", input.name, []);
  if (!made.ok) return json({ error: "Could not record the withdrawal. Try again in a minute." }, 502);
  await notifyPeople(env, workspaceId, await adminIdsExcept(env, workspaceId, access.user.id), {
    kind: "privacy_withdrawn", tone: "warning", title: "Privacy sign-off withdrawn",
    body: `${input.name} withdrew the sign-off. Stored model keys stop being usable until a new sign-off.`,
  });
  return json({ signed_off: false }, 201);
}

const PRIVACY_NAME_MAX = 200;

// ---- Model keys: each workspace's own language model key, stored encrypted ----
// The key is encrypted with AES-GCM before it is saved. Only the last four characters are ever shown again.
// A key is tested with one tiny request before it is saved, so a saved key is known to work.
const MODEL_KEY_MIN = 20;
const MODEL_KEY_MAX = 300;

function bytesToBase64(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// The encryption key must be 32 random bytes, set once as a Worker secret. Without it, keys cannot be saved.
async function encryptionKey(env) {
  if (!env.CUTOVER_KEY_ENCRYPTION_KEY) return null;
  let raw;
  try {
    raw = base64ToBytes(env.CUTOVER_KEY_ENCRYPTION_KEY);
  } catch {
    return null;
  }
  if (raw.length !== 32) return null;
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptModelKey(key, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return { ciphertext: bytesToBase64(data), iv: bytesToBase64(iv) };
}

// Asks the provider whether the key and the model work, with one tiny request. Never echoes the key or the reply.
async function testModelKey(entry, apiKey, model, baseUrl) {
  let res;
  try {
    if (entry.protocol === "google") {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with OK." }] }], generationConfig: { maxOutputTokens: 1 } }),
      });
    } else if (entry.protocol === "anthropic") {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "Reply with OK." }] }),
      });
    } else {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          [entry.tokenField || "max_tokens"]: 1,
          messages: [{ role: "user", content: "Reply with OK." }],
        }),
      });
    }
  } catch {
    return { ok: false, reason: `Could not reach ${entry.name}. Try again in a minute.` };
  }
  if (res.ok) return { ok: true };
  if (res.status === 404) {
    return { ok: false, reason: `${entry.name} did not find the model "${model}". Check the model name, or choose another model.` };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return { ok: false, reason: `${entry.name} did not accept this key. Check that you copied the whole key, and that it is allowed to use this model.` };
  }
  if (res.status === 429) return { ok: false, reason: `${entry.name} is limiting requests right now. Try again later.` };
  return { ok: false, reason: `${entry.name} answered with an error (HTTP ${res.status}). Check the key, the model and the address, then try again.` };
}

// The name a person sees for a key: the provider's label, or the name they gave their own provider.
function keyLabel(row) {
  const entry = MODEL_PROVIDERS[row.provider];
  if (entry && entry.custom) return row.label || "Your own provider";
  return entry ? entry.label : row.provider;
}

// Active keys for a workspace: revoked ones are kept in the table for the record, but never listed.
async function activeModelKeys(env, workspaceId) {
  const res = await serviceRest(env, `model_keys?workspace_id=eq.${workspaceId}&select=id,provider,last4,label,model,base_url,created_by_email,created_at,revoked_at`);
  if (!res.ok) return { failed: true };
  const rows = (await res.json()).filter((r) => !r.revoked_at);
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { keys: rows };
}

// What the page needs to show each provider: its name, its key page, its default model and its quest.
function providerCards() {
  return Object.entries(MODEL_PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    custom: p.custom === true,
    key_page: p.keyPage,
    key_page_label: p.keyPageLabel,
    default_model: p.defaultModel,
    quest: p.quest,
  }));
}

async function listModelKeys(request, env, workspaceId) {
  const access = await workspaceAccess(env, request, workspaceId);
  if (access.response) return access.response;
  const found = await activeModelKeys(env, workspaceId);
  if (found.failed) return json({ error: "Could not load the keys. Try again in a minute." }, 502);
  return json({
    providers: providerCards(),
    can_change: access.member.is_admin === true,
    draw_screens: await workspaceDrawsScreens(env, workspaceId),
    keys: found.keys.map((k) => ({
      id: k.id, provider: k.provider, label: keyLabel(k),
      model: k.model || (MODEL_PROVIDERS[k.provider] || {}).defaultModel || null,
      host: k.base_url ? new URL(k.base_url).hostname : null,
      last4: k.last4, added_by_email: k.created_by_email, added_at: k.created_at,
    })),
  });
}

async function setModelScreens(request, env, workspaceId) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const body = await readJson(request, 2_000);
  if (body.error) return json({ error: body.error }, 400);
  const enabled = (body.value || {}).enabled;
  if (typeof enabled !== "boolean") return json({ error: "enabled must be true or false." }, 400);
  const res = await serviceRest(env, `workspaces?id=eq.${workspaceId}`, {
    method: "PATCH",
    body: JSON.stringify({ ai_screens: enabled }),
  });
  if (!res.ok) return json({ error: "Could not save the setting. Try again in a minute." }, 502);
  return json({ draw_screens: enabled });
}

// Whether the workspace lets its own model draw screens. Off unless a workspace admin turns it on.
async function workspaceDrawsScreens(env, workspaceId) {
  const res = await serviceRest(env, `workspaces?id=eq.${workspaceId}&select=ai_screens`);
  if (!res.ok) return false;
  const [row] = await res.json();
  return row?.ai_screens === true;
}

// Checks what a person typed for a provider. Returns the values to save, or an error message.
function providerChoice(value, entry) {
  let label = null;
  let baseUrl = null;
  if (entry.custom) {
    label = typeof value.label === "string" ? value.label.trim() : "";
    if (!label || label.length > 60) return { error: "Give your provider a name of up to 60 characters." };
    baseUrl = customBaseUrl(value.base_url);
    if (!baseUrl) return { error: "The address must start with https:// and be a real web address, for example https://api.example.com/v1." };
  }
  const typed = typeof value.model === "string" ? value.model.trim() : "";
  const model = typed || entry.defaultModel;
  if (!model) return { error: "Type the model name the provider gives you." };
  if (!MODEL_NAME_PATTERN.test(model)) return { error: "The model name can use letters, numbers and . _ - / : only." };
  // Google's model name becomes part of the address, so it cannot contain a slash or a colon.
  if (entry.protocol === "google" && /[/:]/.test(model)) return { error: "Google model names use letters, numbers, dots, underscores and dashes only." };
  return { label, baseUrl, model };
}

async function addModelKey(request, env, workspaceId) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const body = await readJson(request, 20_000);
  if (body.error) return json({ error: body.error }, 400);
  const value = body.value || {};
  const entry = Object.prototype.hasOwnProperty.call(MODEL_PROVIDERS, value.provider) ? MODEL_PROVIDERS[value.provider] : null;
  if (!entry) return json({ error: "Choose a provider from the list." }, 400);
  const apiKey = typeof value.api_key === "string" ? value.api_key.trim() : "";
  if (apiKey.length < MODEL_KEY_MIN || apiKey.length > MODEL_KEY_MAX || /\s/.test(apiKey)) {
    return json({ error: "Paste the whole key, with nothing else around it." }, 400);
  }
  const choice = providerChoice(value, entry);
  if (choice.error) return json({ error: choice.error }, 400);
  const signoffs = await privacyEvents(env, workspaceId);
  if (signoffs.failed) return json({ error: "Could not check the privacy sign-off. Try again in a minute." }, 502);
  if (!privacyCurrent(signoffs.events)) {
    return json({ error: "Sign off the privacy notice on the Privacy tab before adding a model key." }, 409);
  }
  const key = await encryptionKey(env);
  if (!key) return json({ error: "Model keys are not set up on this server yet. Ask the platform owner." }, 503);
  const active = await activeModelKeys(env, workspaceId);
  if (active.failed) return json({ error: "Could not check existing keys. Try again in a minute." }, 502);
  // A provider from the list is saved once. Your own providers can be added as many times as needed.
  if (!entry.custom && active.keys.some((k) => k.provider === value.provider)) {
    return json({ error: "A key for this provider is already saved. Remove it first to replace it." }, 409);
  }
  const tested = await testModelKey(entry, apiKey, choice.model, choice.baseUrl || entry.baseUrl);
  if (!tested.ok) return json({ error: tested.reason }, 400);
  const sealed = await encryptModelKey(key, apiKey);
  const made = await serviceRest(env, "model_keys", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      provider: value.provider,
      label: choice.label,
      model: choice.model,
      base_url: choice.baseUrl,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      last4: apiKey.slice(-4),
      created_by: access.user.id,
      created_by_email: normalizeEmail(access.user.email),
    }),
  });
  if (!made.ok) return json({ error: "Could not save the key. Try again in a minute." }, 502);
  const [row] = await made.json();
  const name = keyLabel({ provider: value.provider, label: choice.label });
  await notifyPeople(env, workspaceId, await adminIdsExcept(env, workspaceId, access.user.id), {
    kind: "model_key_added", tone: "ai", title: "Language model added",
    body: `${name} key ending in ${apiKey.slice(-4)} was added.`,
  });
  return json({ id: row.id, provider: value.provider, label: name, model: choice.model, last4: apiKey.slice(-4) }, 201);
}

async function removeModelKey(request, env, workspaceId, keyId) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const found = await activeModelKeys(env, workspaceId);
  if (found.failed) return json({ error: "Could not load the keys. Try again in a minute." }, 502);
  if (!found.keys.some((k) => k.id === keyId)) return json({ error: "Not found." }, 404);
  const made = await serviceRest(env, `model_keys?id=eq.${keyId}&workspace_id=eq.${workspaceId}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: new Date().toISOString(), revoked_by_email: normalizeEmail(access.user.email) }),
  });
  if (!made.ok) return json({ error: "Could not remove the key. Try again in a minute." }, 502);
  const removed = found.keys.find((k) => k.id === keyId);
  await notifyPeople(env, workspaceId, await adminIdsExcept(env, workspaceId, access.user.id), {
    kind: "model_key_removed", tone: "warning", title: "Language model removed",
    body: `${keyLabel(removed)} key ending in ${removed.last4} was removed.`,
  });
  return json({ removed: true });
}

// ---- Model for an analysis: the workspace's own key, released once to the runner ----
// A new analysis may name one of the workspace's active keys. The Worker checks the sign-off and the key,
// then issues a one-time token. The runner trades the token for the key once. The key never reaches the browser.
const MODEL_TOKEN_TTL_MS = 10 * 60 * 1000;

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function decryptModelKey(key, row) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(row.iv) }, key, base64ToBytes(row.ciphertext));
  return new TextDecoder().decode(plain);
}

// Checks a model choice for a new analysis. Returns { key, notice_version } or { response }.
async function chooseAnalysisModel(env, workspaceId, keyId) {
  if (typeof keyId !== "string" || !UUID_PATTERN.test(keyId)) {
    return { response: json({ error: "Choose a model from the list." }, 400) };
  }
  const signoffs = await privacyEvents(env, workspaceId);
  if (signoffs.failed) return { response: json({ error: "Could not check the privacy sign-off. Try again in a minute." }, 502) };
  const current = privacyCurrent(signoffs.events);
  if (!current) return { response: json({ error: "Sign off the privacy notice on the Privacy tab before using a model." }, 409) };
  const active = await activeModelKeys(env, workspaceId);
  if (active.failed) return { response: json({ error: "Could not load the model keys. Try again in a minute." }, 502) };
  const key = active.keys.find((k) => k.id === keyId);
  if (!key) return { response: json({ error: "That model key is not set up for this workspace any more." }, 400) };
  return { key, notice_version: current.notice_version };
}

// Issues the one-time token for an analysis. Returns the token, or null if it could not be saved.
async function issueModelToken(env, analysisId, keyId) {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const made = await serviceRest(env, "analysis_model_tokens", {
    method: "POST",
    body: JSON.stringify({
      analysis_id: analysisId,
      model_key_id: keyId,
      token_hash: await sha256Hex(token),
      expires_at: new Date(Date.now() + MODEL_TOKEN_TTL_MS).toISOString(),
    }),
  });
  return made.ok ? token : null;
}

// The runner's one exchange. Every check that can refuse runs before the token is used up, so a refusal
// does not cost the token. Only the first request that marks the token used gets the key.
async function runnerModelKey(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const parsed = await readJson(request, 2_000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const token = typeof parsed.value?.token === "string" ? parsed.value.token : "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return json({ error: "Not allowed." }, 401);

  const found = await serviceRest(env,
    `analysis_model_tokens?token_hash=eq.${await sha256Hex(token)}&analysis_id=eq.${id}&select=id,model_key_id,expires_at,used_at`);
  if (!found.ok) return json({ error: "Could not check the token. Try again in a minute." }, 502);
  const [tokenRow] = await found.json();
  if (!tokenRow || tokenRow.used_at || Date.parse(tokenRow.expires_at) <= Date.now()) {
    return json({ error: "Not allowed." }, 401);
  }

  const keyRes = await serviceRest(env, `model_keys?id=eq.${tokenRow.model_key_id}&select=id,workspace_id,provider,label,model,base_url,ciphertext,iv,revoked_at`);
  if (!keyRes.ok) return json({ error: "Could not load the model key. Try again in a minute." }, 502);
  const [keyRow] = await keyRes.json();
  if (!keyRow || keyRow.revoked_at) return json({ error: "The model key is no longer set up." }, 403);
  const signoffs = await privacyEvents(env, keyRow.workspace_id);
  if (signoffs.failed) return json({ error: "Could not check the privacy sign-off. Try again in a minute." }, 502);
  if (!privacyCurrent(signoffs.events)) return json({ error: "The privacy sign-off has been withdrawn." }, 403);
  const key = await encryptionKey(env);
  if (!key) return json({ error: "Model keys are not set up on this server yet." }, 503);

  const used = await serviceRest(env, `analysis_model_tokens?id=eq.${tokenRow.id}&used_at=is.null`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ used_at: new Date().toISOString() }),
  });
  if (!used.ok) return json({ error: "Could not check the token. Try again in a minute." }, 502);
  const marked = await used.json();
  if (!marked.length) return json({ error: "Not allowed." }, 401);

  let apiKey;
  try {
    apiKey = await decryptModelKey(key, keyRow);
  } catch {
    return json({ error: "Could not open the model key." }, 500);
  }
  // The runner gets the protocol, the model, and the address for providers that take one. The key is sent once.
  const entry = MODEL_PROVIDERS[keyRow.provider];
  return json({
    provider: entry.protocol,
    model: keyRow.model || entry.defaultModel,
    base_url: entry.custom ? keyRow.base_url : (entry.baseUrl || null),
    token_field: entry.tokenField || "max_tokens",
    api_key: apiKey,
  });
}

const FREE_TIER_DATABASE_BYTES = 500 * 1024 * 1024;

// Operators only: how full the database is, so the limit is seen before it is reached.
async function databaseSize(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  if (!isOperator(env, auth.user.email)) return json({ error: "Only Cutover operators can see this." }, 403);
  const res = await serviceRest(env, "rpc/database_size_bytes", { method: "POST", body: "{}" });
  if (!res.ok) return json({ error: "Could not read the database size." }, 502);
  const bytes = Number(await res.json());
  if (!Number.isFinite(bytes)) return json({ error: "Could not read the database size." }, 502);
  return json({
    bytes,
    limit_bytes: FREE_TIER_DATABASE_BYTES,
    percent: Math.round((bytes / FREE_TIER_DATABASE_BYTES) * 1000) / 10,
  });
}

async function overviewWorkspaces(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  if (!isOperator(env, auth.user.email)) return json({ error: "Only Cutover operators can see this." }, 403);
  const [wsRes, memRes, invRes, anRes] = await Promise.all([
    serviceRest(env, "workspaces?select=id,name,created_at&order=created_at.asc"),
    serviceRest(env, "members?select=workspace_id,user_id,email,name,role,is_admin"),
    serviceRest(env, "invitations?select=workspace_id,email"),
    serviceRest(env, "analyses?select=workspace_id"),
  ]);
  if (!wsRes.ok || !memRes.ok || !invRes.ok || !anRes.ok) return json({ error: "Could not load workspaces." }, 502);
  const workspaces = await wsRes.json();
  const members = await memRes.json();
  const invites = await invRes.json();
  // Counts only: the workspace id of each analysis, never its findings.
  const analyses = await anRes.json();
  const mine = new Set(members.filter((m) => m.user_id === auth.user.id).map((m) => m.workspace_id));
  return json(workspaces.map((w) => {
    const people = members.filter((m) => m.workspace_id === w.id);
    const out = {
      id: w.id,
      name: w.name,
      created_at: w.created_at,
      people_count: people.length,
      pending_count: invites.filter((i) => i.workspace_id === w.id).length,
      analyses_count: analyses.filter((a) => a.workspace_id === w.id).length,
      you_are_member: mine.has(w.id),
    };
    if (out.you_are_member) {
      out.members = people.map((m) => ({ user_id: m.user_id, email: m.email, name: m.name || null, role: m.role, is_admin: m.is_admin === true }));
    }
    return out;
  }));
}

async function listAnalyses(request, env) {
  const url = new URL(request.url);
  const access = await workspaceAccess(env, request, url.searchParams.get("workspace") || "");
  if (access.response) return access.response;
  const res = await serviceRest(env,
    `analyses?workspace_id=eq.${access.workspace_id}&select=id,owner_id,repo,ref,app_name,status,commit_sha,created_at,finished_at,expires_at,model_provider&order=created_at.desc&limit=100`);
  if (!res.ok) return json({ error: "Could not load analyses." }, 502);
  const rows = await res.json();
  // The owner id is not sent. is_mine says whether the analysis is yours.
  return json(rows.map(({ owner_id, ...rest }) => ({ ...rest, is_mine: owner_id === access.user.id })));
}

// ---- Notifications: saved per person, shown by the portal's bell. Writing one never fails the action that caused it. ----
const NOTIFY_TONES = ["info", "success", "warning", "danger", "ai"];
const NOTIFY_KINDS = [
  "analysis_started", "analysis_complete", "analysis_failed", "privacy_signed_off", "privacy_withdrawn",
  "model_key_added", "model_key_removed", "comment_added", "action_added", "action_done",
  "scope_chosen", "deeper_ready", "plan_accepted", "plan_rejected", "purposes_approved",
  "cloud_chosen", "intake_confirmed", "terraform_drafted", "cost_users_set",
];

async function notifyPeople(env, workspaceId, userIds, note) {
  const ids = [...new Set((userIds || []).filter((id) => typeof id === "string" && UUID_PATTERN.test(id)))];
  if (ids.length === 0 || !NOTIFY_KINDS.includes(note.kind) || !NOTIFY_TONES.includes(note.tone)) return;
  const rows = ids.map((user_id) => ({
    workspace_id: workspaceId,
    user_id,
    analysis_id: note.analysis_id || null,
    kind: note.kind,
    tone: note.tone,
    title: String(note.title).slice(0, 160),
    body: String(note.body || "").slice(0, 400),
  }));
  try {
    await serviceRest(env, "notifications", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(rows) });
  } catch {
    // A notification that cannot be saved must not undo the action it reports.
  }
}

// The platform engineers in a workspace, except the person who caused the event.
async function engineerIdsExcept(env, workspaceId, exceptUserId) {
  const res = await serviceRest(env, `members?workspace_id=eq.${workspaceId}&role=eq.platform_engineer&select=user_id`);
  if (!res.ok) return [];
  return (await res.json()).map((m) => m.user_id).filter((id) => id !== exceptUserId);
}

// The people who should hear about a change to one analysis: its owner and the engineers, except the actor.
async function analysisAudienceExcept(env, row, exceptUserId) {
  const engineers = await engineerIdsExcept(env, row.workspace_id, exceptUserId);
  return [...new Set([row.owner_id, ...engineers])].filter((id) => id !== exceptUserId);
}

// The workspace's admins, except the person who caused the event (they already know).
async function adminIdsExcept(env, workspaceId, exceptUserId) {
  const res = await serviceRest(env, `members?workspace_id=eq.${workspaceId}&is_admin=eq.true&select=user_id`);
  if (!res.ok) return [];
  return (await res.json()).map((m) => m.user_id).filter((id) => id !== exceptUserId);
}

async function listNotifications(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const [recent, unread] = await Promise.all([
    serviceRest(env, `notifications?user_id=eq.${auth.user.id}&select=id,workspace_id,analysis_id,kind,tone,title,body,read_at,created_at,workspace:workspaces(name)&order=created_at.desc&limit=40`),
    serviceRest(env, `notifications?user_id=eq.${auth.user.id}&read_at=is.null&select=id`),
  ]);
  if (!recent.ok || !unread.ok) return json({ error: "Could not load notifications." }, 502);
  const items = (await recent.json())
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((n) => ({
      id: n.id, workspace_id: n.workspace_id, workspace_name: n.workspace?.name || "", analysis_id: n.analysis_id || null,
      kind: n.kind, tone: n.tone, title: n.title, body: n.body, read_at: n.read_at, created_at: n.created_at,
    }));
  return json({ unread: (await unread.json()).length, items });
}

async function markNotificationsRead(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const parsed = await readJson(request, 8_000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const value = parsed.value || {};
  const ids = Array.isArray(value.ids) ? value.ids.filter((id) => typeof id === "string" && UUID_PATTERN.test(id)).slice(0, 100) : [];
  if (value.all !== true && ids.length === 0) return json({ error: "Send the ids to mark, or all: true." }, 400);
  const only = value.all === true ? "" : `&id=in.(${ids.join(",")})`;
  const res = await serviceRest(env, `notifications?user_id=eq.${auth.user.id}&read_at=is.null${only}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ read_at: new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "Could not update notifications." }, 502);
  return json({ saved: true });
}

async function startAnalysis(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;

  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const access = await workspaceAccessAs(env, auth, body.workspace_id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can start analyses." }, 403);

  const { repo, ref, app_name, data_rules_confirmed } = body;
  if (typeof repo !== "string" || !REPO_PATTERN.test(repo)) {
    return json({ error: "repo must look like owner/name." }, 400);
  }
  if (ref !== undefined && ref !== null && (typeof ref !== "string" || !REF_PATTERN.test(ref))) {
    return json({ error: "ref must be a branch, tag, or commit name." }, 400);
  }
  const name = typeof app_name === "string" ? app_name.trim() : "";
  if (!name || name.length > MAX_TITLE) {
    return json({ error: `Give the application a name of 1 to ${MAX_TITLE} characters.` }, 400);
  }
  if (data_rules_confirmed !== true) {
    return json({ error: "Confirm that the code and its settings contain no patient information." }, 400);
  }

  // Optional: the workspace's own model for the file purposes. Without it, the rules-only engine runs.
  const keyId = body.model_key_id === undefined || body.model_key_id === null || body.model_key_id === "" ? null : body.model_key_id;
  let model = null;
  if (keyId) {
    const chosen = await chooseAnalysisModel(env, access.workspace_id, keyId);
    if (chosen.response) return chosen.response;
    model = chosen;
  }

  // The app must be able to read the repository, the same check the wizard shows in step 4.
  let readable;
  try {
    readable = await readToken(env, repo);
  } catch {
    return json({ error: "Cutover could not check the repository right now. Try again in a minute." }, 502);
  }
  if (readable.notInstalled) {
    return json({ error: "Cutover cannot read this repository yet. Check the name, or install the Cutover reader on it." }, 400);
  }
  if (readable.failed) return json({ error: "Cutover could not check the repository right now. Try again in a minute." }, 502);

  const created = await serviceRest(env, "analyses", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: auth.user.id,
      workspace_id: access.workspace_id,
      repo,
      ref: ref || null,
      app_name: name,
      data_rules_confirmed_at: new Date().toISOString(),
      ...(model ? {
        model_provider: model.key.provider,
        model_key_id: model.key.id,
        model_notice_version: model.notice_version,
        model_chosen_by_email: normalizeEmail(auth.user.email),
      } : {}),
    }),
  });
  if (!created.ok) return json({ error: "Could not create the analysis." }, 502);
  const [row] = await created.json();
  await notifyPeople(env, access.workspace_id, [auth.user.id], {
    kind: "analysis_started",
    tone: model ? "ai" : "info",
    title: `Analysis started: ${name}`,
    body: model ? "An AI model is reading the code. This usually takes 5 to 8 minutes." : "Reading the code with the rules. This usually takes a few minutes.",
    analysis_id: row.id,
  });

  // The runner gets a one-time token for the key, never the key itself. If the token cannot be saved, the run stops.
  let modelToken = "";
  if (model) {
    modelToken = (await issueModelToken(env, row.id, model.key.id)) || "";
    if (!modelToken) {
      await serviceRest(env, `analyses?id=eq.${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "failed", error: "Could not prepare the model for the analysis.", finished_at: new Date().toISOString() }),
      });
      return json({ error: "Could not prepare the model for the analysis. Try again in a minute." }, 502);
    }
  }

  // Start the runner. If this fails, mark the row failed so it is not stuck in "queued".
  const dispatch = await dispatchRunner(env, {
    analysis_id: row.id,
    repo,
    ref: ref || "",
    model_token: modelToken,
    draw_screens: model ? await workspaceDrawsScreens(env, access.workspace_id) : false,
  });
  if (!dispatch.ok) {
    await serviceRest(env, `analyses?id=eq.${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", error: "Could not start the analysis runner.", finished_at: new Date().toISOString() }),
    });
    return json({ error: "Could not start the analysis runner." }, 502);
  }

  return json({ id: row.id, status: row.status }, 202);
}

// ---- Upload a zip of the code from this computer, for an analysis without GitHub ----

// The zip is stored privately for the run only. The runner reads it once, then the Worker deletes it.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const SOURCE_BUCKET = "analysis-sources";
const UPLOAD_REPO = "upload/archive";

function storageUrl(env, objectPath) {
  return `${env.SUPABASE_URL}/storage/v1/object/${SOURCE_BUCKET}/${objectPath}`;
}

function storageHeaders(env, extra = {}) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, ...extra };
}

// Deletes the stored zip of an analysis, if it has one. Returns false if the file could not be removed.
async function deleteSourceFile(env, row) {
  if (!row || !row.source_path) return true;
  const res = await fetch(storageUrl(env, row.source_path), { method: "DELETE", headers: storageHeaders(env) });
  if (!res.ok && res.status !== 404) return false;
  const cleared = await serviceRest(env, `analyses?id=eq.${row.id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ source_path: null }),
  });
  return cleared.ok;
}

// Starts an analysis of an uploaded zip. The zip comes as the request body, the settings in the query string.
async function startUpload(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const query = new URL(request.url).searchParams;
  const access = await workspaceAccessAs(env, auth, query.get("workspace_id"));
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can start analyses." }, 403);

  const name = (query.get("app_name") || "").trim();
  if (!name || name.length > MAX_TITLE) {
    return json({ error: `Give the application a name of 1 to ${MAX_TITLE} characters.` }, 400);
  }
  if (query.get("data_rules_confirmed") !== "true") {
    return json({ error: "Confirm that the code and its settings contain no patient information." }, 400);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_UPLOAD_BYTES) {
    return json({ error: "The zip is larger than 50 MB. Remove files that are not code, such as builds, images or backups, and try again." }, 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return json({ error: "The zip is larger than 50 MB. Remove files that are not code, and try again." }, 413);
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return json({ error: "Upload a .zip file of the code." }, 400);
  }

  const keyId = query.get("model_key_id") || null;
  let model = null;
  if (keyId) {
    const chosen = await chooseAnalysisModel(env, access.workspace_id, keyId);
    if (chosen.response) return chosen.response;
    model = chosen;
  }

  const id = crypto.randomUUID();
  const objectPath = `${id}.zip`;
  const stored = await fetch(storageUrl(env, objectPath), {
    method: "POST",
    headers: storageHeaders(env, { "content-type": "application/zip", "x-upsert": "false" }),
    body: bytes,
  });
  if (!stored.ok) return json({ error: "Could not save the upload. Try again in a minute." }, 502);

  const created = await serviceRest(env, "analyses", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      id,
      owner_id: auth.user.id,
      workspace_id: access.workspace_id,
      repo: UPLOAD_REPO,
      ref: null,
      app_name: name,
      source_kind: "upload",
      source_path: objectPath,
      data_rules_confirmed_at: new Date().toISOString(),
      ...(model ? {
        model_provider: model.key.provider,
        model_key_id: model.key.id,
        model_notice_version: model.notice_version,
        model_chosen_by_email: normalizeEmail(auth.user.email),
      } : {}),
    }),
  });
  if (!created.ok) {
    await fetch(storageUrl(env, objectPath), { method: "DELETE", headers: storageHeaders(env) });
    return json({ error: "Could not create the analysis." }, 502);
  }
  const [row] = await created.json();
  await notifyPeople(env, access.workspace_id, [auth.user.id], {
    kind: "analysis_started",
    tone: model ? "ai" : "info",
    title: `Analysis started: ${name}`,
    body: model ? "An AI model is reading the uploaded code. This usually takes 5 to 8 minutes." : "Reading the uploaded code with the rules. This usually takes a few minutes.",
    analysis_id: row.id,
  });

  const failRun = async (message) => {
    await serviceRest(env, `analyses?id=eq.${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", error: message, finished_at: new Date().toISOString() }),
    });
    await deleteSourceFile(env, row);
  };

  let modelToken = "";
  if (model) {
    modelToken = (await issueModelToken(env, row.id, model.key.id)) || "";
    if (!modelToken) {
      await failRun("Could not prepare the model for the analysis.");
      return json({ error: "Could not prepare the model for the analysis. Try again in a minute." }, 502);
    }
  }
  const dispatch = await dispatchRunner(env, {
    analysis_id: row.id,
    repo: UPLOAD_REPO,
    ref: "",
    model_token: modelToken,
    draw_screens: model ? await workspaceDrawsScreens(env, access.workspace_id) : false,
    source_upload: true,
  });
  if (!dispatch.ok) {
    await failRun("Could not start the analysis runner.");
    return json({ error: "Could not start the analysis runner." }, 502);
  }
  return json({ id: row.id, status: row.status }, 202);
}

// The runner reads the zip once, with the shared secret, and the Worker deletes it when the run is over.
async function runnerSource(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const found = await loadAnalysis(env, id);
  if (found.failed) return json({ error: "Could not load the analysis." }, 502);
  if (found.missing || found.row.source_kind !== "upload" || !found.row.source_path) {
    return json({ error: "No uploaded code for this analysis." }, 404);
  }
  const res = await fetch(storageUrl(env, found.row.source_path), { headers: storageHeaders(env) });
  if (!res.ok) return json({ error: "Could not read the upload." }, 502);
  return new Response(res.body, { headers: { "content-type": "application/zip", "cache-control": "no-store" } });
}

async function runnerDeleteSource(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const found = await loadAnalysis(env, id);
  if (found.failed) return json({ error: "Could not load the analysis." }, 502);
  if (found.missing) return json({ deleted: true });
  if (!(await deleteSourceFile(env, found.row))) return json({ error: "Could not delete the upload." }, 502);
  return json({ deleted: true });
}

// ---- Database structure: table, field and row-count names from access_metadata.py. No row values. ----

const MAX_DB_METADATA_BYTES = 2_000_000;

// Shows whether a structure is saved, with its counts. Members see the counts, not the names.
async function getDbMetadataSummary(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const res = await serviceRest(env, `analysis_db_metadata?analysis_id=eq.${id}&select=table_count,field_count,uploaded_by,uploaded_at,database:doc->>database`);
  if (!res.ok) return json({ error: "Could not load the database structure." }, 502);
  const [row] = await res.json();
  return json({
    present: Boolean(row),
    database: row ? row.database : null,
    tables: row ? row.table_count : null,
    fields: row ? row.field_count : null,
    uploaded_by: row ? row.uploaded_by : null,
    uploaded_at: row ? row.uploaded_at : null,
    can_change: canStart(access.member),
  });
}

// Saves a structure file, replacing any earlier one. Refused while the analysis is running, so a run sees one file.
async function saveDbMetadata(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can add the database structure." }, 403);
  if (access.row.status === "queued" || access.row.status === "running") {
    return json({ error: "Wait for the analysis to finish before changing the database structure." }, 409);
  }
  const parsed = await readJson(request, MAX_DB_METADATA_BYTES);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const checked = validateDbMetadata(parsed.value);
  if (checked.error) return json({ error: checked.error }, 400);
  const cleared = await serviceRest(env, `analysis_db_metadata?analysis_id=eq.${id}`, { method: "DELETE" });
  if (!cleared.ok) return json({ error: "Could not save the database structure." }, 502);
  const made = await serviceRest(env, "analysis_db_metadata", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      analysis_id: id,
      doc: checked.value,
      table_count: checked.tables,
      field_count: checked.fields,
      uploaded_by: access.user.email,
    }),
  });
  if (!made.ok) return json({ error: "Could not save the database structure." }, 502);
  return json({ saved: true, tables: checked.tables, fields: checked.fields }, 201);
}

async function deleteDbMetadata(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can remove the database structure." }, 403);
  if (access.row.status === "queued" || access.row.status === "running") {
    return json({ error: "Wait for the analysis to finish before changing the database structure." }, 409);
  }
  const res = await serviceRest(env, `analysis_db_metadata?analysis_id=eq.${id}`, { method: "DELETE" });
  if (!res.ok) return json({ error: "Could not remove the database structure." }, 502);
  return json({ removed: true });
}

// The runner's read of the saved structure. It sends the file on to the engine and nothing else.
async function runnerDbMetadata(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const res = await serviceRest(env, `analysis_db_metadata?analysis_id=eq.${id}&select=doc`);
  if (!res.ok) return json({ error: "Could not load the database structure." }, 502);
  const [row] = await res.json();
  if (!row) return json({ error: "No database structure saved." }, 404);
  return json(row.doc);
}

// Starts the analysis workflow with the given inputs. Returns the GitHub response.
function dispatchRunner(env, inputs) {
  return fetch(`https://api.github.com/repos/${env.RUNNER_REPO}/actions/workflows/analyze.yml/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      "user-agent": "cutover-api",
    },
    body: JSON.stringify({ ref: "main", inputs }),
  });
}

// ---- Run a finished analysis again: the same repository, reading the database structure saved since ----

// Only a finished run (complete or failed) can be run again. The earlier file results and drawn screens are cleared.
// The database structure, comments, actions, contingencies, cloud and intake stay as they are.
async function rerunAnalysis(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can run an analysis again." }, 403);
  const row = access.row;
  if (row.status !== "complete" && row.status !== "failed") {
    return json({ error: "This analysis is still running." }, 409);
  }
  if (row.source_kind === "upload") {
    return json({ error: "The uploaded code was deleted after the first run. Upload the code again to run the analysis." }, 409);
  }

  // The same model as the first run, if it had one. The key must still be active and the privacy notice still signed off.
  let modelToken = "";
  let drawScreens = false;
  if (row.model_key_id) {
    const chosen = await chooseAnalysisModel(env, row.workspace_id, row.model_key_id);
    if (chosen.response) return chosen.response;
    modelToken = (await issueModelToken(env, row.id, chosen.key.id)) || "";
    if (!modelToken) return json({ error: "Could not prepare the model for the run. Try again in a minute." }, 502);
    drawScreens = await workspaceDrawsScreens(env, row.workspace_id);
  }

  for (const table of ["file_findings", "analysis_screens"]) {
    const cleared = await serviceRest(env, `${table}?analysis_id=eq.${id}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    if (!cleared.ok) return json({ error: "Could not clear the earlier results. Try again in a minute." }, 502);
  }
  const reset = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ status: "queued", findings: null, error: null, commit_sha: null, finished_at: null, deeper_done: false, file_bytes: 0 }),
  });
  if (!reset.ok) return json({ error: "Could not start the run again. Try again in a minute." }, 502);

  const dispatch = await dispatchRunner(env, { analysis_id: id, repo: row.repo, ref: row.ref || "", model_token: modelToken, draw_screens: drawScreens, source_upload: false });
  if (!dispatch.ok) {
    await serviceRest(env, `analyses?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", error: "Could not start the analysis runner.", finished_at: new Date().toISOString() }),
    });
    return json({ error: "Could not start the analysis runner." }, 502);
  }
  await notifyPeople(env, row.workspace_id, [access.user.id], {
    kind: "analysis_started",
    tone: row.model_key_id ? "ai" : "info",
    title: `Analysis started again: ${row.app_name}`,
    body: "Reading the code again, with the database structure saved so far.",
    analysis_id: id,
  });
  return json({ id, status: "queued" }, 202);
}

async function getAnalysis(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const { row, member, user } = access;

  const [commentsRes, actionsRes, contingenciesRes] = await Promise.all([
    serviceRest(env, `analysis_comments?analysis_id=eq.${id}&select=id,author_id,author_email,body,created_at&order=created_at.asc`),
    serviceRest(env, `action_items?analysis_id=eq.${id}&select=id,title,status,created_by_email,done_by_email,created_at,done_at&order=created_at.asc`),
    serviceRest(env, `contingencies?analysis_id=eq.${id}&select=id,finding_id,risk,contingency,rollback_step,trigger_condition,owner_email,status,created_by_email,updated_by_email,created_at,updated_at&order=created_at.asc`),
  ]);
  if (!commentsRes.ok || !actionsRes.ok || !contingenciesRes.ok) {
    return json({ error: "Could not load the analysis." }, 502);
  }

  const isAdmin = member.is_admin === true;
  const { owner_id, findings, ...analysis } = row;
  const comments = (await commentsRes.json()).map(({ author_id, ...c }) => ({
    ...c,
    can_delete: author_id === user.id || isAdmin,
  }));
  // Screens are UI, so they follow the UI category: the roles that may see UI findings see the drawn screens.
  let screens = [];
  if (seesCategory(member.role, "ui_portal")) {
    const screensRes = await serviceRest(env, `analysis_screens?analysis_id=eq.${id}&select=id,path,name,html&order=path.asc`);
    if (!screensRes.ok) return json({ error: "Could not load the analysis." }, 502);
    screens = await screensRes.json();
  }
  const approval = await conversionApproval(env, analysis.workspace_id);
  const targetApprovalNow = await targetApproval(env, analysis);
  // Proposals are code, so only platform engineers see them.
  let conversions = [];
  if (canStart(member)) {
    const convRes = await serviceRest(env, `analysis_conversions?analysis_id=eq.${id}&select=id,path,template,status,proposed,reason,kinds,stage,decision,decided_by_email,decided_at,created_at&order=path.asc`);
    if (!convRes.ok) return json({ error: "Could not load the conversions." }, 502);
    conversions = await convRes.json();
  }
  return json({
    ...analysis,
    conversions,
    ...analysis,
    conversion_approval: approval.approved ? { by: approval.by, at: approval.at } : null,
    target_options: TARGET_LANGUAGES,
    target_approval: targetApprovalNow.approved ? { by: targetApprovalNow.by, at: targetApprovalNow.at } : null,
    target_can_approve: canApproveTarget(analysis, member, user),
    conversion_admin: member.is_admin === true,
    conversion_wording: CONVERSION_APPROVAL_TEXT,
    cost_lines: analysis.cost_users ? costLines(analysis.cost_users, tableCountOf(findings)) : null,
    findings: visibleReport(findings, member.role),
    screens,
    is_mine: owner_id === user.id,
    can_delete: owner_id === user.id || isAdmin,
    viewer_role: member.role,
    viewer_is_admin: isAdmin,
    can_work_items: canWorkItems(member),
    can_plan: canStart(member),
    stages: stageStates(row, user.id),
    comments,
    action_items: await actionsRes.json(),
    contingencies: await contingenciesRes.json(),
  });
}

// ---- Screens drawn by the workspace's own model from the code ----
// One upload holds every drawing of an analysis: a classic ASP page is one drawing per screen branch.
const SCREEN_MAX = 80;
const SCREEN_MAX_CHARS = 40_000;
// A drawn screen is a plain page. Anything that runs code, loads from elsewhere, or sends a form is refused.
const SCREEN_REFUSED = [
  /<\s*(script|iframe|frame|frameset|object|embed|link|meta|base|form|style\s+src)\b/i,
  /\son[a-z]+\s*=/i,
  /\b(src|href|action|poster|srcset|background|formaction)\s*=\s*["']?\s*(https?:|\/\/|data:|javascript:)/i,
  /url\(\s*["']?\s*(https?:|\/\/|data:)/i,
  /@import/i,
  /javascript:/i,
];

function seesCategory(role, category) {
  const allowed = Object.prototype.hasOwnProperty.call(ROLE_CATEGORIES, role) ? ROLE_CATEGORIES[role] : [];
  return allowed === "all" || allowed.includes(category);
}

// Returns why a screen is refused, or null when it may be kept.
function screenProblem(html) {
  if (typeof html !== "string" || html.length < 50 || html.length > SCREEN_MAX_CHARS) {
    return "Each screen must be HTML of 50 to 40,000 characters.";
  }
  if (!/<html|<body|<!doctype/i.test(html)) return "Each screen must be a complete HTML page.";
  if (SCREEN_REFUSED.some((rx) => rx.test(html))) {
    return "A screen used something a drawing may not use: scripts, links to other sites, forms or frames.";
  }
  return null;
}

// Saves the screens for one analysis, replacing any saved before. Only while the analysis is still running.
async function runnerScreens(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const found = await serviceRest(env, `analyses?id=eq.${id}&select=id,status`);
  if (!found.ok) return json({ error: "Could not load the analysis." }, 502);
  const [analysis] = await found.json();
  if (!analysis) return json({ error: "Not found." }, 404);
  if (analysis.status !== "queued" && analysis.status !== "running") {
    return json({ error: "This analysis is no longer taking results." }, 409);
  }
  const parsed = await readJson(request, 4_000_000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const list = parsed.value?.screens;
  if (!Array.isArray(list) || list.length === 0 || list.length > SCREEN_MAX) {
    return json({ error: `Send 1 to ${SCREEN_MAX} screens.` }, 400);
  }
  const rows = [];
  const paths = new Set();
  for (const value of list) {
    const path = typeof value?.path === "string" ? value.path.trim() : "";
    const name = typeof value?.name === "string" ? value.name.trim() : "";
    if (!path || path.length > 512) return json({ error: "Each screen needs a path of up to 512 characters." }, 400);
    if (!name || name.length > 120) return json({ error: "Each screen needs a name of up to 120 characters." }, 400);
    if (paths.has(path)) return json({ error: `The path ${path} appears twice.` }, 400);
    const problem = screenProblem(value.html);
    if (problem) return json({ error: problem }, 400);
    paths.add(path);
    rows.push({ analysis_id: id, path, name, html: value.html });
  }
  const cleared = await serviceRest(env, `analysis_screens?analysis_id=eq.${id}`, { method: "DELETE" });
  if (!cleared.ok) return json({ error: "Could not save the screens." }, 502);
  const made = await serviceRest(env, "analysis_screens", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(rows) });
  if (!made.ok) return json({ error: "Could not save the screens." }, 502);
  return json({ saved: rows.length }, 201);
}

async function deleteAnalysis(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const isOwner = access.row.owner_id === access.user.id;
  if (!isOwner && !access.member.is_admin) {
    return json({ error: "Only the person who started this analysis or a workspace admin can delete it." }, 403);
  }
  if (!(await recordDeletion(env, [{ id, repo: access.row.repo }], "requested"))) {
    return json({ error: "Could not record the deletion, so nothing was deleted." }, 502);
  }
  if (!(await deleteSourceFile(env, access.row))) return json({ error: "Could not delete the uploaded code. Try again in a minute." }, 502);
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (!res.ok) return json({ error: "Could not delete the analysis." }, 502);
  return json({ deleted: true });
}

async function addComment(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const text = typeof parsed.value?.body === "string" ? parsed.value.body.trim() : "";
  if (!text || text.length > MAX_COMMENT) {
    return json({ error: `Comments must be 1 to ${MAX_COMMENT} characters.` }, 400);
  }
  const res = await serviceRest(env, "analysis_comments", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ analysis_id: id, author_id: access.user.id, author_email: access.user.email, body: text }),
  });
  if (!res.ok) return json({ error: "Could not save the comment." }, 502);
  if (access.row.owner_id !== access.user.id) {
    await notifyPeople(env, access.row.workspace_id, [access.row.owner_id], {
      kind: "comment_added", tone: "info", title: `New comment on ${access.row.app_name}`, body: text.slice(0, 140), analysis_id: id,
    });
  }
  return json({ saved: true }, 201);
}

async function deleteComment(request, env, id) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const res = await serviceRest(env, `analysis_comments?id=eq.${id}&select=id,author_id,analysis_id`);
  if (!res.ok) return json({ error: "Could not load the comment." }, 502);
  const [comment] = await res.json();
  if (!comment) return json({ error: "Not found." }, 404);
  const access = await analysisAccessAs(env, auth, comment.analysis_id);
  if (access.response) return access.response;
  if (comment.author_id !== auth.user.id && !access.member.is_admin) {
    return json({ error: "Only the author or a workspace admin can delete this comment." }, 403);
  }
  const del = await serviceRest(env, `analysis_comments?id=eq.${id}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (!del.ok) return json({ error: "Could not delete the comment." }, 502);
  return json({ deleted: true });
}

async function addAction(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canWorkItems(access.member)) {
    return json({ error: "Auditors can read and comment, but cannot add action items." }, 403);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const title = typeof parsed.value?.title === "string" ? parsed.value.title.trim() : "";
  if (!title || title.length > MAX_TITLE) {
    return json({ error: `Action items must be 1 to ${MAX_TITLE} characters.` }, 400);
  }
  const res = await serviceRest(env, "action_items", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ analysis_id: id, title, created_by: access.user.id, created_by_email: access.user.email }),
  });
  if (!res.ok) return json({ error: "Could not save the action item." }, 502);
  if (access.row.owner_id !== access.user.id) {
    await notifyPeople(env, access.row.workspace_id, [access.row.owner_id], {
      kind: "action_added", tone: "warning", title: `New action item on ${access.row.app_name}`, body: title.slice(0, 140), analysis_id: id,
    });
  }
  return json({ saved: true }, 201);
}

async function updateAction(request, env, id) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const found = await serviceRest(env, `action_items?id=eq.${id}&select=id,analysis_id`);
  if (!found.ok) return json({ error: "Could not load the action item." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  const access = await analysisAccessAs(env, auth, item.analysis_id);
  if (access.response) return access.response;
  if (!canWorkItems(access.member)) {
    return json({ error: "Auditors can read and comment, but cannot change action items." }, 403);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const status = parsed.value?.status;
  if (status !== "open" && status !== "done") {
    return json({ error: "status must be open or done." }, 400);
  }
  const change = status === "done"
    ? { status, done_by_email: auth.user.email, done_at: new Date().toISOString() }
    : { status, done_by_email: null, done_at: null };
  const res = await serviceRest(env, `action_items?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(change),
  });
  if (!res.ok) return json({ error: "Could not update the action item." }, 502);
  if (status === "done" && access.row.owner_id !== auth.user.id) {
    await notifyPeople(env, access.row.workspace_id, [access.row.owner_id], {
      kind: "action_done", tone: "success", title: `Action item done on ${access.row.app_name}`, body: auth.user.email, analysis_id: item.analysis_id,
    });
  }
  return json({ updated: true });
}

// Contingency plans. Every member can read them with the analysis; only platform engineers write them.
const CONTINGENCY_STATUS = ["proposed", "accepted", "edited", "rejected"];
const CONTINGENCY_TEXT = {
  risk: { max: 500, required: true },
  contingency: { max: 2000, required: true },
  rollback_step: { max: 2000, required: false },
  trigger_condition: { max: 500, required: false },
  owner_email: { max: 320, required: false },
  finding_id: { max: 200, required: false },
};
const CONTINGENCY_CONTENT = ["risk", "contingency", "rollback_step", "trigger_condition", "owner_email"];

// Checks a contingency body. On create every required field must be present; on update only what is sent is checked.
function contingencyFields(value, partial) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Send a contingency object." };
  }
  const out = {};
  for (const [key, rule] of Object.entries(CONTINGENCY_TEXT)) {
    if (!(key in value)) {
      if (rule.required && !partial) return { error: `${key} is required.` };
      continue;
    }
    if (value[key] !== null && typeof value[key] !== "string") return { error: `${key} must be text.` };
    const trimmed = (value[key] || "").trim();
    if (!trimmed) {
      if (rule.required) return { error: `${key} is required.` };
      out[key] = null;
      continue;
    }
    if (trimmed.length > rule.max) return { error: `${key} must be at most ${rule.max} characters.` };
    out[key] = trimmed;
  }
  if ("status" in value) {
    if (!CONTINGENCY_STATUS.includes(value.status)) {
      return { error: "status must be proposed, accepted, edited or rejected." };
    }
    out.status = value.status;
  }
  if (partial && Object.keys(out).length === 0) return { error: "Nothing to change." };
  return { fields: out };
}

async function addContingency(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) {
    return json({ error: "Only platform engineers can plan contingencies." }, 403);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const checked = contingencyFields(parsed.value, false);
  if (checked.error) return json({ error: checked.error }, 400);
  const res = await serviceRest(env, "contingencies", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      ...checked.fields,
      status: checked.fields.status || "proposed",
      analysis_id: id,
      created_by: access.user.id,
      created_by_email: access.user.email,
      updated_by_email: access.user.email,
    }),
  });
  if (!res.ok) return json({ error: "Could not save the contingency." }, 502);
  return json({ saved: true }, 201);
}

// ---- Migrate: the target cloud, then the intake form that the Terraform draft will use ----
const CLOUDS = { google: "Google Cloud", aws: "AWS", azure: "Azure", undecided: "Not decided yet" };
const NETWORKS = ["new", "existing"];
// Region names each provider uses. Checked when the intake is saved, confirmed and drafted, so a region that
// the cloud would refuse never reaches a Terraform draft. The app's region list is generated from this same
// text; service/app/test/regions.test.mjs fails if they differ. Last updated 2026-10-21.
export const REGIONS = {
  aws: ["us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "ca-west-1", "eu-west-1", "eu-west-2", "eu-west-3",
    "eu-central-1", "eu-central-2", "eu-north-1", "eu-south-1", "eu-south-2", "ap-south-1", "ap-south-2", "ap-southeast-1",
    "ap-southeast-2", "ap-southeast-3", "ap-northeast-1", "ap-northeast-2", "ap-northeast-3", "ap-east-1", "sa-east-1",
    "me-south-1", "me-central-1", "af-south-1", "il-central-1"],
  google: ["us-central1", "us-east1", "us-east4", "us-east5", "us-south1", "us-west1", "us-west2", "us-west3", "us-west4",
    "northamerica-northeast1", "northamerica-northeast2", "southamerica-east1", "europe-west1", "europe-west2", "europe-west3",
    "europe-west4", "europe-west6", "europe-west8", "europe-west9", "europe-west10", "europe-west12", "europe-north1",
    "europe-central2", "europe-southwest1", "asia-east1", "asia-east2", "asia-northeast1", "asia-northeast2", "asia-northeast3",
    "asia-south1", "asia-south2", "asia-southeast1", "asia-southeast2", "australia-southeast1", "australia-southeast2",
    "me-central1", "me-west1", "africa-south1"],
  azure: ["eastus", "eastus2", "westus", "westus2", "westus3", "centralus", "northcentralus", "southcentralus", "westcentralus",
    "canadacentral", "canadaeast", "brazilsouth", "northeurope", "westeurope", "uksouth", "ukwest", "francecentral",
    "germanywestcentral", "swedencentral", "norwayeast", "switzerlandnorth", "polandcentral", "italynorth", "australiaeast",
    "australiasoutheast", "japaneast", "japanwest", "koreacentral", "southeastasia", "eastasia", "centralindia", "southindia",
    "uaenorth", "southafricanorth", "qatarcentral"],
};
const TERRAFORM_CLOUDS = ["google", "aws", "azure"];
const SIGN_INS = ["google", "microsoft", "other"];

// Free text in the intake must describe settings, not people. A personal email address is refused.
function describesNoPerson(text) {
  return !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text);
}

// Checks the intake form. Every field is required.
function intakeFields(value, cloud) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Send the intake form as an object." };
  const text = (key, max) => (typeof value[key] === "string" ? value[key].trim() : "");
  const region = text("region", 60);
  const residency = text("residency", 120);
  const compliance = text("compliance", 200);
  const network = value.network;
  const signIn = value.sign_in;
  const users = Number(value.expected_users);
  if (!region) return { error: "Region is required." };
  if (REGIONS[cloud] && !REGIONS[cloud].includes(region)) {
    return { error: `Choose a region from the list for ${CLOUDS[cloud]}.` };
  }
  if (!NETWORKS.includes(network)) return { error: "Network must be new or existing." };
  if (!SIGN_INS.includes(signIn)) return { error: "Sign-in provider must be google, microsoft or other." };
  if (!compliance) return { error: "Compliance requirements are required. Write None if there are none." };
  if (!Number.isInteger(users) || users < 1 || users > 10_000_000) return { error: "Expected users must be a whole number from 1 to 10,000,000." };
  if (!residency) return { error: "Data residency is required." };
  for (const [label, content] of [["Region", region], ["Compliance requirements", compliance], ["Data residency", residency]]) {
    if (!describesNoPerson(content)) return { error: `${label} must not contain a personal email address. Describe the setting instead.` };
  }
  return { fields: { region, network, sign_in: signIn, compliance, expected_users: users, residency } };
}

// Modernize cost estimate for a number of users. The same rules as engine/cost_model.py, with the rates from
// cost-rates.mjs. Estimates only: Google Cloud only, and network, backups, high availability and logging are left out.
const COST_USERS_MAX = 10000000;

function costRunMonthly(users, requestsPerUserPerDay) {
  const run = COST_RATES.cloud_run;
  const size = COST_RATES.sizing;
  const requests = users * requestsPerUserPerDay * size.days_per_month;
  const vcpuSeconds = requests * size.seconds_per_request * size.vcpu_per_request;
  const gibSeconds = requests * size.seconds_per_request * size.gib_per_request;
  const billableVcpu = Math.max(0, vcpuSeconds - run.free_vcpu_seconds);
  const billableGib = Math.max(0, gibSeconds - run.free_gib_seconds);
  const billableRequests = Math.max(0, requests - run.free_requests);
  return billableVcpu * run.cpu_per_vcpu_second
    + billableGib * run.memory_per_gib_second
    + (billableRequests / 1000000) * run.per_million_requests;
}

function costDatabaseTier(users) {
  const tiers = COST_RATES.sizing.database_tiers;
  return tiers.find((tier) => users <= tier.max_users) || tiers[tiers.length - 1];
}

function costSqlMonthly(users) {
  const db = COST_RATES.cloud_sql_postgres;
  const tier = costDatabaseTier(users);
  const hours = db.hours_per_month;
  return tier.vcpu * db.per_vcpu_hour * hours
    + tier.memory_gib * db.per_gib_memory_hour * hours
    + tier.storage_gib * db.per_gib_storage_hour * hours;
}

const NO_DATABASE_LINE = "No database cost is estimated, because no database tables were found in the SQL scripts.";

function costUsd(value) {
  if (value < 0.005) return "$0";
  return value >= 10 ? `$${Math.round(value).toLocaleString("en-US")}` : `$${value.toFixed(2)}`;
}

function costRange(low, high) {
  const a = costUsd(low);
  const b = costUsd(high);
  return a === b ? `about ${a}` : `about ${a} to ${b}`;
}

function costNote() {
  return `Rates from Google Cloud's published prices, checked ${COST_RATES.checked}, in ${COST_RATES.currency}. `
    + "Not costed: AWS and Azure, and network, backups, high availability and logging. Estimates, not quotes.";
}

// The table count from the analysis findings, or null when the scan did not record one.
function tableCountOf(findings) {
  const count = findings && findings.findings && findings.findings["data.tables"]
    && findings.findings["data.tables"].value && findings.findings["data.tables"].value.count;
  return typeof count === "number" ? count : null;
}

// The three lines shown for a number of users: containers, managed database, and the note.
// With no database tables found, the managed line says so instead of giving a database cost.
function costLines(users, tableCount = null) {
  const size = COST_RATES.sizing;
  const n = users.toLocaleString("en-US");
  const runLow = costRunMonthly(users, size.requests_per_user_per_day_low);
  const runHigh = costRunMonthly(users, size.requests_per_user_per_day_high);
  const db = costSqlMonthly(users);
  const tier = costDatabaseTier(users);
  const managedLine = tableCount === 0
    ? NO_DATABASE_LINE
    : `Estimated Google Cloud cost for ${n} users: ${costRange(runLow + db, runHigh + db)} a month for Cloud SQL for PostgreSQL (${tier.vcpu} vCPU, ${tier.memory_gib} GiB memory, ${tier.storage_gib} GiB storage, about ${costUsd(db)}) plus the application on Cloud Run.`;
  return [
    `Estimated Google Cloud cost for ${n} users: ${costRange(runLow, runHigh)} a month for the application containers on Cloud Run (compute and requests only).`,
    managedLine,
    costNote(),
  ];
}

// The engineer enters how many people use the application. The Modernize estimate then uses that number.
async function setCostUsers(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can set the number of users." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const users = Number(parsed.value && parsed.value.users);
  if (!Number.isInteger(users) || users < 1 || users > COST_USERS_MAX) {
    return json({ error: `Enter a whole number of users from 1 to ${COST_USERS_MAX.toLocaleString("en-US")}.` }, 400);
  }
  if (!access.row.deeper_done) return json({ error: "Finish the deeper assessment first." }, 409);
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH", headers: { prefer: "return=minimal" },
    body: JSON.stringify({ cost_users: users, cost_users_set_by_email: access.user.email, cost_users_set_at: new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "Could not save the number of users." }, 502);
  await notifyPeople(env, access.row.workspace_id, await analysisAudienceExcept(env, access.row, access.user.id), {
    kind: "cost_users_set", tone: "info", title: `Users for the estimate: ${users.toLocaleString("en-US")}`,
    body: `${access.user.email} set the number of users for the Modernize cost estimate.`, analysis_id: id,
  });
  return json({ saved: true, users, lines: costLines(users, tableCountOf(access.row.findings)) });
}

async function setCloud(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can choose the cloud." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const cloud = parsed.value && parsed.value.cloud;
  if (!Object.prototype.hasOwnProperty.call(CLOUDS, cloud)) return json({ error: "Choose google, aws, azure or undecided." }, 400);
  if (access.row.scope !== "migrate") return json({ error: "Choose Migrate as the next stage first." }, 409);
  const changed = access.row.cloud !== cloud;
  // A different cloud makes the saved intake and its confirmation out of date, so they are cleared.
  const change = changed
    ? { cloud, cloud_set_by_email: access.user.email, cloud_set_at: new Date().toISOString(), intake_confirmed_by_email: null, intake_confirmed_at: null }
    : { cloud, cloud_set_by_email: access.user.email, cloud_set_at: new Date().toISOString() };
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(change),
  });
  if (!res.ok) return json({ error: "Could not save the cloud." }, 502);
  if (changed) {
    await notifyPeople(env, access.row.workspace_id, await analysisAudienceExcept(env, access.row, access.user.id), {
      kind: "cloud_chosen", tone: "info", title: `Cloud chosen: ${CLOUDS[cloud]}`,
      body: `${access.row.app_name || access.row.repo}: chosen by ${access.user.email}.`, analysis_id: id,
    });
  }
  return json({ saved: true });
}

async function saveIntake(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can fill in the intake." }, 403);
  if (access.row.scope !== "migrate") return json({ error: "Choose Migrate as the next stage first." }, 409);
  if (!access.row.cloud || access.row.cloud === "undecided") return json({ error: "Choose a cloud before the intake form." }, 409);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const checked = intakeFields(parsed.value, access.row.cloud);
  if (checked.error) return json({ error: checked.error }, 400);
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH", headers: { prefer: "return=minimal" },
    body: JSON.stringify({ intake: checked.fields, intake_saved_at: new Date().toISOString(), intake_confirmed_by_email: null, intake_confirmed_at: null }),
  });
  if (!res.ok) return json({ error: "Could not save the intake." }, 502);
  return json({ saved: true });
}

async function confirmIntake(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can confirm the intake." }, 403);
  if (!access.row.intake || intakeFields(access.row.intake, access.row.cloud).error) {
    return json({ error: "Save every field of the intake before confirming it." }, 409);
  }
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH", headers: { prefer: "return=minimal" },
    body: JSON.stringify({ intake_confirmed_by_email: access.user.email, intake_confirmed_at: new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "Could not confirm the intake." }, 502);
  await notifyPeople(env, access.row.workspace_id, await analysisAudienceExcept(env, access.row, access.user.id), {
    kind: "intake_confirmed", tone: "success", title: `Intake confirmed: ${CLOUDS[access.row.cloud]}`,
    body: `${access.row.app_name || access.row.repo}: confirmed by ${access.user.email}. The Terraform draft can now be made.`, analysis_id: id,
  });
  return json({ confirmed: true });
}

// ---- Terraform draft: made only from a confirmed intake, saved as numbered versions that are never overwritten ----
// Infrastructure is visible to the roles that see the infrastructure findings (platform engineers and CIO/CTO).

// Makes text safe inside a Terraform string: no quotes, backslashes or line breaks can end the string early.
function hclText(value) {
  return String(value).replace(/[\\"\r\n]/g, " ").trim();
}

export function terraformFor(cloud, intake) {
  const region = hclText(intake.region);
  const newNetwork = intake.network === "new";
  const header = [
    "# DRAFT generated by Cutover from a confirmed intake. Review before use.",
    "# Sample values only: replace the example names with your own before running anything.",
    "# Inputs used:",
    `#   region: ${region}`,
    `#   network: ${intake.network}`,
    `#   sign-in provider: ${intake.sign_in}`,
    `#   compliance requirements: ${hclText(intake.compliance)}`,
    `#   expected users: ${intake.expected_users}`,
    `#   data residency: ${hclText(intake.residency)}`,
    "",
  ];
  if (cloud === "google") {
    return [...header,
      'terraform {',
      '  required_providers {',
      '    google = { source = "hashicorp/google" }',
      '  }',
      '}',
      '',
      'provider "google" {',
      `  region = "${region}"`,
      '}',
      '',
      newNetwork
        ? 'resource "google_compute_network" "app" {\n  name                    = "cutover-app"\n  auto_create_subnetworks = false\n}'
        : '# The existing network is read, not created.\ndata "google_compute_network" "app" {\n  name = "existing-network-name"\n}',
      '',
      `# Sized for about ${intake.expected_users} users.`,
      '',
    ].join("\n");
  }
  if (cloud === "aws") {
    return [...header,
      'terraform {',
      '  required_providers {',
      '    aws = { source = "hashicorp/aws" }',
      '  }',
      '}',
      '',
      'provider "aws" {',
      `  region = "${region}"`,
      '}',
      '',
      newNetwork
        ? 'resource "aws_vpc" "app" {\n  cidr_block = "10.0.0.0/16"\n  tags       = { Name = "cutover-app" }\n}'
        : '# The existing VPC is read, not created.\ndata "aws_vpc" "app" {\n  tags = { Name = "existing-vpc-name" }\n}',
      '',
      `# Sized for about ${intake.expected_users} users.`,
      '',
    ].join("\n");
  }
  return [...header,
    'terraform {',
    '  required_providers {',
    '    azurerm = { source = "hashicorp/azurerm" }',
    '  }',
    '}',
    '',
    'provider "azurerm" {',
    '  features {}',
    '}',
    '',
    'resource "azurerm_resource_group" "app" {',
    '  name     = "cutover-app"',
    `  location = "${region}"`,
    '}',
    '',
    newNetwork
      ? 'resource "azurerm_virtual_network" "app" {\n  name                = "cutover-app"\n  address_space       = ["10.0.0.0/16"]\n  location            = azurerm_resource_group.app.location\n  resource_group_name = azurerm_resource_group.app.name\n}'
      : '# The existing virtual network is read, not created.\ndata "azurerm_virtual_network" "app" {\n  name                = "existing-vnet-name"\n  resource_group_name = "existing-rg-name"\n}',
    '',
    `# Sized for about ${intake.expected_users} users.`,
    '',
  ].join("\n");
}

async function listTerraform(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!seesCategory(access.member.role, "infrastructure")) {
    return json({ error: "Not shown for your role." }, 403);
  }
  const res = await serviceRest(env, `terraform_versions?analysis_id=eq.${id}&select=id,version,cloud,content,inputs,created_by_email,created_at`);
  if (!res.ok) return json({ error: "Could not load the Terraform drafts." }, 502);
  const versions = (await res.json()).sort((a, b) => b.version - a.version);
  return json({ versions });
}

async function draftTerraform(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can make a Terraform draft." }, 403);
  const row = access.row;
  if (row.scope !== "migrate") return json({ error: "Choose Migrate as the next stage first." }, 409);
  if (!row.cloud || row.cloud === "undecided" || !TERRAFORM_CLOUDS.includes(row.cloud)) {
    return json({ error: "Choose Google Cloud, AWS or Azure before making the draft." }, 409);
  }
  if (!row.intake_confirmed_at || !row.intake || intakeFields(row.intake, row.cloud).error) {
    return json({ error: "Confirm the intake before making the Terraform draft." }, 409);
  }
  const existing = await serviceRest(env, `terraform_versions?analysis_id=eq.${id}&select=version`);
  if (!existing.ok) return json({ error: "Could not check the earlier drafts." }, 502);
  const version = Math.max(0, ...(await existing.json()).map((v) => v.version)) + 1;
  const content = terraformFor(row.cloud, row.intake);
  if (content.length > 60000) return json({ error: "The draft is too large to save." }, 502);
  const res = await serviceRest(env, "terraform_versions", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      analysis_id: id, version, cloud: row.cloud, content, inputs: row.intake,
      created_by_email: access.user.email,
    }),
  });
  if (!res.ok) return json({ error: "Could not save the draft." }, 502);
  await notifyPeople(env, row.workspace_id, await analysisAudienceExcept(env, row, access.user.id), {
    kind: "terraform_drafted", tone: "info", title: `Terraform draft ${version} ready: ${row.app_name || row.repo}`,
    body: `${CLOUDS[row.cloud]}, made by ${access.user.email}. It is a draft to review.`, analysis_id: id,
  });
  return json({ saved: true, version }, 201);
}

// Saves the next stage for one analysis. Modernize and Migrate wait for the deeper assessment to finish.
async function setScope(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) {
    return json({ error: "Only platform engineers can choose the scope." }, 403);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const scope = parsed.value && parsed.value.scope;
  if (!["deeper", "modernize", "migrate"].includes(scope)) {
    return json({ error: "Choose deeper, modernize or migrate." }, 400);
  }
  if (scope !== "deeper" && access.row.deeper_done !== true) {
    return json({ error: "Finish the deeper assessment before choosing Modernize or Migrate." }, 409);
  }
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ scope, scope_set_by_email: access.user.email, scope_set_at: new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "Could not save the scope." }, 502);
  const labels = { deeper: "Deeper assessment", modernize: "Modernize", migrate: "Migrate" };
  await notifyPeople(env, access.row.workspace_id, await analysisAudienceExcept(env, access.row, access.user.id), {
    kind: "scope_chosen", tone: "info", title: `Next stage chosen: ${labels[scope]}`,
    body: `${access.row.app_name || access.row.repo}: chosen by ${access.user.email}.`, analysis_id: id,
  });
  return json({ saved: true });
}

// The modernized template the team chooses for this analysis. Platform engineers only. A later choice replaces it.
const MODERN_TEMPLATES = ["web-modern", "services-data", "lift-contain"];

async function setTemplate(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) {
    return json({ error: "Only platform engineers can choose the modernized template." }, 403);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const template = parsed.value && parsed.value.template;
  if (!MODERN_TEMPLATES.includes(template)) {
    return json({ error: "Choose web-modern, services-data or lift-contain." }, 400);
  }
  if (access.row.scope !== "modernize") {
    return json({ error: "Choose Modernize as the next stage before choosing the approach." }, 409);
  }
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      modern_template: template,
      modern_template_set_by_email: normalizeEmail(access.user.email),
      modern_template_set_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) return json({ error: "Could not save the template choice." }, 502);
  return json({ saved: true, template });
}

// ---- Target language: the language the modernized application is written in ----
// One catalogue. The portal shows what the server returns, so a new language is added here and nowhere else.
// Each option lists the approaches it fits. The approach decides which languages are offered.
const TARGET_LANGUAGES = [
  { id: "ts-react", label: "TypeScript with React", approaches: ["web-modern", "services-data"] },
  { id: "py-fastapi", label: "Python with FastAPI", approaches: ["web-modern", "services-data"] },
  { id: "cs-aspnet", label: "C# with ASP.NET Core", approaches: ["web-modern", "services-data"] },
  { id: "java-spring", label: "Java with Spring Boot", approaches: ["web-modern", "services-data"] },
  { id: "current", label: "Keep the current language", approaches: ["lift-contain"] },
];
const TARGET_IDS = TARGET_LANGUAGES.map((t) => t.id);

function targetOption(id) {
  return TARGET_LANGUAGES.find((t) => t.id === id) || null;
}

// Who may approve: the named application owner, or a CIO or CTO in the workspace.
function canApproveTarget(row, member, user) {
  const owner = normalizeEmail(row.target_owner_email);
  const me = normalizeEmail(user.email);
  return (owner && me && owner === me) || member.role === "cio_cto";
}

// Sets the target language and the named owner. Platform engineers only, after the approach is chosen.
// Each approval is kept as a record, so changing the language does not remove an approval that was given earlier.
async function setTarget(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can choose the target language." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const language = parsed.value && parsed.value.language;
  const option = targetOption(language);
  if (!option) return json({ error: `Choose one of: ${TARGET_IDS.join(", ")}.` }, 400);
  const owner = normalizeEmail(parsed.value && parsed.value.owner_email);
  if (!owner) return json({ error: "Enter the email of the application owner who approves the language." }, 400);
  if (access.row.scope !== "modernize") return json({ error: "Choose Modernize as the next stage first." }, 409);
  if (!access.row.modern_template) return json({ error: "Choose the approach before the target language." }, 409);
  if (!option.approaches.includes(access.row.modern_template)) {
    return json({ error: "That language does not fit the chosen approach. Choose another." }, 400);
  }
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      target_language: language,
      target_owner_email: owner,
      target_language_set_by_email: normalizeEmail(access.user.email),
      target_language_set_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) return json({ error: "Could not save the target language." }, 502);
  return json({ saved: true, language, owner_email: owner });
}

// Records an approval of the current target language, by the named owner or a CIO or CTO.
async function approveTarget(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const row = access.row;
  if (!row.target_language) return json({ error: "Choose the target language first." }, 409);
  if (!canApproveTarget(row, access.member, access.user)) {
    return json({ error: "Only the named application owner, or a CIO or CTO, can approve the target language." }, 403);
  }
  const res = await serviceRest(env, "analysis_target_approvals", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      analysis_id: id,
      language: row.target_language,
      approved_by_email: normalizeEmail(access.user.email),
    }),
  });
  if (!res.ok) return json({ error: "Could not save the approval." }, 502);
  return json({ approved: true, language: row.target_language });
}

// The latest approval of the current language, or null. Earlier approvals of other languages stay in the table.
async function targetApproval(env, row) {
  if (!row.target_language) return { approved: false };
  const res = await serviceRest(env, `analysis_target_approvals?analysis_id=eq.${row.id}&language=eq.${encodeURIComponent(row.target_language)}&select=approved_by_email,approved_at&order=approved_at.desc&limit=1`);
  if (!res.ok) return { approved: false, failed: true };
  const [latest] = await res.json();
  return latest ? { approved: true, by: latest.approved_by_email, at: latest.approved_at } : { approved: false };
}

// ---- The path to a modernized application: stages that unlock one after another ----
// Each stage is locked until the one before it is cleared. A stage is cleared by its own steps, and by a platform
// engineer's review once its output is ready. Each viewer is told once when a stage clears.
const PROGRESS_STAGES = [
  { id: "deeper", title: "Deeper assessment", produces: "The architecture, the sections and the documents for this application." },
  { id: "approach", title: "Choose the approach", produces: "The modernized approach the team agrees on, from the three proposals.", needs: "deeper" },
  { id: "plan", title: "Modernization plan", produces: "A plan for the chosen approach: the order of work, the risks and a rough size.", needs: "approach" },
  { id: "starter", title: "Starter project", produces: "A zip with the skeleton for the chosen template, with no copied business logic.", needs: "plan" },
  { id: "convert", title: "Converted code", produces: "Converted screens and routines, on a branch, with test results.", needs: "starter" },
  { id: "pr", title: "Pull request", produces: "The modernized application as a pull request. This is the end goal.", needs: "convert" },
];
// Stages a platform engineer can mark reviewed once their output exists. "ready" is false until the stage is built.
const PROGRESS_REVIEWABLE = ["plan", "starter", "convert"];
const PROGRESS_READY = { plan: true, starter: true, convert: false, pr: false };

function progressOf(row) {
  return row.modern_progress && typeof row.modern_progress === "object" && !Array.isArray(row.modern_progress)
    ? row.modern_progress
    : {};
}

// The state of every stage for one analysis, as the viewer sees it. Computed here so every screen agrees.
function stageStates(row, viewerId) {
  const saved = progressOf(row);
  const done = {};
  return PROGRESS_STAGES.map((stage) => {
    const prior = stage.needs ? PROGRESS_STAGES.find((s) => s.id === stage.needs) : null;
    const record = saved[stage.id] && typeof saved[stage.id] === "object" ? saved[stage.id] : null;
    const cleared = stage.id === "deeper"
      ? row.deeper_done === true
      : stage.id === "approach"
        ? Boolean(row.modern_template)
        : Boolean(record && record.reviewed_at);
    const unlocked = !prior || done[prior.id] === true;
    done[stage.id] = cleared;
    const state = cleared ? "cleared" : unlocked ? "available" : "locked";
    const acked = Array.isArray((saved.acknowledged || {})[viewerId]) && saved.acknowledged[viewerId].includes(stage.id);
    return {
      id: stage.id,
      title: stage.title,
      produces: stage.produces,
      state,
      ready: PROGRESS_READY[stage.id] === true,
      unlocked_by: prior ? prior.id : null,
      lock_reason: state === "locked" ? `Clear ${prior.title} to unlock ${stage.title}.` : null,
      cleared_by: cleared && record ? record.reviewed_by || null : null,
      cleared_at: cleared && record ? record.reviewed_at || null : null,
      celebrate: cleared && !acked,
    };
  });
}

// Saves a review or an acknowledgement. A review needs the stage unlocked, its output ready, and a platform engineer.
// Acknowledging a cleared stage is for every viewer, once for each of them.
async function setProgress(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const action = parsed.value && parsed.value.action;
  const stage = parsed.value && parsed.value.stage;
  const target = stageStates(access.row, access.user.id).find((s) => s.id === stage);
  if (!target) return json({ error: "Unknown stage." }, 400);
  const progress = { ...progressOf(access.row) };

  if (action === "acknowledge") {
    if (target.state !== "cleared") return json({ error: "Only a cleared stage can be acknowledged." }, 409);
    const acked = { ...(progress.acknowledged || {}) };
    acked[access.user.id] = [...new Set([...(acked[access.user.id] || []), stage])];
    progress.acknowledged = acked;
  } else if (action === "review") {
    if (!canStart(access.member)) return json({ error: "Only platform engineers can review a stage." }, 403);
    if (!PROGRESS_REVIEWABLE.includes(stage)) return json({ error: "This stage is cleared by its own steps." }, 400);
    if (target.state === "locked") return json({ error: target.lock_reason }, 409);
    if (target.state === "cleared") return json({ error: "This stage is already cleared." }, 409);
    if (!target.ready) return json({ error: "This stage's output is not ready yet." }, 409);
    progress[stage] = { reviewed_by: normalizeEmail(access.user.email), reviewed_at: new Date().toISOString() };
  } else {
    return json({ error: "Choose review or acknowledge." }, 400);
  }

  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ modern_progress: progress }),
  });
  if (!res.ok) return json({ error: "Could not save the progress." }, 502);
  const updated = { ...access.row, modern_progress: progress };
  return json({ saved: true, stages: stageStates(updated, access.user.id) });
}

// ---- Stage 3: convert one file to the chosen approach, with the workspace's language model ----
// A platform engineer picks one file. The conversion runs in the analysis runner (convert.yml), with a one-time model
// token, and the result comes back as a proposal. Nothing is merged here.
const CONVERT_PATH = /^[A-Za-z0-9_./-]{1,300}$/;
// The wording an admin must confirm, word for word. A change to the wording needs a new version.
const CONVERSION_APPROVAL_VERSION = 1;
const CONVERSION_APPROVAL_TEXT = "I approve one file at a time being sent to the language model I've chosen, after the personal-data check. I understand the proposed code is reviewed by me, and only I merge it.";

// The workspace's written approval, or null when there is none.
async function conversionApproval(env, workspaceId) {
  const res = await serviceRest(env, `workspaces?id=eq.${workspaceId}&select=conversion_approved_by_email,conversion_approved_at,conversion_approval_version`);
  if (!res.ok) return { failed: true };
  const [ws] = await res.json();
  if (!ws || !ws.conversion_approved_at || ws.conversion_approval_version !== CONVERSION_APPROVAL_VERSION) return { approved: false };
  return { approved: true, by: ws.conversion_approved_by_email, at: ws.conversion_approved_at };
}

// Spaces at the ends and runs of spaces, and curly apostrophes, are ignored when the wording is compared.
function sameWording(text) {
  const clean = (v) => String(v || "").replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
  return clean(text) === clean(CONVERSION_APPROVAL_TEXT);
}

// An admin gives or withdraws the workspace's approval. Approving needs the exact wording.
async function setConversionApproval(request, env, workspaceId) {
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const approve = parsed.value && parsed.value.approve;
  if (typeof approve !== "boolean") return json({ error: "Say whether you approve or withdraw." }, 400);
  if (approve && !sameWording(parsed.value.wording)) {
    return json({ error: "Type the approval exactly as it is written." }, 400);
  }
  const body = approve
    ? { conversion_approved_by_email: normalizeEmail(access.user.email), conversion_approved_at: new Date().toISOString(), conversion_approval_version: CONVERSION_APPROVAL_VERSION }
    : { conversion_approved_by_email: null, conversion_approved_at: null, conversion_approval_version: null };
  const res = await serviceRest(env, `workspaces?id=eq.${workspaceId}`, {
    method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(body),
  });
  if (!res.ok) return json({ error: "Could not save the approval." }, 502);
  return json({ saved: true, approved: approve });
}
const CONVERT_STATUSES = ["ok", "blocked", "unusable", "failed", "refused"];

function dispatchConvert(env, inputs) {
  return fetch(`https://api.github.com/repos/${env.RUNNER_REPO}/actions/workflows/convert.yml/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      "user-agent": "cutover-api",
    },
    body: JSON.stringify({ ref: "main", inputs }),
  });
}

async function startConversion(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can convert a file." }, 403);
  const row = access.row;
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const path = typeof parsed.value?.path === "string" ? parsed.value.path.trim() : "";
  if (!CONVERT_PATH.test(path) || path.split("/").includes("..")) {
    return json({ error: "Choose a file from this analysis." }, 400);
  }
  const state = stageStates(row, access.user.id).find((s) => s.id === "convert");
  if (state && state.state !== "available") return json({ error: state.lock_reason || "This stage is not open yet." }, 409);
  if (!row.modern_template) return json({ error: "Choose the approach before converting a file." }, 409);
  if (row.scope !== "modernize") return json({ error: "Choose Modernize as the next stage first." }, 409);
  if (row.source_upload === true) {
    return json({ error: "The uploaded zip is deleted when its run ends. Upload the code again to convert a file." }, 409);
  }
  if (!row.model_key_id) return json({ error: "Choose a language model for this analysis first." }, 409);
  const approval = await conversionApproval(env, row.workspace_id);
  if (approval.failed) return json({ error: "Could not check the approval. Try again in a minute." }, 502);
  if (!approval.approved) {
    return json({ error: "A workspace admin must approve converting files with the language model first." }, 409);
  }
  const known = await serviceRest(env, `file_findings?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&select=id&limit=1`);
  if (!known.ok) return json({ error: "Could not check the file." }, 502);
  if (!(await known.json()).length) return json({ error: "That file is not in this analysis." }, 400);

  const modelToken = (await issueModelToken(env, id, row.model_key_id)) || "";
  if (!modelToken) return json({ error: "Could not prepare the model. Try again in a minute." }, 502);
  await serviceRest(env, `analysis_conversions?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  const made = await serviceRest(env, "analysis_conversions", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ analysis_id: id, path, template: row.modern_template, status: "queued", requested_by_email: normalizeEmail(access.user.email) }),
  });
  if (!made.ok) return json({ error: "Could not start the conversion." }, 502);
  const dispatch = await dispatchConvert(env, {
    analysis_id: id, repo: row.repo, ref: row.ref || "", path, template: row.modern_template, model_token: modelToken,
  });
  if (!dispatch.ok) {
    await serviceRest(env, `analysis_conversions?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}`, {
      method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ status: "failed", reason: "The runner could not be started." }),
    });
    return json({ error: "The runner could not be started. Try again in a minute." }, 502);
  }
  return json({ queued: true, path }, 202);
}

// A platform engineer accepts or rejects a proposal. Only a proposal that was kept (status ok) can be decided.
async function decideConversion(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can accept or reject a proposal." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const path = typeof parsed.value?.path === "string" ? parsed.value.path : "";
  const decision = parsed.value?.decision;
  if (!CONVERT_PATH.test(path)) return json({ error: "Choose a file." }, 400);
  if (decision !== "accepted" && decision !== "rejected") return json({ error: "Choose accepted or rejected." }, 400);
  const found = await serviceRest(env, `analysis_conversions?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&select=id,status`);
  if (!found.ok) return json({ error: "Could not load the proposal." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  if (item.status !== "ok") return json({ error: "Only a kept proposal can be accepted or rejected." }, 409);
  const res = await serviceRest(env, `analysis_conversions?id=eq.${item.id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ decision, decided_by_email: normalizeEmail(access.user.email), decided_at: new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "Could not save the decision." }, 502);
  return json({ saved: true, decision });
}

// The runner posts one result per file. Shared secret only; the result is kept as a proposal for review.
async function runnerConversion(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const found = await serviceRest(env, `analyses?id=eq.${id}&select=id`);
  if (!found.ok) return json({ error: "Could not load the analysis." }, 502);
  const [analysis] = await found.json();
  if (!analysis) return json({ error: "Not found." }, 404);
  const parsed = await readJson(request, 100_000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const path = typeof body.path === "string" ? body.path : "";
  if (!CONVERT_PATH.test(path)) return json({ error: "Bad path." }, 400);
  if (!CONVERT_STATUSES.includes(body.status)) return json({ error: "Bad status." }, 400);
  if (body.proposed != null && (typeof body.proposed !== "string" || body.proposed.length > 60000)) {
    return json({ error: "The proposal is too large." }, 400);
  }
  if (body.status === "ok" && typeof body.proposed !== "string") return json({ error: "An ok result needs a proposal." }, 400);
  const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k) => typeof k === "string").slice(0, 5).map((k) => k.slice(0, 40)) : [];
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : null;
  const stage = body.stage === "request" || body.stage === "reply" ? body.stage : null;
  await serviceRest(env, `analysis_conversions?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  const made = await serviceRest(env, "analysis_conversions", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      analysis_id: id, path, template: body.template, status: body.status,
      proposed: body.status === "ok" ? body.proposed : null, reason, kinds, stage,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!made.ok) return json({ error: "Could not save the result." }, 502);
  return json({ saved: true }, 201);
}

async function updateContingency(request, env, id) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const found = await serviceRest(env, `contingencies?id=eq.${id}&select=id,analysis_id,status,risk`);
  if (!found.ok) return json({ error: "Could not load the contingency." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  const access = await analysisAccessAs(env, auth, item.analysis_id);
  if (access.response) return access.response;
  if (!canStart(access.member)) {
    return json({ error: "Only platform engineers can change contingencies." }, 403);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const checked = contingencyFields(parsed.value, true);
  if (checked.error) return json({ error: checked.error }, 400);
  const change = { ...checked.fields, updated_by_email: auth.user.email, updated_at: new Date().toISOString() };
  // Editing the text of a proposal marks it as edited, unless the caller sets a status itself.
  const edited = CONTINGENCY_CONTENT.some((key) => key in checked.fields);
  if (edited && !("status" in change) && item.status === "proposed") change.status = "edited";
  const res = await serviceRest(env, `contingencies?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(change),
  });
  if (!res.ok) return json({ error: "Could not update the contingency." }, 502);
  if ((change.status === "accepted" || change.status === "rejected") && change.status !== item.status) {
    const accepted = change.status === "accepted";
    await notifyPeople(env, access.row.workspace_id, await analysisAudienceExcept(env, access.row, auth.user.id), {
      kind: accepted ? "plan_accepted" : "plan_rejected",
      tone: accepted ? "success" : "warning",
      title: `${accepted ? "Plan accepted" : "Plan left out"}: ${access.row.app_name || access.row.repo}`,
      body: String(item.risk || "").slice(0, 140), analysis_id: item.analysis_id,
    });
  }
  return json({ updated: true });
}

async function deleteContingency(request, env, id) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const found = await serviceRest(env, `contingencies?id=eq.${id}&select=id,analysis_id`);
  if (!found.ok) return json({ error: "Could not load the contingency." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  const access = await analysisAccessAs(env, auth, item.analysis_id);
  if (access.response) return access.response;
  if (!canStart(access.member)) {
    return json({ error: "Only platform engineers can remove contingencies." }, 403);
  }
  const del = await serviceRest(env, `contingencies?id=eq.${id}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (!del.ok) return json({ error: "Could not delete the contingency." }, 502);
  return json({ deleted: true });
}

// File-level results arrive in chunks, so each request stays small enough for the free-tier CPU budget.
const FILE_CHUNK_MAX_BYTES = 1_000_000;
const FILE_CHUNK_MAX_FILES = 200;
const FREE_TIER_ANALYSIS_BYTES = 25 * 1024 * 1024;

function suggestionsOk(value) {
  return Array.isArray(value) && value.length <= 20 && JSON.stringify(value).length <= 4000;
}

// File-level review. Only platform engineers see file-level results, for now.
const FILE_PAGE_MAX = 200;
const FILE_COLUMNS = "id,path,category,purpose,purpose_source,suggestions,review_status,reviewed_by_email,reviewed_at";

async function listFiles(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can review file-level results." }, 403);
  const url = new URL(request.url);
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset") || 0)) || 0);
  const limit = Math.min(FILE_PAGE_MAX, Math.max(1, Math.floor(Number(url.searchParams.get("limit") || FILE_PAGE_MAX)) || FILE_PAGE_MAX));
  const res = await serviceRest(env, `file_findings?analysis_id=eq.${id}&select=${FILE_COLUMNS}&order=path.asc&limit=${limit}&offset=${offset}`);
  if (!res.ok) return json({ error: "Could not load the file results." }, 502);
  return json({ files: await res.json(), offset, limit });
}

async function editFile(request, env, id) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const found = await serviceRest(env, `file_findings?id=eq.${id}&select=id,analysis_id`);
  if (!found.ok) return json({ error: "Could not load the file result." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  const access = await analysisAccessAs(env, auth, item.analysis_id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can review file-level results." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  if (body.review_status !== "approved" && body.review_status !== "edited") {
    return json({ error: "review_status must be approved or edited." }, 400);
  }
  const change = {};
  if (body.purpose !== undefined) {
    if (body.purpose !== null && (typeof body.purpose !== "string" || body.purpose.length > 2000)) {
      return json({ error: "purpose must be text of up to 2000 characters." }, 400);
    }
    change.purpose = body.purpose;
  }
  if (body.suggestions !== undefined) {
    if (!suggestionsOk(body.suggestions)) return json({ error: "suggestions must be a list of up to 20 short items." }, 400);
    change.suggestions = body.suggestions;
  }
  if (body.review_status === "edited" && Object.keys(change).length === 0) {
    return json({ error: "Send the edited purpose or suggestions." }, 400);
  }
  const res = await serviceRest(env, `file_findings?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ ...change, review_status: body.review_status, reviewed_by_email: auth.user.email, reviewed_at: new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "Could not save the review." }, 502);
  return json({ updated: true });
}

async function approveAllFiles(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can approve file-level results." }, 403);
  const res = await serviceRest(env, `file_findings?analysis_id=eq.${id}&review_status=eq.draft`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ review_status: "approved", reviewed_by_email: access.user.email, reviewed_at: new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "Could not approve the file results." }, 502);
  await notifyPeople(env, access.row.workspace_id, await analysisAudienceExcept(env, access.row, access.user.id), {
    kind: "purposes_approved", tone: "success", title: `File purposes approved: ${access.row.app_name || access.row.repo}`,
    body: "The file-level results are approved and will go into the report.", analysis_id: id,
  });
  return json({ approved: true });
}

// Checks one file record. Only the fields we store are kept.
function fileRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Each file must be an object." };
  const path = typeof value.path === "string" ? value.path.trim() : "";
  if (!path || path.length > 512) return { error: "Each file needs a path of up to 512 characters." };
  const category = typeof value.category === "string" ? value.category.trim() : "";
  if (!category || category.length > 60) return { error: "Each file needs a category of up to 60 characters." };
  if (value.purpose !== undefined && value.purpose !== null && (typeof value.purpose !== "string" || value.purpose.length > 2000)) {
    return { error: "purpose must be text of up to 2000 characters." };
  }
  const suggestions = value.suggestions === undefined || value.suggestions === null ? [] : value.suggestions;
  if (!suggestionsOk(suggestions)) {
    return { error: "suggestions must be a list of up to 20 short items." };
  }
  const purposeSource = value.purpose_source === undefined || value.purpose_source === null ? "rules" : value.purpose_source;
  if (purposeSource !== "rules" && purposeSource !== "model") {
    return { error: "purpose_source must be rules or model." };
  }
  return {
    row: {
      path,
      category,
      purpose: typeof value.purpose === "string" ? value.purpose : null,
      suggestions,
      sample_only: value.sample_only !== false,
      purpose_source: purposeSource,
    },
  };
}

// Saves one chunk of file-level results. A chunk is refused if the analysis is finished, or if the
// running total would pass the free-tier cap. Going over the cap fails the analysis and removes its file rows.
async function runnerFiles(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const found = await serviceRest(env, `analyses?id=eq.${id}&select=id,status,file_bytes`);
  if (!found.ok) return json({ error: "Could not load the analysis." }, 502);
  const [analysis] = await found.json();
  if (!analysis) return json({ error: "Not found." }, 404);
  if (analysis.status !== "queued" && analysis.status !== "running") {
    return json({ error: "This analysis is no longer taking results." }, 409);
  }
  const parsed = await readJson(request, FILE_CHUNK_MAX_BYTES);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const files = parsed.value?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > FILE_CHUNK_MAX_FILES) {
    return json({ error: `A chunk holds 1 to ${FILE_CHUNK_MAX_FILES} files.` }, 400);
  }
  const rows = [];
  const paths = new Set();
  for (const value of files) {
    const checked = fileRecord(value);
    if (checked.error) return json({ error: checked.error }, 400);
    if (paths.has(checked.row.path)) return json({ error: `The path ${checked.row.path} appears twice in this chunk.` }, 400);
    paths.add(checked.row.path);
    rows.push(checked.row);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(rows)).length;
  const total = Number(analysis.file_bytes || 0) + bytes;
  if (total > FREE_TIER_ANALYSIS_BYTES) {
    await serviceRest(env, `file_findings?analysis_id=eq.${id}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    await serviceRest(env, `analyses?id=eq.${id}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        status: "failed",
        error: "These results are over the 25 MB limit for an analysis on the free tier. Analyze a smaller part of the repository.",
        file_bytes: 0,
        finished_at: new Date().toISOString(),
      }),
    });
    return json({ error: "This analysis is over the free-tier limit, so it was stopped." }, 413);
  }
  const res = await serviceRest(env, "file_findings", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(rows.map((row) => ({ ...row, analysis_id: id }))),
  });
  if (!res.ok) return json({ error: "Could not save these file results. A path may already be saved." }, 502);
  const update = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ status: "running", file_bytes: total }),
  });
  if (!update.ok) return json({ error: "Could not update the analysis." }, 502);
  return json({ saved: rows.length, total_bytes: total }, 201);
}

async function runnerResult(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  if (body.status !== "complete" && body.status !== "failed") {
    return json({ error: "status must be complete or failed." }, 400);
  }
  const update = {
    status: body.status,
    commit_sha: typeof body.commit_sha === "string" ? body.commit_sha.slice(0, 64) : null,
    findings: body.status === "complete" ? body.findings || null : null,
    error: body.status === "failed" ? String(body.error || "Analysis failed.").slice(0, 500) : null,
    finished_at: new Date().toISOString(),
    // The deeper assessment is done once the run has sent its documents.
    deeper_done: body.status === "complete" && Boolean(body.findings && body.findings.deeper),
  };
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!res.ok) return json({ error: "Could not save the result." }, 502);
  const [saved] = await res.json().catch(() => []);
  if (saved) {
    await notifyPeople(env, saved.workspace_id, [saved.owner_id], body.status === "complete"
      ? { kind: "analysis_complete", tone: "success", title: `Analysis complete: ${saved.app_name}`, body: "The findings are ready for review.", analysis_id: id }
      : { kind: "analysis_failed", tone: "danger", title: `Analysis failed: ${saved.app_name}`, body: update.error || "The run did not finish.", analysis_id: id });
    if (update.deeper_done) {
      await notifyPeople(env, saved.workspace_id, [saved.owner_id], {
        kind: "deeper_ready", tone: "success", title: `Deeper assessment ready: ${saved.app_name}`,
        body: "The business, systems, data and workflow documents are ready. Modernize and Migrate can now be chosen.", analysis_id: id,
      });
    }
  }
  return json({ saved: true });
}

// Write one deletion record per analysis. Returns false if the records could not be saved.
async function recordDeletion(env, rows, reason) {
  if (rows.length === 0) return true;
  const res = await serviceRest(env, "deletion_log", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(rows.map((r) => ({ analysis_id: r.id, repo: r.repo, reason }))),
  });
  return res.ok;
}

// Retention: find expired analyses, record the deletion, then delete them.
// Nothing is deleted unless its deletion record was saved first.
async function purgeExpired(env) {
  const now = new Date().toISOString();
  const found = await serviceRest(env, `analyses?expires_at=lt.${encodeURIComponent(now)}&select=id,repo`);
  if (!found.ok) throw new Error(`Retention lookup failed with status ${found.status}`);
  const rows = await found.json();
  if (rows.length === 0) return;
  if (!(await recordDeletion(env, rows, "expired"))) {
    throw new Error("Retention could not save the deletion records, so nothing was deleted.");
  }
  const ids = rows.map((r) => r.id).join(",");
  const res = await serviceRest(env, `analyses?id=in.(${ids})`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error(`Retention purge failed with status ${res.status}`);
}


// ---- Repository check (GitHub App, read-only) ----
// The app is "cutover-reader-portal". It has read-only access to the repositories it is installed on.
const APP_SLUG = "cutover-reader-portal";
const GH_HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "cutover-api" };

function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToDer(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function derWrap(tag, content) {
  const n = content.length;
  let len;
  if (n < 0x80) len = [n];
  else {
    const bytes = [];
    for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
    len = [0x80 | bytes.length, ...bytes];
  }
  return concatBytes(Uint8Array.from([tag, ...len]), content);
}

// GitHub issues keys in PKCS#1 form. WebCrypto needs PKCS#8, so wrap the key.
function pkcs1ToPkcs8(der) {
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  const rsaAlgorithm = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  return derWrap(0x30, concatBytes(version, rsaAlgorithm, derWrap(0x04, der)));
}

async function importAppKey(env) {
  const pem = String(env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  let der = pemToDer(pem);
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) der = pkcs1ToPkcs8(der);
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

// A short-lived token that proves the request comes from the app.
async function githubAppJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(enc.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(env.GITHUB_APP_ID) })));
  const key = await importAppKey(env);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${base64url(sig)}`;
}

// Exchanges the app token for a read-only token for one repository's installation.
async function readToken(env, repo) {
  const jwt = await githubAppJwt(env);
  const auth = { ...GH_HEADERS, authorization: `Bearer ${jwt}` };
  const inst = await fetch(`https://api.github.com/repos/${repo}/installation`, { headers: auth });
  if (inst.status === 404) return { notInstalled: true };
  if (!inst.ok) return { failed: true };
  const { id } = await inst.json();
  const tok = await fetch(`https://api.github.com/app/installations/${id}/access_tokens`, { method: "POST", headers: auth });
  if (!tok.ok) return { failed: true };
  const { token } = await tok.json();
  return { token };
}

async function repoCheck(request, env) {
  const url = new URL(request.url);
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const access = await workspaceAccessAs(env, auth, url.searchParams.get("workspace") || "");
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can connect code." }, 403);

  const repo = url.searchParams.get("repo") || "";
  const ref = url.searchParams.get("ref") || "";
  if (!REPO_PATTERN.test(repo)) return json({ error: "Use the form owner/name." }, 400);
  if (ref && !REF_PATTERN.test(ref)) return json({ error: "The branch, tag or commit name is not valid." }, 400);

  const readable = await readToken(env, repo);
  if (readable.notInstalled) {
    return json({
      ok: false,
      reason: "not_readable",
      message: "Cutover cannot read this repository yet. Check the name, or install the Cutover reader on it, then check again.",
      install_url: `https://github.com/apps/${APP_SLUG}/installations/new`,
    });
  }
  if (readable.failed) return json({ ok: false, reason: "failed", message: "Cutover could not check the repository right now. Try again in a minute." });

  const h = { ...GH_HEADERS, authorization: `Bearer ${readable.token}` };
  const meta = await fetch(`https://api.github.com/repos/${repo}`, { headers: h });
  if (!meta.ok) return json({ ok: false, reason: "not_found", message: "We could not read that repository. Check the name, or install the Cutover reader on it." });
  const info = await meta.json();
  const branch = ref || info.default_branch;

  const tree = await fetch(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers: h });
  if (!tree.ok) return json({ ok: false, reason: "branch", message: `We could not find the branch, tag or commit "${branch}".` });
  const t = await tree.json();
  const files = (t.tree || []).filter((e) => e.type === "blob").length;

  const commits = await fetch(`https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`, { headers: h });
  const [latest] = commits.ok ? await commits.json() : [];
  return json({
    ok: true,
    repo,
    branch,
    files,
    truncated: Boolean(t.truncated),
    last_changed: latest?.commit?.committer?.date || null,
  });
}

// Browsers only let the app call the API from an allowed address.
// Local testing uses localhost; the live app address is set in wrangler.toml as APP_ORIGIN.
const DEV_ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000"];

function allowedOrigin(origin, env) {
  const list = [...DEV_ORIGINS, ...(env.APP_ORIGIN ? [env.APP_ORIGIN] : [])];
  return list.includes(origin) ? origin : null;
}

function withCors(res, origin) {
  if (!origin) return res;
  const headers = new Headers(res.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", "Origin");
  return new Response(res.body, { status: res.status, headers });
}

async function route(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method;

    if (path === "/api/me" && method === "GET") return me(request, env);
    if (path === "/api/workspaces" && method === "POST") return createWorkspace(request, env);
    if (path === "/api/repo-check" && method === "GET") return repoCheck(request, env);
    if (path === "/api/admin/workspaces" && method === "GET") return overviewWorkspaces(request, env);
    if (path === "/api/admin/database" && method === "GET") return databaseSize(request, env);

    const oneWorkspace = path.match(/^\/api\/workspaces\/([^/]+)$/);
    if (oneWorkspace && method === "PATCH") return renameWorkspace(request, env, oneWorkspace[1]);
    if (oneWorkspace && method === "DELETE") return deleteWorkspace(request, env, oneWorkspace[1]);

    if (path === "/api/analyses" && method === "POST") return startAnalysis(request, env);
    if (path === "/api/analyses/upload" && method === "POST") return startUpload(request, env);
    if (path === "/api/analyses" && method === "GET") return listAnalyses(request, env);

    const one = path.match(/^\/api\/analyses\/([^/]+)$/);
    if (one && UUID_PATTERN.test(one[1]) && method === "GET") return getAnalysis(request, env, one[1]);
    if (one && UUID_PATTERN.test(one[1]) && method === "DELETE") return deleteAnalysis(request, env, one[1]);

    const comments = path.match(/^\/api\/analyses\/([^/]+)\/comments$/);
    if (comments && UUID_PATTERN.test(comments[1]) && method === "POST") return addComment(request, env, comments[1]);

    const actions = path.match(/^\/api\/analyses\/([^/]+)\/actions$/);
    if (actions && UUID_PATTERN.test(actions[1]) && method === "POST") return addAction(request, env, actions[1]);

    const oneComment = path.match(/^\/api\/comments\/([^/]+)$/);
    if (oneComment && UUID_PATTERN.test(oneComment[1]) && method === "DELETE") return deleteComment(request, env, oneComment[1]);

    const oneAction = path.match(/^\/api\/actions\/([^/]+)$/);
    if (oneAction && UUID_PATTERN.test(oneAction[1]) && method === "PATCH") return updateAction(request, env, oneAction[1]);

    const analysisTerraform = path.match(/^\/api\/analyses\/([^/]+)\/terraform$/);
    if (analysisTerraform && UUID_PATTERN.test(analysisTerraform[1]) && method === "GET") return listTerraform(request, env, analysisTerraform[1]);
    if (analysisTerraform && UUID_PATTERN.test(analysisTerraform[1]) && method === "POST") return draftTerraform(request, env, analysisTerraform[1]);
    const analysisCostUsers = path.match(/^\/api\/analyses\/([^/]+)\/cost-users$/);
    if (analysisCostUsers && UUID_PATTERN.test(analysisCostUsers[1]) && method === "PUT") return setCostUsers(request, env, analysisCostUsers[1]);
    const analysisCloud = path.match(/^\/api\/analyses\/([^/]+)\/cloud$/);
    if (analysisCloud && UUID_PATTERN.test(analysisCloud[1]) && method === "PATCH") return setCloud(request, env, analysisCloud[1]);
    const analysisIntake = path.match(/^\/api\/analyses\/([^/]+)\/intake$/);
    if (analysisIntake && UUID_PATTERN.test(analysisIntake[1]) && method === "PUT") return saveIntake(request, env, analysisIntake[1]);
    const analysisIntakeConfirm = path.match(/^\/api\/analyses\/([^/]+)\/intake\/confirm$/);
    if (analysisIntakeConfirm && UUID_PATTERN.test(analysisIntakeConfirm[1]) && method === "POST") return confirmIntake(request, env, analysisIntakeConfirm[1]);
    const analysisRerun = path.match(/^\/api\/analyses\/([^/]+)\/rerun$/);
    if (analysisRerun && UUID_PATTERN.test(analysisRerun[1]) && method === "POST") return rerunAnalysis(request, env, analysisRerun[1]);
    const analysisDbMetadata = path.match(/^\/api\/analyses\/([^/]+)\/db-metadata$/);
    if (analysisDbMetadata && UUID_PATTERN.test(analysisDbMetadata[1])) {
      if (method === "GET") return getDbMetadataSummary(request, env, analysisDbMetadata[1]);
      if (method === "PUT") return saveDbMetadata(request, env, analysisDbMetadata[1]);
      if (method === "DELETE") return deleteDbMetadata(request, env, analysisDbMetadata[1]);
    }
    const analysisScope = path.match(/^\/api\/analyses\/([^/]+)\/scope$/);
    if (analysisScope && UUID_PATTERN.test(analysisScope[1]) && method === "PATCH") return setScope(request, env, analysisScope[1]);
    const analysisTarget = path.match(/^\/api\/analyses\/([^/]+)\/target$/);
    if (analysisTarget && UUID_PATTERN.test(analysisTarget[1]) && method === "PUT") return setTarget(request, env, analysisTarget[1]);
    const analysisTargetApprove = path.match(/^\/api\/analyses\/([^/]+)\/target\/approve$/);
    if (analysisTargetApprove && UUID_PATTERN.test(analysisTargetApprove[1]) && method === "POST") return approveTarget(request, env, analysisTargetApprove[1]);
    const analysisTemplate = path.match(/^\/api\/analyses\/([^/]+)\/template$/);
    if (analysisTemplate && UUID_PATTERN.test(analysisTemplate[1]) && method === "PUT") return setTemplate(request, env, analysisTemplate[1]);
    const workspaceApproval = path.match(/^\/api\/workspaces\/([^/]+)\/conversion-approval$/);
    if (workspaceApproval && UUID_PATTERN.test(workspaceApproval[1]) && method === "PUT") return setConversionApproval(request, env, workspaceApproval[1]);
    const analysisConversions = path.match(/^\/api\/analyses\/([^/]+)\/conversions$/);
    if (analysisConversions && UUID_PATTERN.test(analysisConversions[1]) && method === "POST") return startConversion(request, env, analysisConversions[1]);
    const analysisDecision = path.match(/^\/api\/analyses\/([^/]+)\/conversions\/decision$/);
    if (analysisDecision && UUID_PATTERN.test(analysisDecision[1]) && method === "POST") return decideConversion(request, env, analysisDecision[1]);
    const runnerConversionRoute = path.match(/^\/api\/runner\/([^/]+)\/conversion$/);
    if (runnerConversionRoute && UUID_PATTERN.test(runnerConversionRoute[1]) && method === "POST") return runnerConversion(request, env, runnerConversionRoute[1]);
    const analysisProgress = path.match(/^\/api\/analyses\/([^/]+)\/progress$/);
    if (analysisProgress && UUID_PATTERN.test(analysisProgress[1]) && method === "PUT") return setProgress(request, env, analysisProgress[1]);

    const contingencyAdd = path.match(/^\/api\/analyses\/([^/]+)\/contingencies$/);
    if (contingencyAdd && UUID_PATTERN.test(contingencyAdd[1]) && method === "POST") return addContingency(request, env, contingencyAdd[1]);

    const oneContingency = path.match(/^\/api\/contingencies\/([^/]+)$/);
    if (oneContingency && UUID_PATTERN.test(oneContingency[1]) && method === "PATCH") return updateContingency(request, env, oneContingency[1]);
    if (oneContingency && UUID_PATTERN.test(oneContingency[1]) && method === "DELETE") return deleteContingency(request, env, oneContingency[1]);

    if (path === "/api/notifications" && method === "GET") return listNotifications(request, env);
    if (path === "/api/notifications/read" && method === "POST") return markNotificationsRead(request, env);

    const privacy = path.match(/^\/api\/workspaces\/([^/]+)\/privacy(?:\/(signoff|withdraw))?$/);
    if (privacy && UUID_PATTERN.test(privacy[1])) {
      const [, workspaceId, step] = privacy;
      if (!step && method === "GET") return privacyStatus(request, env, workspaceId);
      if (step === "signoff" && method === "POST") return privacySignOff(request, env, workspaceId);
      if (step === "withdraw" && method === "POST") return privacyWithdraw(request, env, workspaceId);
    }

    const modelScreens = path.match(/^\/api\/workspaces\/([^/]+)\/model-screens$/);
    if (modelScreens && UUID_PATTERN.test(modelScreens[1]) && method === "PUT") return setModelScreens(request, env, modelScreens[1]);

    const modelKeys = path.match(/^\/api\/workspaces\/([^/]+)\/model-keys(?:\/([^/]+))?$/);
    if (modelKeys && UUID_PATTERN.test(modelKeys[1])) {
      const [, workspaceId, keyId] = modelKeys;
      if (!keyId && method === "GET") return listModelKeys(request, env, workspaceId);
      if (!keyId && method === "POST") return addModelKey(request, env, workspaceId);
      if (keyId && UUID_PATTERN.test(keyId) && method === "DELETE") return removeModelKey(request, env, workspaceId, keyId);
    }

    const ws = path.match(/^\/api\/workspaces\/([^/]+)\/(members|invitations)(?:\/(.+))?$/);
    if (ws && UUID_PATTERN.test(ws[1])) {
      const [, workspaceId, kind, child] = ws;
      if (kind === "members" && !child && method === "GET") return listMembers(request, env, workspaceId);
      if (kind === "members" && child && method === "DELETE") return removeMember(request, env, workspaceId, decodeURIComponent(child));
      if (kind === "invitations" && !child && method === "GET") return listInvitations(request, env, workspaceId);
      if (kind === "invitations" && !child && method === "POST") return createInvitation(request, env, workspaceId);
      if (kind === "invitations" && child && method === "DELETE") return deleteInvitation(request, env, workspaceId, decodeURIComponent(child));
    }

    const fileList = path.match(/^\/api\/analyses\/([^/]+)\/files$/);
    if (fileList && UUID_PATTERN.test(fileList[1]) && method === "GET") return listFiles(request, env, fileList[1]);

    const fileApprove = path.match(/^\/api\/analyses\/([^/]+)\/files\/approve-all$/);
    if (fileApprove && UUID_PATTERN.test(fileApprove[1]) && method === "POST") return approveAllFiles(request, env, fileApprove[1]);

    const oneFile = path.match(/^\/api\/file-findings\/([^/]+)$/);
    if (oneFile && UUID_PATTERN.test(oneFile[1]) && method === "PATCH") return editFile(request, env, oneFile[1]);

    const fileChunk = path.match(/^\/api\/runner\/([^/]+)\/files$/);
    if (fileChunk && UUID_PATTERN.test(fileChunk[1]) && method === "POST") {
      return runnerFiles(request, env, fileChunk[1]);
    }

    const modelKey = path.match(/^\/api\/runner\/([^/]+)\/model-key$/);
    if (modelKey && UUID_PATTERN.test(modelKey[1]) && method === "POST") {
      return runnerModelKey(request, env, modelKey[1]);
    }

    const dbMetadataRead = path.match(/^\/api\/runner\/([^/]+)\/db-metadata$/);
    if (dbMetadataRead && UUID_PATTERN.test(dbMetadataRead[1]) && method === "GET") {
      return runnerDbMetadata(request, env, dbMetadataRead[1]);
    }

    const sourceRead = path.match(/^\/api\/runner\/([^/]+)\/source$/);
    if (sourceRead && UUID_PATTERN.test(sourceRead[1]) && method === "GET") return runnerSource(request, env, sourceRead[1]);
    if (sourceRead && UUID_PATTERN.test(sourceRead[1]) && method === "DELETE") return runnerDeleteSource(request, env, sourceRead[1]);

    const screensUpload = path.match(/^\/api\/runner\/([^/]+)\/screens$/);
    if (screensUpload && UUID_PATTERN.test(screensUpload[1]) && method === "POST") {
      return runnerScreens(request, env, screensUpload[1]);
    }

    const callback = path.match(/^\/api\/runner\/([^/]+)\/result$/);
    if (callback && UUID_PATTERN.test(callback[1]) && method === "POST") {
      return runnerResult(request, env, callback[1]);
    }

    return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request.headers.get("origin") || "", env);
    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "600",
          vary: "Origin",
        },
      });
    }
    return withCors(await route(request, env), origin);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(purgeExpired(env));
  },
};
