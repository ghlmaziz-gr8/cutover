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
//   GET    /api/analyses/:id                              one analysis, limited to what your role may see
//   DELETE /api/analyses/:id                              delete (the person who started it, or a workspace admin)
//   POST   /api/analyses/:id/comments                     add a comment (members)
//   DELETE /api/comments/:id                              delete a comment (its author, or a workspace admin)
//   POST   /api/analyses/:id/actions                      add an action item (not auditors)
//   PATCH  /api/actions/:id                               open or close an action item (not auditors)
//   POST   /api/analyses/:id/contingencies                add a contingency plan (platform engineers)
//   PATCH  /api/contingencies/:id                         edit or set the status of a contingency (platform engineers)
//   DELETE /api/contingencies/:id                         remove a contingency (platform engineers)
//   POST   /api/runner/:id/result                         runner callback with findings (shared secret)
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
  security_officer: ["security", "privacy"],
  informatics_lead: ["data", "epic"],
  cio_cto: ["stack", "ui_portal", "containers", "delivery", "infrastructure"],
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
    findings: shown,
    flags,
    counts: { total: Object.keys(all).length, shown: Object.keys(shown).length },
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

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: "Request body is too large." };
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
    `analyses?workspace_id=eq.${access.workspace_id}&select=id,owner_id,repo,ref,app_name,status,commit_sha,created_at,finished_at,expires_at&order=created_at.desc&limit=100`);
  if (!res.ok) return json({ error: "Could not load analyses." }, 502);
  const rows = await res.json();
  // The owner id is not sent. is_mine says whether the analysis is yours.
  return json(rows.map(({ owner_id, ...rest }) => ({ ...rest, is_mine: owner_id === access.user.id })));
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
    }),
  });
  if (!created.ok) return json({ error: "Could not create the analysis." }, 502);
  const [row] = await created.json();

  // Start the runner. If this fails, mark the row failed so it is not stuck in "queued".
  const dispatch = await fetch(
    `https://api.github.com/repos/${env.RUNNER_REPO}/actions/workflows/analyze.yml/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        "user-agent": "cutover-api",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { analysis_id: row.id, repo, ref: ref || "" },
      }),
    },
  );
  if (!dispatch.ok) {
    await serviceRest(env, `analyses?id=eq.${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", error: "Could not start the analysis runner.", finished_at: new Date().toISOString() }),
    });
    return json({ error: "Could not start the analysis runner." }, 502);
  }

  return json({ id: row.id, status: row.status }, 202);
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
  return json({
    ...analysis,
    findings: visibleReport(findings, member.role),
    is_mine: owner_id === user.id,
    can_delete: owner_id === user.id || isAdmin,
    viewer_role: member.role,
    viewer_is_admin: isAdmin,
    can_work_items: canWorkItems(member),
    can_plan: canStart(member),
    comments,
    action_items: await actionsRes.json(),
    contingencies: await contingenciesRes.json(),
  });
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

async function updateContingency(request, env, id) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const found = await serviceRest(env, `contingencies?id=eq.${id}&select=id,analysis_id,status`);
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
  };
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(update),
  });
  if (!res.ok) return json({ error: "Could not save the result." }, 502);
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

    const contingencyAdd = path.match(/^\/api\/analyses\/([^/]+)\/contingencies$/);
    if (contingencyAdd && UUID_PATTERN.test(contingencyAdd[1]) && method === "POST") return addContingency(request, env, contingencyAdd[1]);

    const oneContingency = path.match(/^\/api\/contingencies\/([^/]+)$/);
    if (oneContingency && UUID_PATTERN.test(oneContingency[1]) && method === "PATCH") return updateContingency(request, env, oneContingency[1]);
    if (oneContingency && UUID_PATTERN.test(oneContingency[1]) && method === "DELETE") return deleteContingency(request, env, oneContingency[1]);

    const ws = path.match(/^\/api\/workspaces\/([^/]+)\/(members|invitations)(?:\/(.+))?$/);
    if (ws && UUID_PATTERN.test(ws[1])) {
      const [, workspaceId, kind, child] = ws;
      if (kind === "members" && !child && method === "GET") return listMembers(request, env, workspaceId);
      if (kind === "members" && child && method === "DELETE") return removeMember(request, env, workspaceId, decodeURIComponent(child));
      if (kind === "invitations" && !child && method === "GET") return listInvitations(request, env, workspaceId);
      if (kind === "invitations" && !child && method === "POST") return createInvitation(request, env, workspaceId);
      if (kind === "invitations" && child && method === "DELETE") return deleteInvitation(request, env, workspaceId, decodeURIComponent(child));
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
          "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
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
