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
//   POST   /api/me/time                                   seconds spent on one screen (signed-in person)
//   GET    /api/me/engagement                             your time, points, level, badges and favourite screen
//   POST   /api/workspaces                                create a customer workspace and invite its first admin (Cutover operators)
//   PATCH  /api/workspaces/:id                             rename a workspace (operators)
//   DELETE /api/workspaces/:id                             delete a workspace and its analyses (operators; type the name to confirm)
//   GET    /api/staff/invitations                          invitation tracker across workspaces (super users, admins, sales, support)
//   GET    /api/staff                                      staff people and their platform roles (anyone who may invite)
//   POST   /api/staff                                      add a person or change their roles (super users; admins and sales for demo roles)
//   DELETE /api/staff/:email                               remove a staff person (super users)
//   GET    /api/admin/workspaces                           every workspace with counts; people shown only where the operator is a member (operators)
//   GET    /api/workspaces/:id/members                    list members (workspace admins)
//   DELETE /api/workspaces/:id/members/:userId            remove a member (workspace admins)
//   GET    /api/workspaces/:id/invitations                list pending invitations (workspace admins)
//   POST   /api/workspaces/:id/invitations                invite an email with a role (workspace admins)
//   DELETE /api/workspaces/:id/invitations/:email         remove a pending invitation (workspace admins)
//   GET    /api/repo-check?workspace=&repo=&ref=          check Cutover can read a repository (platform engineers)
//   POST   /api/clicks                                     anonymous click positions from the portal (signed-in members)
//   GET    /api/workspaces/:id/heatmap?screen=s-files&days=30  click heat map of one screen (workspace admins)
//   GET    /api/workspaces/:id/cleanup/superseded         how many superseded business assessments the workspace holds (platform engineers)
//   POST   /api/workspaces/:id/cleanup/superseded         remove them, when the count matches the preview (platform engineers)
//   GET    /api/admin/database                            database size against the free-tier limit (operators)
//   GET    /api/analyses?workspace=                       analyses in one workspace (members)
//   GET    /api/insights?workspace=                       counts of what the workspace has done with Cutover (members; no code or names)
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
//   GET    /api/analyses/:id/business?path=               business assessments of one file (every role)
//   GET    /api/analyses/:id/deep-files?path=...           deep file assessments of one file (every role)
//   GET    /api/analyses/:id/features                      the approved features with their stories and cited rules (read-only, every role)
//   GET    /api/analyses/:id/deep-files/links              function names each file defines and calls (every role)
//   POST   /api/analyses/:id/deep-files/approve             approve a draft; replaces the earlier approved account
//   POST   /api/analyses/:id/deep-files/discard             discard a draft (platform engineers)
//   POST   /api/analyses/:id/deep-files/start           start a deep file assessment of one file (platform engineers)
//   POST   /api/runner/:id/deep-file                       one deep file assessment (shared secret)
//   POST   /api/analyses/:id/business/start               start a business assessment of one file (platform engineers)
//   POST   /api/analyses/:id/business/approve             approve a draft; the earlier approved one is superseded (platform engineers)
//   POST   /api/analyses/:id/business/discard             discard a draft (platform engineers)
//   POST   /api/analyses/:id/business/skip                skip a failed business view for now, with its reason (platform engineers)
//   DELETE /api/analyses/:id/screens/:screenId                remove one drawn screen (platform engineers)
//   GET    /api/analyses/:id/business-summary             how many approved files have an approved business view, and the skipped ones (every role)
//   POST   /api/runner/:id/business                       one draft business assessment (shared secret)
//   PATCH  /api/file-findings/:id                         approve or edit one file's purpose and suggestions (platform engineers)
//   POST   /api/runner/:id/files                          one chunk of file-level results, up to 200 files (shared secret)
//   POST   /api/runner/:id/result                         runner callback with findings (shared secret)
//   POST   /api/runner/:id/model-key                      one-time exchange of a model token for the key (shared secret + token)
//   POST   /api/runner/:id/screens                        screens drawn from the code by the model (shared secret)
//   POST   /api/runner/:id/screens-done                   a screens run has finished, with or without screens (shared secret)
//   GET    /api/runner/:id/screen-paths                   the paths that already have a screen (shared secret)
//   POST   /api/analyses/:id/rerun                        run a finished analysis again with the same settings (platform engineers)
//   POST   /api/analyses/:id/screens/redraw               draw the screens again with the same model, without a new assessment (platform engineers)
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

// Which finding categories each role may see. Every role sees every category: the data is the same for everyone in
// the workspace. Who may change the work is still decided by the role (see canStart and canApproveTarget).
const ROLE_CATEGORIES = {
  platform_engineer: "all",
  security_officer: "all",
  informatics_lead: "all",
  cio_cto: "all",
  auditor: "all",
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

// Platform roles, across Cutover and not tied to a workspace. A person can hold several. Super users are the
// operator list; the others are rows in the staff table. A table that cannot be read gives only the operator list.
const PLATFORM_ROLES = ["super_user", "admin", "sales", "support"];
// Who may be invited as a demo user by an admin or a sales person. Only super users may grant anything else.
const DEMO_ROLES = ["sales", "support"];
const STAFF_ROWS = 500;
async function platformRolesFor(env, email) {
  const clean = normalizeEmail(email);
  if (!clean) return [];
  const roles = new Set();
  if (isOperator(env, clean)) roles.add("super_user");
  const res = await serviceRest(env, `staff?email=eq.${encodeURIComponent(clean)}&select=roles`);
  if (res.ok) {
    const rows = await res.json();
    for (const r of (rows[0] && rows[0].roles) || []) if (PLATFORM_ROLES.includes(r)) roles.add(r);
  }
  return [...roles];
}
const canSeeTracker = (roles) => roles.some((r) => ["super_user", "admin", "sales", "support"].includes(r));
const canInvite = (roles) => roles.some((r) => ["super_user", "admin", "sales"].includes(r));
// Super users may set any roles. Admins and sales people may set only demo roles, and may change only people
// who hold nothing beyond demo roles. Nobody else sets roles.
function canSetRoles(actorRoles, targetRolesNow, newRoles) {
  if (actorRoles.includes("super_user")) return true;
  if (!(actorRoles.includes("admin") || actorRoles.includes("sales"))) return false;
  const demoOnly = (list) => list.every((r) => DEMO_ROLES.includes(r));
  return demoOnly(targetRolesNow) && demoOnly(newRoles);
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
    // The log keeps the invitation after it is used up, so the invitation tracker can show it. Best effort.
    await serviceRest(env, `invitation_log?workspace_id=eq.${inv.workspace_id}&email=eq.${encodeURIComponent(email)}&accepted_at=is.null`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ accepted_at: new Date().toISOString() }),
    }).catch(() => {});
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

// Time on the system. Points and levels are recognition only. Totals are shown to the person they belong to.
const POINTS_PER_MINUTE = 1;
const SESSION_GAP_MS = 30 * 60 * 1000;
const HEARTBEAT_MAX_SECONDS = 60;
const FAVOURITE_MARGIN = 1.25;
const LEVELS = [
  { at: 0, name: "Starter" },
  { at: 100, name: "Explorer" },
  { at: 500, name: "Regular" },
  { at: 1500, name: "Champion" },
  { at: 5000, name: "Legend" },
];
const HOUR_BADGES = [1, 5, 25, 100];

function levelFor(points) {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i += 1) if (points >= LEVELS[i].at) index = i;
  const next = LEVELS[index + 1] || null;
  return { number: index + 1, name: LEVELS[index].name, points, at: LEVELS[index].at, next_at: next ? next.at : null };
}

// A heartbeat from the portal: seconds spent on one screen. A gap of over thirty minutes starts a new visit.
async function recordScreenTime(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const screen = typeof parsed.value?.screen === "string" ? parsed.value.screen : "";
  const seconds = Number(parsed.value?.seconds);
  if (!/^s-[a-z-]{1,38}$/.test(screen)) return json({ error: "Choose a screen." }, 400);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > HEARTBEAT_MAX_SECONDS) return json({ error: "Send the seconds in the range 1 to 60." }, 400);
  const userId = auth.user.id;
  const day = new Date().toISOString().slice(0, 10);
  const now = new Date();
  // The workspace the person is working in. It is counted only when they are a member of it.
  const wsId = typeof parsed.value?.workspace_id === "string" && UUID_PATTERN.test(parsed.value.workspace_id) ? parsed.value.workspace_id : null;
  if (wsId) {
    const member = await serviceRest(env, `members?user_id=eq.${userId}&workspace_id=eq.${wsId}&select=workspace_id`);
    if (member.ok && (await member.json()).length) {
      const wsCurrent = await serviceRest(env, `workspace_time?user_id=eq.${userId}&workspace_id=eq.${wsId}&day=eq.${day}&select=seconds`);
      const [wsRow] = wsCurrent.ok ? await wsCurrent.json() : [];
      await serviceRest(env, "workspace_time?on_conflict=user_id,workspace_id,day", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: userId, workspace_id: wsId, day, seconds: (wsRow?.seconds || 0) + seconds }),
      });
    }
  }

  const current = await serviceRest(env, `screen_time?user_id=eq.${userId}&day=eq.${day}&screen=eq.${screen}&select=seconds`);
  if (!current.ok) return json({ error: "Could not record the time." }, 502);
  const [row] = await current.json();
  const saved = await serviceRest(env, "screen_time?on_conflict=user_id,day,screen", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, day, screen, seconds: (row?.seconds || 0) + seconds }),
  });
  if (!saved.ok) return json({ error: "Could not record the time." }, 502);

  const totals = await serviceRest(env, `engagement?user_id=eq.${userId}&select=total_seconds,last_seen,visit_start_total,previous_seen,previous_visit_seconds`);
  if (!totals.ok) return json({ error: "Could not record the time." }, 502);
  const [eng] = await totals.json();
  const before = Number(eng?.total_seconds || 0);
  const newVisit = !eng || !eng.last_seen || now - new Date(eng.last_seen) > SESSION_GAP_MS;
  // When a visit ends (a new one starts), its length is kept as the previous visit.
  const next = {
    user_id: userId,
    total_seconds: before + seconds,
    last_seen: now.toISOString(),
    visit_start_total: newVisit ? before : Number(eng?.visit_start_total || 0),
    previous_seen: newVisit && eng?.last_seen ? eng.last_seen : eng?.previous_seen || null,
    previous_visit_seconds: newVisit && eng?.last_seen ? Math.max(0, before - Number(eng?.visit_start_total || 0)) : Number(eng?.previous_visit_seconds || 0),
  };
  const saveTotals = await serviceRest(env, "engagement?on_conflict=user_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(next),
  });
  if (!saveTotals.ok) return json({ error: "Could not record the time." }, 502);
  return json({ ok: true });
}

// What the login card shows: totals, the change since the previous visit, points and level, badges, and the
// favourite screen over the last thirty days, named only when it is clearly ahead of the next one.
async function engagementSummary(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const userId = auth.user.id;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [totalsRes, screensRes, daysRes] = await Promise.all([
    serviceRest(env, `engagement?user_id=eq.${userId}&select=total_seconds,last_seen,previous_seen,previous_visit_seconds`),
    serviceRest(env, `screen_time?user_id=eq.${userId}&day=gte.${since}&select=screen,seconds`),
    serviceRest(env, `screen_time?user_id=eq.${userId}&select=day,seconds`),
  ]);
  const firstFailure = [["engagement", totalsRes], ["screen_time", screensRes], ["screen_time", daysRes]].find(([, r]) => !r.ok);
  if (firstFailure) return json({ error: `Could not load your time on the system (${firstFailure[0]}, status ${firstFailure[1].status}).` }, 502);
  const [eng] = await totalsRes.json();
  const total = Number(eng?.total_seconds || 0);
  const [wsTimeRes, membersRes] = await Promise.all([
    serviceRest(env, `workspace_time?user_id=eq.${userId}&select=workspace_id,seconds`),
    serviceRest(env, `members?user_id=eq.${userId}&select=workspace_id,workspace:workspaces(id,name)`),
  ]);
  const secondFailure = [["workspace_time", wsTimeRes], ["members", membersRes]].find(([, r]) => !r.ok);
  if (secondFailure) return json({ error: `Could not load your time on the system (${secondFailure[0]}, status ${secondFailure[1].status}).` }, 502);
  const wsSeconds = {};
  for (const r of await wsTimeRes.json()) wsSeconds[r.workspace_id] = (wsSeconds[r.workspace_id] || 0) + Number(r.seconds || 0);
  const workspaces = (await membersRes.json())
    .filter((m) => m.workspace)
    .map((m) => ({ id: m.workspace.id, name: m.workspace.name, seconds: wsSeconds[m.workspace.id] || 0 }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
    .slice(0, 10);
  const byScreen = {};
  for (const r of await screensRes.json()) byScreen[r.screen] = (byScreen[r.screen] || 0) + Number(r.seconds || 0);
  const ranked = Object.entries(byScreen).sort((a, b) => b[1] - a[1]);
  const [topScreen, topSeconds] = ranked[0] || [null, 0];
  const runnerUp = ranked[1] ? ranked[1][1] : 0;
  const favourite = topScreen && topSeconds > 0 && topSeconds >= runnerUp * FAVOURITE_MARGIN ? { screen: topScreen, seconds: topSeconds } : null;
  const points = Math.floor(total / 60) * POINTS_PER_MINUTE;
  // The first day each badge was reached: the day the running total of time first passed its threshold.
  const daily = {};
  for (const r of await daysRes.json()) daily[r.day] = (daily[r.day] || 0) + Number(r.seconds || 0);
  const days = Object.keys(daily).sort();
  const reachedOn = (seconds) => {
    let running = 0;
    for (const d of days) {
      running += daily[d];
      if (running >= seconds) return d;
    }
    // The running total is short of the threshold but the total says it was reached: use the last day we have.
    return total >= seconds && days.length ? days[days.length - 1] : null;
  };
  const level = levelFor(points);
  const previous = eng?.previous_seen || null;
  return json({
    total_seconds: total,
    last_visit: previous,
    last_visit_seconds: previous ? Number(eng.previous_visit_seconds || 0) : 0,
    favourite,
    workspaces,
    level,
    // Every badge reached stays on the list, in the order it was reached: the earliest day first. On the same day a
    // level comes before a time badge. Each says the day it was reached.
    badges: [
      ...LEVELS.slice(0, level.number).map((l, i) => ({ id: `level-${i + 1}`, name: `${l.name} badge`, kind: "level", earned_on: reachedOn(Math.ceil(l.at / POINTS_PER_MINUTE) * 60) })),
      ...HOUR_BADGES.filter((h) => total >= h * 3600).map((h) => ({ id: `hours-${h}`, name: `${h} ${h === 1 ? "hour" : "hours"} on the system`, kind: "hours", earned_on: reachedOn(h * 3600) })),
    ].sort((a, b) => (a.earned_on || "9999").localeCompare(b.earned_on || "9999") || (a.kind === b.kind ? 0 : a.kind === "level" ? -1 : 1)),
  });
}

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
  await recordLogin(env, auth.user).catch(() => {});
  const res = await serviceRest(env,
    `members?user_id=eq.${auth.user.id}&select=workspace_id,role,is_admin,created_at,workspace:workspaces(id,name)&order=created_at.asc`);
  if (!res.ok) return json({ error: "Could not load your workspaces." }, 502);
  const rows = await res.json();
  return json({
    email: auth.user.email,
    is_operator: isOperator(env, auth.user.email),
    staff_roles: await platformRolesFor(env, auth.user.email),
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
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") return json({ error: "The message must be text." }, 400);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 200) return json({ error: "The message can be up to 200 characters." }, 400);

  const res = await serviceRest(env, "invitations?on_conflict=workspace_id,email", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ workspace_id: workspaceId, email, role: body.role, is_admin: isAdmin, invited_by: access.user.id }),
  });
  if (!res.ok) return json({ error: "Could not save the invitation." }, 502);
  await logInvitation(env, workspaceId, email, body.role, isAdmin, access.user.id, note || null).catch(() => {});
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
  await serviceRest(env, `invitation_log?workspace_id=eq.${workspaceId}&email=eq.${encodeURIComponent(clean)}&accepted_at=is.null&removed_at=is.null`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ removed_at: new Date().toISOString() }),
  }).catch(() => {});
  return json({ removed: true });
}

// One open log row per person and workspace: a second invitation updates the open row rather than adding one.
async function logInvitation(env, workspaceId, email, role, isAdmin, invitedBy, note) {
  const now = new Date().toISOString();
  const open = await serviceRest(env, `invitation_log?workspace_id=eq.${workspaceId}&email=eq.${encodeURIComponent(email)}&accepted_at=is.null&removed_at=is.null&select=id`);
  const rows = open.ok ? await open.json() : [];
  if (rows.length) {
    await serviceRest(env, `invitation_log?id=eq.${rows[0].id}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ role, is_admin: isAdmin, invited_by: invitedBy, invited_at: now, note }),
    });
    return;
  }
  await serviceRest(env, "invitation_log", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ workspace_id: workspaceId, email, role, is_admin: isAdmin, invited_by: invitedBy, invited_at: now, note }),
  });
}

// ---- Staff: owners and sales people (added by a super user). Not open to customers. ----

// A new login is counted when the last one was more than 30 minutes ago, as in Proof to Profit. Best effort.
const LOGIN_GAP_MS = 30 * 60 * 1000;
async function recordLogin(env, user) {
  const since = encodeURIComponent(new Date(Date.now() - LOGIN_GAP_MS).toISOString());
  const recent = await serviceRest(env, `login_events?user_id=eq.${user.id}&at=gte.${since}&select=id&limit=1`);
  if (!recent.ok) return;
  if ((await recent.json()).length) return;
  await serviceRest(env, "login_events", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ user_id: user.id, email: normalizeEmail(user.email) || String(user.email || "") }),
  });
}

// The invitation tracker across every workspace: each invitation, whether it was used, and the last visit.
async function staffInvitations(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const roles = await platformRolesFor(env, auth.user.email);
  if (!canSeeTracker(roles)) return json({ error: "Only Cutover staff can see this." }, 403);
  // Staff see only demo spaces. A customer workspace is never shown to Cutover staff, unless they are members of it.
  const [wsRes, logRes, invRes, memRes, engRes, loginRes] = await Promise.all([
    serviceRest(env, "workspaces?select=id,name&is_demo=eq.true&order=created_at.asc"),
    serviceRest(env, `invitation_log?select=workspace_id,email,role,is_admin,invited_by,invited_at,accepted_at,removed_at,note&order=invited_at.desc&limit=${STAFF_ROWS}`),
    serviceRest(env, "invitations?select=workspace_id,email,role,is_admin,invited_by,created_at"),
    serviceRest(env, "members?select=workspace_id,user_id,email,role,is_admin,created_at"),
    serviceRest(env, "engagement?select=user_id,last_seen"),
    serviceRest(env, "login_events?select=user_id"),
  ]);
  if (!wsRes.ok || !logRes.ok || !invRes.ok || !memRes.ok || !engRes.ok || !loginRes.ok) {
    return json({ error: "Could not load the invitations." }, 502);
  }
  const workspaces = await wsRes.json();
  const demo = new Set(workspaces.map((w) => w.id));
  const inDemo = (r) => demo.has(r.workspace_id);
  const log = (await logRes.json()).filter(inDemo);
  const pending = (await invRes.json()).filter(inDemo);
  const members = (await memRes.json()).filter(inDemo);
  const lastSeen = new Map((await engRes.json()).map((r) => [r.user_id, r.last_seen]));
  const loginCount = new Map();
  for (const r of await loginRes.json()) loginCount.set(r.user_id, (loginCount.get(r.user_id) || 0) + 1);
  const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
  const emailOf = new Map(members.map((m) => [m.user_id, m.email]));
  const key = (wsId, email) => `${wsId}|${email}`;
  const memberOf = new Map(members.map((m) => [key(m.workspace_id, m.email), m]));

  // Invitations sent before the log existed are still pending in the invitations table; count them as sent.
  const seen = new Set(log.map((r) => key(r.workspace_id, r.email)));
  const all = [...log];
  for (const inv of pending) {
    if (seen.has(key(inv.workspace_id, inv.email))) continue;
    seen.add(key(inv.workspace_id, inv.email));
    all.push({ ...inv, invited_at: inv.created_at, accepted_at: null, removed_at: null });
  }

  const rows = all.map((r) => {
    const member = memberOf.get(key(r.workspace_id, r.email));
    const signedIn = !!(member || r.accepted_at);
    const status = signedIn ? "signed_in" : r.removed_at ? "removed" : "waiting";
    return {
      workspace_id: r.workspace_id,
      workspace: wsName.get(r.workspace_id) || "Workspace",
      email: r.email,
      role: r.role,
      is_admin: r.is_admin === true,
      invited_by: emailOf.get(r.invited_by) || null,
      invited_at: r.invited_at,
      accepted_at: r.accepted_at || null,
      status,
      last_seen: member ? lastSeen.get(member.user_id) || null : null,
      note: r.note || null,
      // Signed in before logins were counted: shown as at least one, as in Proof to Profit.
      logins: signedIn ? Math.max(1, loginCount.get(member?.user_id) || 0) : 0,
    };
  });
  // People who joined before any invitation was logged have no invited_at. They are listed, but not counted as sent.
  for (const m of members) {
    if (seen.has(key(m.workspace_id, m.email))) continue;
    rows.push({
      workspace_id: m.workspace_id,
      workspace: wsName.get(m.workspace_id) || "Workspace",
      email: m.email,
      role: m.role,
      is_admin: m.is_admin === true,
      invited_by: null,
      invited_at: null,
      accepted_at: null,
      status: "signed_in",
      last_seen: lastSeen.get(m.user_id) || null,
      note: null,
      logins: Math.max(1, loginCount.get(m.user_id) || 0),
    });
  }
  rows.sort((a, b) => String(b.invited_at || "").localeCompare(String(a.invited_at || "")));

  const tracked = rows.filter((r) => r.invited_at);
  const count = (status) => tracked.filter((r) => r.status === status).length;
  const hours = tracked
    .filter((r) => r.accepted_at)
    .map((r) => (Date.parse(r.accepted_at) - Date.parse(r.invited_at)) / 3600000)
    .filter((h) => h >= 0);
  const sent = tracked.length;
  const signedIn = count("signed_in");
  return json({
    viewer_roles: roles,
    totals: {
      sent,
      signed_in: signedIn,
      waiting: count("waiting"),
      removed: count("removed"),
      acceptance_percent: sent ? Math.round((signedIn / sent) * 100) : 0,
      avg_hours_to_join: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
      signed_in_before_tracking: rows.length - tracked.length,
    },
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
    rows: rows.slice(0, STAFF_ROWS),
  });
}

// Staff people and their platform roles. Visible to anyone who may invite.
async function listStaff(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  if (!canInvite(await platformRolesFor(env, auth.user.email))) return json({ error: "Only staff who can invite may see this." }, 403);
  const res = await serviceRest(env, "staff?select=email,roles,created_at&order=created_at.asc");
  if (!res.ok) return json({ error: "Could not load the staff list." }, 502);
  return json(await res.json());
}

// ---- Prospects: people a sales or admin person invites to a meeting. Prospects never log in. ----
const SITE_ORIGIN = "https://cutover.site";
const PROSPECT_LINK_MS = 30 * 24 * 60 * 60 * 1000;
const PHONE_PATTERN = /^\+?[0-9 ()\-.]{7,30}$/;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// The booking link names the prospect, is signed, and expires after 30 days.
async function signProspectToken(env, prospectId) {
  const payload = `booking.${prospectId}.${Date.now() + PROSPECT_LINK_MS}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await calendarStateKey(env), new TextEncoder().encode(payload)));
  return `${payload}.${base64UrlFrom(sig)}`;
}

// Returns the prospect id when the link is genuine and has not expired.
async function readProspectToken(env, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4) return null;
  const [kind, prospectId, expires, sig] = parts;
  if (kind !== "booking" || !UUID_PATTERN.test(prospectId) || !(Number(expires) >= Date.now())) return null;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await calendarStateKey(env), new TextEncoder().encode(`booking.${prospectId}.${expires}`)));
  return base64UrlFrom(mac) === sig ? prospectId : null;
}

// Sends one email from the sales address. Returns false, and never throws, when email is not set up or the send fails.
async function sendProspectMail(env, to, subject, text, html) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  try {
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: String(subject).slice(0, 200), text: String(text).slice(0, 8000), ...(html ? { html } : {}) }),
    });
    return sent.ok;
  } catch {
    return false;
  }
}

const UNATTENDED_NOTICE = "This inbox is unattended. Nobody reads or replies to messages sent here.";

function prospectInviteEmail(prospect, bookingUrl) {
  const first = prospect.first_name;
  const subject = `${first}, book your Cutover walkthrough`;
  const text = [
    `Hi ${first},`,
    "",
    "Thank you for your interest in Cutover. Pick the 30-minute slot that suits you, and we will walk you through the platform.",
    "",
    `Book your meeting: ${bookingUrl}`,
    `Visit cutover.site: ${SITE_ORIGIN}`,
    `See the demo: ${SITE_ORIGIN}/cutover-demo/`,
    "",
    "What to expect:",
    "- A 30-minute walkthrough tailored to your business",
    "- Answers to your questions about migration, security and rollout",
    "- Clear next steps, with no obligation",
    "",
    UNATTENDED_NOTICE,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f1fb;font-family:Arial,Helvetica,sans-serif;color:#1d1640">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden">
  <tr><td style="background:linear-gradient(135deg,#6d28d9,#db2777,#f97316);padding:36px 32px;color:#ffffff">
    <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;opacity:.9">Cutover</div>
    <div style="font-size:30px;font-weight:700;line-height:1.2;margin-top:12px">Hi ${escapeHtml(first)}, let's talk about your migration.</div>
    <div style="font-size:16px;line-height:1.5;margin-top:14px;opacity:.95">Thank you for your interest. Pick a 30-minute slot that suits you and we will walk you through Cutover, live.</div>
  </td></tr>
  <tr><td style="padding:32px;text-align:center">
    <a href="${escapeHtml(bookingUrl)}" style="display:inline-block;background:#1d1640;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:16px 28px;border-radius:999px">Book your 30-minute meeting</a>
    <div style="font-size:13px;color:#6b6585;margin-top:12px">Choose a time that works for you. Takes about a minute.</div>
  </td></tr>
  <tr><td style="padding:0 32px 8px 32px">
    <div style="font-size:18px;font-weight:700;margin-bottom:14px">What to expect</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:14px 16px;background:#f7f4ff;border-radius:14px;font-size:15px;line-height:1.5"><strong>A tailored walkthrough.</strong> We focus on the workflows that matter to your business.</td></tr>
      <tr><td style="height:10px"></td></tr>
      <tr><td style="padding:14px 16px;background:#fff6f0;border-radius:14px;font-size:15px;line-height:1.5"><strong>Your questions answered.</strong> Migration, security, and how the rollout would run.</td></tr>
      <tr><td style="height:10px"></td></tr>
      <tr><td style="padding:14px 16px;background:#f0fdf8;border-radius:14px;font-size:15px;line-height:1.5"><strong>Clear next steps.</strong> No obligation. You decide what happens next.</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:24px 32px 32px 32px;text-align:center;font-size:15px">
    Explore first: <a href="${SITE_ORIGIN}" style="color:#6d28d9;font-weight:700">cutover.site</a> &nbsp;·&nbsp; <a href="${SITE_ORIGIN}/cutover-demo/" style="color:#db2777;font-weight:700">See the demo</a>
  </td></tr>
  <tr><td style="background:#faf9fd;padding:18px 32px;font-size:12px;color:#6b6585;text-align:center;line-height:1.5">${escapeHtml(UNATTENDED_NOTICE)}<br>Cutover · cutover.site</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

function cleanText(value, max) {
  const s = String(value ?? "").trim();
  return s.length > 0 && s.length <= max ? s : null;
}

// What staff see for a prospect. Nothing here is needed to log in, and no login data is stored for prospects.
function publicProspect(row) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    company: row.company,
    phone: row.phone,
    invited_by_email: row.invited_by_email,
    invited_at: row.invited_at,
    last_email_at: row.last_email_at,
    status: row.status,
    meeting_at: row.meeting_at,
  };
}

async function prospectCaller(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return { response: auth.response };
  if (!canInvite(await platformRolesFor(env, auth.user.email))) return { response: json({ error: "Only staff who can invite may use prospects." }, 403) };
  return { user: auth.user };
}

// Adds a prospect and sends the rich invitation. A prospect is saved even if the email cannot be sent.
async function createProspect(request, env) {
  const caller = await prospectCaller(request, env);
  if (caller.response) return caller.response;
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "Enter a valid email address." }, 400);
  const first_name = cleanText(body.first_name, 80);
  const last_name = cleanText(body.last_name, 80);
  if (!first_name || !last_name) return json({ error: "Enter the first and last name." }, 400);
  const company = cleanText(body.company, 120);
  if (!company) return json({ error: "Enter the company name." }, 400);
  const phone = body.phone ? String(body.phone).trim() : null;
  if (phone && !PHONE_PATTERN.test(phone)) return json({ error: "Enter a valid phone number, or leave it empty." }, 400);
  const invitedBy = normalizeEmail(caller.user.email);

  const res = await serviceRest(env, "prospects", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ email, first_name, last_name, company, phone: phone || null, invited_by: caller.user.id, invited_by_email: invitedBy, status: "invited" }),
  });
  if (!res.ok) return json({ error: "Could not save the prospect." }, 502);
  const [row] = await res.json();

  const bookingUrl = `${SITE_ORIGIN}/book/?t=${await signProspectToken(env, row.id)}`;
  const mail = prospectInviteEmail(row, bookingUrl);
  const sent = await sendProspectMail(env, row.email, mail.subject, mail.text, mail.html);
  if (sent) {
    await serviceRest(env, `prospects?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ last_email_at: new Date().toISOString() }),
    });
    row.last_email_at = new Date().toISOString();
  }
  return json({ prospect: publicProspect(row), email_sent: sent }, 201);
}

async function listProspects(request, env) {
  const caller = await prospectCaller(request, env);
  if (caller.response) return caller.response;
  const res = await serviceRest(env, "prospects?select=*&order=invited_at.desc&limit=500");
  if (!res.ok) return json({ error: "Could not load the prospects." }, 502);
  return json({ prospects: (await res.json()).map(publicProspect) });
}

// ---- Booking: a prospect picks a free time from the sender's calendar, and can move or cancel it. Public, but only with a signed link. ----
const BOOKING_TIME_ZONE_DEFAULT = "America/New_York";
const BOOKING_MINUTES = 30;
const BOOKING_GAP_MS = 15 * 60 * 1000;
const BOOKING_DAYS_AHEAD = 14;
const BOOKING_NOTICE_MS = 2 * 60 * 60 * 1000;
const CAN_BOOK = ["invited", "cancelled", "booked"];

function bookingZone(env) {
  return env.BOOKING_TIME_ZONE || BOOKING_TIME_ZONE_DEFAULT;
}

// How far the zone is ahead of UTC at one moment, in milliseconds.
function zoneOffsetMs(utcMs, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// The instant of a wall-clock time (YYYY-MM-DD, hour, minute) in the given zone.
function zonedInstant(dateStr, hour, minute, zone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - zoneOffsetMs(guess, zone);
  return guess;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Mon to Fri, 9:00 to 17:00 in the host's zone, 30-minute meetings, 15 minutes clear of other events.
function bookingSlotsFor(busy, zone, now) {
  const slots = [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(now));
  for (let i = 0; i < BOOKING_DAYS_AHEAD; i++) {
    const day = addDays(today, i);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let minutes = 9 * 60; minutes + BOOKING_MINUTES <= 17 * 60; minutes += BOOKING_MINUTES) {
      const start = zonedInstant(day, Math.floor(minutes / 60), minutes % 60, zone);
      const end = start + BOOKING_MINUTES * 60 * 1000;
      if (start < now + BOOKING_NOTICE_MS) continue;
      const clash = busy.some((b) => start < b.end + BOOKING_GAP_MS && end + BOOKING_GAP_MS > b.start);
      if (!clash) slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    }
  }
  return slots;
}

// A fresh access token for the sender's calendar, from the refresh token we stored when they connected.
async function hostAccessToken(env, hostUserId) {
  const found = await serviceRest(env, `calendar_connections?user_id=eq.${hostUserId}&select=ciphertext,iv`);
  const row = found.ok ? (await found.json())[0] : null;
  const key = row && (await encryptionKey(env));
  if (!row || !key) return null;
  const refresh = await decryptModelKey(key, row).catch(() => null);
  if (!refresh || !env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }).toString(),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()).access_token || null;
}

// The busy times on the sender's primary calendar. Null when the calendar cannot be read.
async function hostBusyTimes(accessToken, fromMs, toMs) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(), items: [{ id: "primary" }] }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const busy = ((await res.json()).calendars?.primary?.busy) || [];
  return busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
}

// Loads the prospect a link names. Null when the link is not valid.
async function bookingContext(env, token) {
  const prospectId = await readProspectToken(env, token);
  if (!prospectId) return null;
  const res = await serviceRest(env, `prospects?id=eq.${prospectId}&select=*`);
  const prospect = res.ok ? (await res.json())[0] : null;
  return prospect ? { prospect } : null;
}

async function freeTimesFor(env, prospect) {
  const zone = bookingZone(env);
  const now = Date.now();
  const hostToken = await hostAccessToken(env, prospect.invited_by);
  if (!hostToken) return { error: "The Cutover team member who invited you is not available right now. Please reply to the invitation email, or try again later." };
  const from = zonedInstant(new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(now)), 0, 0, zone);
  const to = from + (BOOKING_DAYS_AHEAD + 1) * 24 * 60 * 60 * 1000;
  const busy = await hostBusyTimes(hostToken, from, to);
  if (!busy) return { error: "The calendar could not be read right now. Please try again in a moment." };
  return { zone, slots: bookingSlotsFor(busy, zone, now) };
}

async function bookingInfo(request, env, token) {
  const found = await bookingContext(env, token);
  if (!found) return json({ error: "This booking link is not valid or has expired." }, 404);
  const p = found.prospect;
  return json({
    first_name: p.first_name,
    last_name: p.last_name,
    email: p.email,
    company: p.company,
    phone: p.phone,
    status: p.status,
    meeting_at: p.meeting_at,
    time_zone: bookingZone(env),
  });
}

async function bookingSlots(request, env, token) {
  const found = await bookingContext(env, token);
  if (!found) return json({ error: "This booking link is not valid or has expired." }, 404);
  if (!CAN_BOOK.includes(found.prospect.status)) return json({ error: "This meeting can no longer be changed." }, 409);
  const result = await freeTimesFor(env, found.prospect);
  if (result.error) return json({ error: result.error }, 503);
  return json({ time_zone: result.zone, slots: result.slots });
}

function formatMeeting(startIso, zone) {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(startIso));
}

// The emails the prospect gets. kind is "booked", "moved" or "cancelled".
function prospectBookingEmail(kind, firstName, when, manageUrl) {
  const first = firstName;
  const copy = {
    booked: { subject: "Your meeting with the Cutover team is booked", headline: `You're booked, ${first}.`, line: "Your meeting with the Cutover team is booked." },
    moved: { subject: "Your Cutover meeting has moved", headline: `Your meeting has moved, ${first}.`, line: "Your meeting with the Cutover team has a new time." },
    cancelled: { subject: "Your Cutover meeting is cancelled", headline: `Your meeting is cancelled, ${first}.`, line: "Your meeting with the Cutover team has been cancelled. You can book a new time at any point." },
  }[kind];
  const textLines = [`Hi ${first},`, "", copy.line];
  if (when) textLines.push(`When: ${when}`);
  if (manageUrl) textLines.push("", `Change or cancel your meeting: ${manageUrl}`);
  textLines.push("", `Learn more at ${SITE_ORIGIN}`, `See the demo: ${SITE_ORIGIN}/cutover-demo/`, "", UNATTENDED_NOTICE);
  const action = manageUrl
    ? `<a href="${escapeHtml(manageUrl)}" style="display:inline-block;background:#1d1640;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:999px">${kind === "cancelled" ? "Book a new time" : "Change or cancel my meeting"}</a>`
    : `<a href="${SITE_ORIGIN}" style="display:inline-block;background:#1d1640;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:999px">Visit cutover.site</a>`;
  const whenBlock = when ? `<tr><td style="padding:28px 32px 0 32px"><div style="padding:18px 20px;background:#f7f4ff;border-radius:14px;font-size:16px;line-height:1.5"><strong>When</strong><br>${escapeHtml(when)}</div></td></tr>` : "";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f1fb;font-family:Arial,Helvetica,sans-serif;color:#1d1640">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden">
  <tr><td style="background:linear-gradient(135deg,#6d28d9,#db2777,#f97316);padding:36px 32px;color:#ffffff">
    <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;opacity:.9">Cutover</div>
    <div style="font-size:28px;font-weight:700;line-height:1.2;margin-top:12px">${escapeHtml(copy.headline)}</div>
    <div style="font-size:16px;line-height:1.5;margin-top:12px;opacity:.95">${escapeHtml(copy.line)}</div>
  </td></tr>
  ${whenBlock}
  <tr><td style="padding:28px 32px;text-align:center">${action}</td></tr>
  <tr><td style="padding:0 32px 28px 32px;text-align:center;font-size:15px">
    <a href="${SITE_ORIGIN}" style="color:#6d28d9;font-weight:700">cutover.site</a> &nbsp;·&nbsp; <a href="${SITE_ORIGIN}/cutover-demo/" style="color:#db2777;font-weight:700">See the demo</a>
  </td></tr>
  <tr><td style="background:#faf9fd;padding:18px 32px;font-size:12px;color:#6b6585;text-align:center;line-height:1.5">${escapeHtml(UNATTENDED_NOTICE)}<br>Cutover · cutover.site</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: copy.subject, text: textLines.join("\n"), html };
}

// The notice the sender gets. Plain text, from the same sales address.
function senderNotice(kind, prospect, when) {
  const who = `${prospect.first_name} ${prospect.last_name} from ${prospect.company}`;
  const verb = { booked: "booked a meeting", moved: "moved their meeting", cancelled: "cancelled their meeting" }[kind];
  const subject = `Meeting ${kind}: ${prospect.first_name} ${prospect.last_name}, ${prospect.company}`;
  const lines = [`${who} ${verb}.`, ""];
  if (when) lines.push(`When: ${when}`);
  lines.push(`Email: ${prospect.email}`);
  if (prospect.phone) lines.push(`Phone: ${prospect.phone}`);
  lines.push("", kind === "cancelled" ? "The event has been removed from your Google Calendar." : "The event is on your Google Calendar.", "", UNATTENDED_NOTICE);
  return { subject, text: lines.join("\n") };
}

async function bookMeeting(request, env, token) {
  const found = await bookingContext(env, token);
  if (!found) return json({ error: "This booking link is not valid or has expired." }, 404);
  const prospect = found.prospect;
  if (!CAN_BOOK.includes(prospect.status)) return json({ error: "This meeting can no longer be changed." }, 409);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const first_name = cleanText(body.first_name, 80);
  const last_name = cleanText(body.last_name, 80);
  const email = normalizeEmail(body.email);
  const company = cleanText(body.company, 120);
  const phone = body.phone ? String(body.phone).trim() : null;
  if (!first_name || !last_name) return json({ error: "Enter your first and last name." }, 400);
  if (!email) return json({ error: "Enter a valid email address." }, 400);
  if (!company) return json({ error: "Enter your company name." }, 400);
  if (phone && !PHONE_PATTERN.test(phone)) return json({ error: "Enter a valid phone number, or leave it empty." }, 400);

  const result = await freeTimesFor(env, prospect);
  if (result.error) return json({ error: result.error }, 503);
  const chosen = result.slots.find((s) => s.start === body.start);
  if (!chosen) return json({ error: "That time is no longer free. Please pick another time." }, 409);

  const hostToken = await hostAccessToken(env, prospect.invited_by);
  if (!hostToken) return json({ error: "The calendar is not available right now. Please try again." }, 503);
  const eventBody = JSON.stringify({
    summary: `Cutover meeting: ${first_name} ${last_name}, ${company}`,
    description: `Booked through cutover.site.\nEmail: ${email}${phone ? `\nPhone: ${phone}` : ""}`,
    start: { dateTime: chosen.start, timeZone: result.zone },
    end: { dateTime: chosen.end, timeZone: result.zone },
    attendees: [{ email }],
  });
  const headers = { authorization: `Bearer ${hostToken}`, "content-type": "application/json" };
  const moving = prospect.status === "booked" && prospect.calendar_event_id;
  const event = await fetch(
    moving
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(prospect.calendar_event_id)}?sendUpdates=none`
      : "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none",
    { method: moving ? "PATCH" : "POST", headers, body: eventBody },
  ).catch(() => null);
  if (!event || !event.ok) return json({ error: "The meeting could not be added to the calendar. Please try again." }, 502);
  const eventId = moving ? prospect.calendar_event_id : (await event.json()).id || null;

  const saved = await serviceRest(env, `prospects?id=eq.${prospect.id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ status: "booked", meeting_at: chosen.start, first_name, last_name, email, company, phone: phone || null, calendar_event_id: eventId }),
  });
  if (!saved.ok) return json({ error: "The meeting was saved in the calendar, but we could not record it. Please contact the Cutover team." }, 502);

  const kind = moving ? "moved" : "booked";
  const when = formatMeeting(chosen.start, result.zone);
  const updated = { ...prospect, first_name, last_name, email, company, phone: phone || null };
  const manageUrl = `${SITE_ORIGIN}/book/?t=${await signProspectToken(env, prospect.id)}`;
  const mail = prospectBookingEmail(kind, first_name, when, manageUrl);
  await sendProspectMail(env, email, mail.subject, mail.text, mail.html);
  const notice = senderNotice(kind, updated, when);
  await sendProspectMail(env, prospect.invited_by_email, notice.subject, notice.text, null);
  return json({ booked: true, moved: Boolean(moving), start: chosen.start, end: chosen.end, time_zone: result.zone });
}

async function cancelMeeting(request, env, token) {
  const found = await bookingContext(env, token);
  if (!found) return json({ error: "This booking link is not valid or has expired." }, 404);
  const prospect = found.prospect;
  if (prospect.status !== "booked") return json({ error: "There is no booked meeting to cancel." }, 409);

  if (prospect.calendar_event_id) {
    const hostToken = await hostAccessToken(env, prospect.invited_by);
    if (!hostToken) return json({ error: "The calendar is not available right now. Please try again." }, 503);
    const del = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(prospect.calendar_event_id)}?sendUpdates=none`,
      { method: "DELETE", headers: { authorization: `Bearer ${hostToken}` } },
    ).catch(() => null);
    // Google answers 410 when the event was already removed, which still leaves nothing to cancel.
    if (!del || (!del.ok && del.status !== 410 && del.status !== 404)) return json({ error: "The meeting could not be removed from the calendar. Please try again." }, 502);
  }

  const saved = await serviceRest(env, `prospects?id=eq.${prospect.id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ status: "cancelled", meeting_at: null, calendar_event_id: null }),
  });
  if (!saved.ok) return json({ error: "The meeting was removed, but we could not record it. Please contact the Cutover team." }, 502);

  const bookUrl = `${SITE_ORIGIN}/book/?t=${await signProspectToken(env, prospect.id)}`;
  const mail = prospectBookingEmail("cancelled", prospect.first_name, null, bookUrl);
  await sendProspectMail(env, prospect.email, mail.subject, mail.text, mail.html);
  const notice = senderNotice("cancelled", prospect, prospect.meeting_at ? formatMeeting(prospect.meeting_at, bookingZone(env)) : null);
  await sendProspectMail(env, prospect.invited_by_email, notice.subject, notice.text, null);
  return json({ cancelled: true });
}

// Adds a person with platform roles, or replaces the roles of someone already listed.
async function addStaff(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const actor = await platformRolesFor(env, auth.user.email);
  if (!canInvite(actor)) return json({ error: "Only staff who can invite may add people." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "Enter a valid email address." }, 400);
  const roles = Array.isArray(body.roles) ? [...new Set(body.roles)] : [];
  if (!roles.length || !roles.every((r) => PLATFORM_ROLES.includes(r))) {
    return json({ error: `Choose at least one role: ${PLATFORM_ROLES.join(", ")}.` }, 400);
  }
  if (isOperator(env, email)) return json({ error: "This person is already a super user." }, 400);
  const now = await serviceRest(env, `staff?email=eq.${encodeURIComponent(email)}&select=roles`);
  if (!now.ok) return json({ error: "Could not check the staff list." }, 502);
  const existing = (await now.json())[0];
  if (!canSetRoles(actor, (existing && existing.roles) || [], roles)) {
    return json({ error: "You can invite demo users with the sales or support role only." }, 403);
  }
  const res = await serviceRest(env, "staff?on_conflict=email", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ email, roles, added_by: auth.user.id }),
  });
  if (!res.ok) return json({ error: "Could not save the staff member." }, 502);
  return json({ email, roles }, 201);
}

async function removeStaff(request, env, email) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  if (!(await platformRolesFor(env, auth.user.email)).includes("super_user")) return json({ error: "Only super users can remove staff." }, 403);
  const clean = normalizeEmail(email);
  if (!clean) return json({ error: "Not found." }, 404);
  const res = await serviceRest(env, `staff?email=eq.${encodeURIComponent(clean)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (!res.ok) return json({ error: "Could not remove the staff member." }, 502);
  return json({ removed: true });
}

// ---- Google Calendar for staff: each person connects their own calendar, so bookings land on it ----
// Only the free and busy times and the events Cutover creates are used. Event details are never read.
const CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];
const CALENDAR_STATE_MS = 15 * 60 * 1000;

function calendarConfigured(env) {
  return !!(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET && env.CUTOVER_KEY_ENCRYPTION_KEY);
}

function base64UrlFrom(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The OAuth state says who started the connection, is signed, and expires after 15 minutes.
async function calendarStateKey(env) {
  const raw = base64ToBytes(env.CUTOVER_KEY_ENCRYPTION_KEY);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function signCalendarState(env, userId) {
  const payload = `${userId}.${Date.now() + CALENDAR_STATE_MS}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await calendarStateKey(env), new TextEncoder().encode(payload)));
  return `${payload}.${base64UrlFrom(sig)}`;
}

async function readCalendarState(env, state) {
  const parts = String(state || "").split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, sig] = parts;
  if (!UUID_PATTERN.test(userId) || !(Number(expires) >= Date.now())) return null;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await calendarStateKey(env), new TextEncoder().encode(`${userId}.${expires}`)));
  return base64UrlFrom(mac) === sig ? userId : null;
}

// Who may connect a calendar: the people who invite. Anyone else gets nothing here.
async function calendarCaller(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return { response: auth.response };
  const roles = await platformRolesFor(env, auth.user.email);
  if (!canInvite(roles)) return { response: json({ error: "Only staff who can invite may use a calendar." }, 403) };
  return { user: auth.user };
}

async function calendarStatus(request, env) {
  const caller = await calendarCaller(request, env);
  if (caller.response) return caller.response;
  const res = await serviceRest(env, `calendar_connections?user_id=eq.${caller.user.id}&select=email,connected_at`);
  if (!res.ok) return json({ error: "Could not read your calendar connection." }, 502);
  const row = (await res.json())[0];
  return json({
    configured: calendarConfigured(env),
    connected: !!row,
    email: row ? row.email : null,
    connected_at: row ? row.connected_at : null,
  });
}

async function calendarConnectUrl(request, env) {
  const caller = await calendarCaller(request, env);
  if (caller.response) return caller.response;
  if (!calendarConfigured(env)) {
    return json({ error: "The calendar connection is not set up yet. A super user needs to add the Google client details first." }, 503);
  }
  const redirect = `${new URL(request.url).origin}/api/calendar/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "code",
    scope: CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: await signCalendarState(env, caller.user.id),
  });
  return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
}

// Google sends the browser here after consent. The state names the person, so the connection is theirs.
async function calendarCallback(request, env) {
  const back = (result, reason) => {
    const origin = env.APP_ORIGIN || "";
    const query = `#calendar=${result}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`;
    return Response.redirect(`${origin}/${query}`, 302);
  };
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return back("error", "denied");
  if (!calendarConfigured(env)) return back("error", "not-set-up");
  const userId = await readCalendarState(env, url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!userId || !code) return back("error", "expired");

  const redirect = `${url.origin}/api/calendar/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    }).toString(),
  }).catch(() => null);
  if (!tokenRes || !tokenRes.ok) return back("error", "failed");
  const token = await tokenRes.json();
  if (!token.refresh_token) return back("error", "no-long-term-access");
  const granted = String(token.scope || "").split(" ");
  if (!granted.includes("https://www.googleapis.com/auth/calendar.events") || !granted.includes("https://www.googleapis.com/auth/calendar.freebusy")) {
    return back("error", "permissions");
  }

  const who = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token.access_token}` } }).catch(() => null);
  const email = who && who.ok ? normalizeEmail((await who.json()).email) : null;
  if (!email) return back("error", "failed");

  const key = await encryptionKey(env);
  if (!key) return back("error", "not-set-up");
  const sealed = await encryptModelKey(key, token.refresh_token);
  const saved = await serviceRest(env, "calendar_connections?on_conflict=user_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, email, ciphertext: sealed.ciphertext, iv: sealed.iv, scope: granted.join(" "), connected_at: new Date().toISOString() }),
  });
  if (!saved.ok) return back("error", "failed");
  return back("connected");
}

async function calendarDisconnect(request, env) {
  const caller = await calendarCaller(request, env);
  if (caller.response) return caller.response;
  const found = await serviceRest(env, `calendar_connections?user_id=eq.${caller.user.id}&select=ciphertext,iv`);
  const row = found.ok ? (await found.json())[0] : null;
  // Best effort: ask Google to revoke the permission, then forget the stored token either way.
  const key = row && (await encryptionKey(env));
  if (row && key) {
    const refresh = await decryptModelKey(key, row).catch(() => null);
    if (refresh) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh }).toString(),
      }).catch(() => {});
    }
  }
  const res = await serviceRest(env, `calendar_connections?user_id=eq.${caller.user.id}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  if (!res.ok) return json({ error: "Could not disconnect the calendar." }, 502);
  return json({ disconnected: true });
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

const FREE_TIER_DATABASE_BYTES = 490 * 1024 * 1024;

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
  // The owner id is not sent. is_mine says whether the analysis is yours; can_delete says whether you may delete it.
  const isAdmin = access.member.is_admin === true;
  return json(rows.map(({ owner_id, ...rest }) => {
    const isMine = owner_id === access.user.id;
    return { ...rest, is_mine: isMine, can_delete: isMine || isAdmin };
  }));
}

// ---- Insights: what the workspace has done with Cutover, counted from the records it already keeps. ----
// Counts only: no code, findings or names of people. AI jobs come from the action log, which is trimmed as it grows.
async function workspaceInsights(request, env) {
  const url = new URL(request.url);
  const access = await workspaceAccess(env, request, url.searchParams.get("workspace") || "");
  if (access.response) return access.response;
  const wid = access.workspace_id;
  const countOf = async (path) => {
    const res = await serviceRest(env, path, { method: "GET", headers: { prefer: "count=exact", range: "0-0" } });
    if (!res.ok) return null;
    const total = Number((res.headers.get("content-range") || "").split("/")[1]);
    return Number.isFinite(total) ? total : null;
  };
  const listOf = async (path) => {
    const res = await serviceRest(env, path);
    return res.ok ? await res.json() : null;
  };
  const analyses = await listOf(`analyses?workspace_id=eq.${wid}&select=id,repo,status,created_at,finished_at,model_provider&order=created_at.desc&limit=2000`);
  if (!analyses) return json({ error: "Could not load the insights." }, 502);
  const conversions = (await listOf(`analysis_conversions?select=status,decision,analyses!inner(workspace_id)&analyses.workspace_id=eq.${wid}&limit=5000`)) || [];
  const groupings = (await listOf(`feature_groupings?select=groups,analyses!inner(workspace_id)&analyses.workspace_id=eq.${wid}&status=eq.approved&limit=500`)) || [];
  const filesAssessed = await countOf(`file_findings?select=id,analyses!inner(workspace_id)&analyses.workspace_id=eq.${wid}`);
  const aiJobs = await countOf(`assessment_log?workspace_id=eq.${wid}&action=in.(business_finish,grouping_finish,stories_finish,deep_file_finish)&select=id`);

  const complete = analyses.filter((a) => a.status === "complete");
  const minutes = complete
    .filter((a) => a.finished_at)
    .map((a) => (Date.parse(a.finished_at) - Date.parse(a.created_at)) / 60000)
    .filter((m) => m > 0 && m < 24 * 60)
    .sort((a, b) => a - b);
  const median = minutes.length ? Math.round(minutes[Math.floor(minutes.length / 2)] * 10) / 10 : null;
  const hoursOfRuns = Math.round((minutes.reduce((sum, m) => sum + m, 0) / 60) * 10) / 10;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    trend.push({ day: d.toISOString().slice(0, 10), count: 0 });
  }
  for (const a of analyses) {
    const hit = trend.find((t) => t.day === String(a.created_at).slice(0, 10));
    if (hit) hit.count += 1;
  }

  // Time spent in this workspace: the team's total, and the caller's own. Only totals, no names.
  const timeRows = (await listOf(`workspace_time?workspace_id=eq.${wid}&select=user_id,seconds`)) || [];
  const hours = (sec) => Math.round((sec / 3600) * 10) / 10;
  const teamSeconds = timeRows.reduce((sum, r) => sum + Number(r.seconds || 0), 0);
  const yourSeconds = timeRows.filter((r) => r.user_id === access.user.id).reduce((sum, r) => sum + Number(r.seconds || 0), 0);
  const people = new Set(timeRows.filter((r) => Number(r.seconds) > 0).map((r) => r.user_id)).size;

  const stories = groupings.reduce((sum, g) => sum + (Array.isArray(g.groups) ? g.groups.reduce((n, f) => n + (Array.isArray(f.stories) ? f.stories.length : 0), 0) : 0), 0);
  const accepted = conversions.filter((c) => c.decision === "accepted").length;
  const rejected = conversions.filter((c) => c.decision === "rejected").length;
  const ok = conversions.filter((c) => c.status === "ok").length;

  return json({
    generated_at: new Date().toISOString(),
    totals: {
      analyses: analyses.length,
      codes_assessed: complete.length,
      repositories: new Set(analyses.map((a) => a.repo)).size,
      files_assessed: filesAssessed,
      ai_analyses: complete.filter((a) => a.model_provider).length,
      ai_jobs: aiJobs,
      user_stories: stories,
    },
    conversions: { produced: ok, accepted, rejected, waiting: Math.max(0, ok - accepted - rejected) },
    time: {
      median_minutes: median,
      hours_of_runs: hoursOfRuns,
      team_hours_here: hours(teamSeconds),
      your_hours_here: hours(yourSeconds),
      people_here: people,
    },
    trend,
  });
}

// ---- Notifications: saved per person, shown by the portal's bell. Writing one never fails the action that caused it. ----
const NOTIFY_TONES = ["info", "success", "warning", "danger", "ai"];
const NOTIFY_KINDS = [
  "analysis_started", "analysis_complete", "analysis_failed", "privacy_signed_off", "privacy_withdrawn",
  "model_key_added", "model_key_removed", "comment_added", "action_added", "action_done", "retention_deleted",
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

// ---- One assessment at a time in a workspace, and the action log ----

// A run that has not finished within this time is stopped, so a run that never reports cannot block the workspace.
const STALE_RUN_MS = 3 * 60 * 60 * 1000;
const LOCK_TEXT = "Only one assessment runs at a time in a workspace. Wait for the one that is running to finish, then try again.";

// Writes one row to the action log (assessment_log). Returns false if it could not be saved.
async function recordAction(env, entry) {
  const res = await serviceRest(env, "assessment_log", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      workspace_id: entry.workspace_id,
      actor_user_id: entry.user ? entry.user.id : null,
      actor_email: entry.user && entry.user.email ? normalizeEmail(entry.user.email) : null,
      action: entry.action,
      analysis_id: entry.analysis_id || null,
      repo: entry.repo || null,
      commit_sha: entry.commit_sha || null,
      detail: entry.detail ? String(entry.detail).slice(0, 300) : null,
    }),
  });
  return res.ok;
}

// Writes the log entry for an action before the action is done. If it cannot be written, the action does not happen.
async function logFirst(env, entry) {
  if (await recordAction(env, entry)) return null;
  return json({ error: "The action could not be written to the log, so nothing was done. Try again in a minute." }, 503);
}

// Stops runs in the workspace that have gone on too long. Each stop is logged first; if the log fails, the stop does not happen.
async function stopStaleRuns(env, workspaceId) {
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const stale = await serviceRest(env, `analyses?workspace_id=eq.${workspaceId}&status=in.(queued,running)&created_at=lt.${cutoff}&select=id,repo`);
  if (!stale.ok) throw new Error("Could not check the runs.");
  for (const r of await stale.json()) {
    if (!(await recordAction(env, { workspace_id: workspaceId, action: "stale_stop", analysis_id: r.id, repo: r.repo, detail: "Did not finish within three hours." }))) {
      throw new Error("Could not record the stop.");
    }
    const res = await serviceRest(env, `analyses?id=eq.${r.id}&status=in.(queued,running)`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", error: "Stopped: the run did not finish within three hours.", finished_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error("Could not stop the run.");
  }
}

// The assessment or file conversion that holds this workspace, or null when it is free.
// Throws if the check itself fails, so the caller refuses rather than guessing.
async function busyRun(env, workspaceId, exceptAnalysisId = null) {
  await stopStaleRuns(env, workspaceId);
  const runs = await serviceRest(env, `analyses?workspace_id=eq.${workspaceId}&status=in.(queued,running)&select=id,app_name,repo,created_at&limit=5`);
  if (!runs.ok) throw new Error("Could not check the runs.");
  const other = (await runs.json()).find((r) => r.id !== exceptAnalysisId);
  if (other) return { kind: "assessment", name: other.app_name || other.repo, repo: other.repo, started: other.created_at };
  const conversions = await serviceRest(env, `analysis_conversions?status=eq.queued&select=path,created_at,analyses!inner(workspace_id,app_name,repo)&analyses.workspace_id=eq.${workspaceId}&limit=1`);
  if (!conversions.ok) throw new Error("Could not check the conversions.");
  const [conv] = await conversions.json();
  if (conv) return { kind: "conversion", name: conv.analyses.app_name || conv.analyses.repo, repo: conv.analyses.repo, path: conv.path, started: conv.created_at };
  // A business assessment of one file counts as a run until the runner answers, or until it is stale.
  const businessCutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const business = await serviceRest(env, `file_business_assessments?review_status=eq.running&created_at=gt.${businessCutoff}&select=path,created_at,analyses!inner(workspace_id,app_name,repo)&analyses.workspace_id=eq.${workspaceId}&limit=1`);
  if (!business.ok) throw new Error("Could not check the business assessments.");
  const [biz] = await business.json();
  if (biz) return { kind: "business", name: biz.analyses.app_name || biz.analyses.repo, repo: biz.analyses.repo, path: biz.path, started: biz.created_at };
  // A feature grouping counts as a run until the runner answers, or until it is stale.
  const groupingCutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const grouping = await serviceRest(env, `feature_groupings?status=eq.running&created_at=gt.${groupingCutoff}&select=created_at,analyses!inner(workspace_id,app_name,repo)&analyses.workspace_id=eq.${workspaceId}&limit=1`);
  if (!grouping.ok) throw new Error("Could not check the groupings.");
  const [grp] = await grouping.json();
  if (grp) return { kind: "grouping", name: grp.analyses.app_name || grp.analyses.repo, repo: grp.analyses.repo, started: grp.created_at };
  // A deep file assessment counts as a run until the runner answers, or until it is stale.
  const deepCutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
  const deep = await serviceRest(env, `file_deep_assessments?status=eq.running&created_at=gt.${deepCutoff}&select=file_path,created_at,analyses!inner(workspace_id,app_name,repo)&analyses.workspace_id=eq.${workspaceId}&limit=1`);
  if (!deep.ok) throw new Error("Could not check the deep file assessments.");
  const [dp] = await deep.json();
  if (dp) return { kind: "deep", name: dp.analyses.app_name || dp.analyses.repo, repo: dp.analyses.repo, path: dp.file_path, started: dp.created_at };
  return null;
}

function busyResponse(busy) {
  const what = busy.kind === "conversion"
    ? `A file conversion is running in this workspace: ${busy.path} in ${busy.name}.`
    : busy.kind === "business"
      ? `A business assessment of one file is running in this workspace: ${busy.path} in ${busy.name}.`
      : busy.kind === "grouping"
        ? `A grouping is running in this workspace: ${busy.name}.`
        : busy.kind === "deep"
          ? `A deep file assessment is running in this workspace: ${busy.path} in ${busy.name}.`
        : `Another assessment is running in this workspace: ${busy.name}${busy.repo && busy.repo !== busy.name ? ` (${busy.repo})` : ""}.`;
  return json({ error: `${what} ${LOCK_TEXT}`, busy: { kind: busy.kind, name: busy.name, repo: busy.repo, started: busy.started || null } }, 409);
}

// Returns a response to send back when the workspace is busy, or null when the run may go ahead.
async function refuseIfBusy(env, user, workspaceId, repo, exceptAnalysisId = null) {
  let busy;
  try {
    busy = await busyRun(env, workspaceId, exceptAnalysisId);
  } catch {
    return json({ error: "Could not check the workspace right now. Try again in a minute." }, 502);
  }
  if (!busy) return null;
  await recordAction(env, { workspace_id: workspaceId, user, action: "lock_refused", repo, detail: `${busy.kind} running: ${busy.name}` });
  return busyResponse(busy);
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

  const busyResp = await refuseIfBusy(env, auth.user, access.workspace_id, repo);
  if (busyResp) return busyResp;

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

  const id = crypto.randomUUID();
  const refused = await logFirst(env, { workspace_id: access.workspace_id, user: auth.user, action: "start", analysis_id: id, repo, detail: model ? "AI model" : "Rules only" });
  if (refused) return refused;
  const created = await serviceRest(env, "analyses", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      id,
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
  if (created.status === 409) return json({ error: `Another assessment is starting in this workspace. ${LOCK_TEXT}` }, 409);
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
    await recordAction(env, { workspace_id: access.workspace_id, user: auth.user, action: "fail", analysis_id: row.id, repo, detail: "The runner could not be started." });
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
  const busyResp = await refuseIfBusy(env, auth.user, access.workspace_id, UPLOAD_REPO);
  if (busyResp) return busyResp;

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
  const refused = await logFirst(env, { workspace_id: access.workspace_id, user: auth.user, action: "start", analysis_id: id, repo: UPLOAD_REPO, detail: model ? "AI model, uploaded code" : "Rules only, uploaded code" });
  if (refused) return refused;
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
    if (created.status === 409) return json({ error: `Another assessment is starting in this workspace. ${LOCK_TEXT}` }, 409);
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
    await recordAction(env, { workspace_id: access.workspace_id, user: auth.user, action: "fail", analysis_id: row.id, repo: UPLOAD_REPO, detail: message });
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
function dispatchRunner(env, inputs, workflow = "analyze.yml") {
  return fetch(`https://api.github.com/repos/${env.RUNNER_REPO}/actions/workflows/${workflow}/dispatches`, {
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

  const busyResp = await refuseIfBusy(env, access.user, row.workspace_id, row.repo, id);
  if (busyResp) return busyResp;

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

  const refused = await logFirst(env, { workspace_id: row.workspace_id, user: access.user, action: "rerun", analysis_id: id, repo: row.repo, detail: row.model_key_id ? "AI model" : "Rules only" });
  if (refused) return refused;
  // Approved and edited file results stay until they are replaced. Only the drafts are cleared.
  for (const filter of [`file_findings?analysis_id=eq.${id}&review_status=eq.draft`, `analysis_screens?analysis_id=eq.${id}`]) {
    const cleared = await serviceRest(env, filter, { method: "DELETE", headers: { prefer: "return=minimal" } });
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
    await recordAction(env, { workspace_id: row.workspace_id, user: access.user, action: "fail", analysis_id: id, repo: row.repo, detail: "The runner could not be started." });
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

// Draws the screens of a finished analysis again, with the same model and the same code, without a new assessment.
// The findings, the file purposes and the status stay as they are. Only the drawn screens are replaced, and only
// when the new run saves some. The workspace must still allow screens from the model.
async function redrawScreens(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can draw the screens again." }, 403);
  const row = access.row;
  if (row.status !== "complete" && row.status !== "failed") {
    return json({ error: "This analysis is still running." }, 409);
  }
  if (row.source_kind === "upload") {
    return json({ error: "The uploaded code was deleted after the first run. Upload the code again to draw the screens." }, 409);
  }
  if (!row.model_key_id) {
    return json({ error: "This assessment was made without a model, so there are no screens to draw." }, 409);
  }
  if (!(await workspaceDrawsScreens(env, row.workspace_id))) {
    return json({ error: "Turn on screens from the model in the Privacy tab, under Language model, first." }, 409);
  }

  const busyResp = await refuseIfBusy(env, access.user, row.workspace_id, row.repo, id);
  if (busyResp) return busyResp;

  const chosen = await chooseAnalysisModel(env, row.workspace_id, row.model_key_id);
  if (chosen.response) return chosen.response;
  const modelToken = (await issueModelToken(env, row.id, chosen.key.id)) || "";
  if (!modelToken) return json({ error: "Could not prepare the model for the run. Try again in a minute." }, 502);

  const refused = await logFirst(env, { workspace_id: row.workspace_id, user: access.user, action: "redraw_screens", analysis_id: id, repo: row.repo, detail: "AI model" });
  if (refused) return refused;

  // The page shows the drawing while this is set. The runner clears it when it has finished (screens-done).
  const marked = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ screens_started_at: new Date().toISOString() }),
  });
  if (!marked.ok) return json({ error: "Could not start the screens run. Try again in a minute." }, 502);

  const dispatch = await dispatchRunner(env, { analysis_id: row.id, repo: row.repo, ref: row.ref || "", model_token: modelToken, draw_screens: true }, "screens.yml");
  if (!dispatch.ok) {
    await serviceRest(env, `analyses?id=eq.${id}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ screens_started_at: null }) });
    return json({ error: "Could not start the screens run. Try again in a minute." }, 502);
  }
  return json({ id, status: row.status, screens: "drawing" }, 202);
}

// The branch's current commit, asked of GitHub at most every six hours per analysis. If GitHub cannot say,
// nothing is changed and the results are not marked out of date.
const HEAD_CHECK_MS = 6 * 60 * 60 * 1000;
async function refreshHead(env, row) {
  if (row.status !== "complete" || !row.repo || row.repo === UPLOAD_REPO) return;
  if (row.head_checked_at && Date.now() - Date.parse(row.head_checked_at) < HEAD_CHECK_MS) return;
  let head = null;
  try {
    const token = await readToken(env, row.repo);
    if (!token.token) return;
    const url = `https://api.github.com/repos/${row.repo}/commits?per_page=1${row.ref ? `&sha=${encodeURIComponent(row.ref)}` : ""}`;
    const res = await fetch(url, { headers: { ...GH_HEADERS, authorization: `Bearer ${token.token}` } });
    if (!res.ok) return;
    const [commit] = await res.json();
    head = commit && typeof commit.sha === "string" ? commit.sha.slice(0, 64) : null;
  } catch {
    return;
  }
  if (!head) return;
  const now = new Date().toISOString();
  await serviceRest(env, `analyses?id=eq.${row.id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ head_sha: head, head_checked_at: now }),
  });
  row.head_sha = head;
  row.head_checked_at = now;
}

async function getAnalysis(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const { row, member, user } = access;
  await refreshHead(env, row);
  await noteOpened(env, row);

  const [commentsRes, actionsRes, contingenciesRes, peopleRes] = await Promise.all([
    serviceRest(env, `analysis_comments?analysis_id=eq.${id}&select=id,author_id,author_email,body,created_at&order=created_at.asc`),
    serviceRest(env, `action_items?analysis_id=eq.${id}&select=id,title,status,created_by_email,done_by_email,created_at,done_at&order=created_at.asc`),
    serviceRest(env, `contingencies?analysis_id=eq.${id}&select=id,finding_id,risk,contingency,rollback_step,trigger_condition,owner_email,status,created_by_email,updated_by_email,created_at,updated_at&order=created_at.asc`),
    serviceRest(env, `members?workspace_id=eq.${row.workspace_id}&select=user_id,email,name`),
  ]);
  if (!commentsRes.ok || !actionsRes.ok || !contingenciesRes.ok) {
    return json({ error: "Could not load the analysis." }, 502);
  }
  // The names of this workspace's members, by email, so each step can show who did it.
  const people = {};
  const memberRows = peopleRes.ok ? await peopleRes.json() : [];
  for (const m of memberRows) if (m.email && m.name) people[String(m.email).toLowerCase()] = m.name;
  // The person who started the analysis, who completes the assessment.
  const starter = memberRows.find((m) => m.user_id === row.owner_id);
  const startedBy = starter && starter.email ? starter.email : null;

  const isAdmin = member.is_admin === true;
  const { owner_id, findings, ...analysis } = row;
  analysis.out_of_date = Boolean(analysis.commit_sha && analysis.head_sha && analysis.head_sha !== analysis.commit_sha);
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
    // The scope and the modernized approach are the owner's or a CIO's or CTO's choice; the engineer carries them out.
    can_choose_direction: canApproveTarget(row, member, user),
    stages: stageStates(row, user.id),
    comments,
    action_items: await actionsRes.json(),
    contingencies: await contingenciesRes.json(),
    people,
    started_by_email: startedBy,
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

// Saves the screens for one analysis. By default it replaces the screens saved before; with mode "add" it keeps them
// and saves only the paths that have none yet (a redraw). Only for a queued, running or finished analysis.
async function runnerScreens(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const found = await serviceRest(env, `analyses?id=eq.${id}&select=id,status`);
  if (!found.ok) return json({ error: "Could not load the analysis." }, 502);
  const [analysis] = await found.json();
  if (!analysis) return json({ error: "Not found." }, 404);
  // A screens-only run (see redrawScreens) saves its screens on a finished analysis.
  if (!["queued", "running", "complete", "failed"].includes(analysis.status)) {
    return json({ error: "This analysis is no longer taking results." }, 409);
  }
  const parsed = await readJson(request, 4_000_000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const list = parsed.value?.screens;
  if (!Array.isArray(list) || list.length === 0 || list.length > SCREEN_MAX) {
    return json({ error: `Send 1 to ${SCREEN_MAX} screens.` }, 400);
  }
  // A redraw ("add") keeps the screens already on the card and saves only the paths that have none yet.
  const adding = parsed.value?.mode === "add";
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
  let toSave = rows;
  if (adding) {
    const have = await serviceRest(env, `analysis_screens?analysis_id=eq.${id}&select=path`);
    if (!have.ok) return json({ error: "Could not save the screens." }, 502);
    const saved = new Set((await have.json()).map((r) => r.path));
    toSave = rows.filter((r) => !saved.has(r.path));
    if (toSave.length === 0) return json({ saved: 0 }, 201);
  } else {
    const cleared = await serviceRest(env, `analysis_screens?analysis_id=eq.${id}`, { method: "DELETE" });
    if (!cleared.ok) return json({ error: "Could not save the screens." }, 502);
  }
  const made = await serviceRest(env, "analysis_screens", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(toSave) });
  if (!made.ok) return json({ error: "Could not save the screens." }, 502);
  return json({ saved: toSave.length }, 201);
}

// Removes one drawn screen, for example one that came out empty. Only platform engineers. The removal is logged first.
// A later redraw draws the file again if it has no screen.
async function deleteScreen(request, env, id, screenId) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can delete a screen." }, 403);
  const found = await serviceRest(env, `analysis_screens?id=eq.${screenId}&analysis_id=eq.${id}&select=id,name`);
  if (!found.ok) return json({ error: "Could not load the screen." }, 502);
  const [screen] = await found.json();
  if (!screen) return json({ error: "Not found." }, 404);
  const refused = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "screen_delete", analysis_id: id, repo: access.row.repo, detail: screen.name });
  if (refused) return refused;
  const res = await serviceRest(env, `analysis_screens?id=eq.${screenId}&analysis_id=eq.${id}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  if (!res.ok) return json({ error: "Could not delete the screen." }, 502);
  return json({ deleted: true, name: screen.name });
}

// The paths that already have a screen, so a redraw draws only the files without one. The runner's shared secret.
async function runnerScreenPaths(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const res = await serviceRest(env, `analysis_screens?analysis_id=eq.${id}&select=path`);
  if (!res.ok) return json({ error: "Could not load the screens." }, 502);
  const rows = await res.json();
  return json({ paths: rows.map((r) => r.path) }, 200);
}

// The runner reports that a screens run has finished, whether or not it drew any. Clears the drawing state.
async function runnerScreensDone(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const cleared = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ screens_started_at: null }),
  });
  if (!cleared.ok) return json({ error: "Could not record the end of the run." }, 502);
  return json({ done: true }, 200);
}

async function deleteAnalysis(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const isOwner = access.row.owner_id === access.user.id;
  if (!isOwner && !access.member.is_admin) {
    return json({ error: "Only the person who started this analysis or a workspace admin can delete it." }, 403);
  }
  // A run that is still working on the code cannot be removed under it.
  if (access.row.status === "queued" || access.row.status === "running") {
    return json({ error: "This analysis is still running. Delete it once the run has finished." }, 409);
  }
  const refused = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "delete", analysis_id: id, repo: access.row.repo, detail: isOwner ? "By the owner" : "By a workspace admin" });
  if (refused) return refused;
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
  if (!scopeIncludes(access.row.scope, "migrate")) return json({ error: "Choose Migrate as the next stage first." }, 409);
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
  if (!scopeIncludes(access.row.scope, "migrate")) return json({ error: "Choose Migrate as the next stage first." }, 409);
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
  if (!scopeIncludes(row.scope, "migrate")) return json({ error: "Choose Migrate as the next stage first." }, 409);
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

// The scope is chosen before the deeper assessment runs. Each choice is the deeper assessment plus the stages it names.
const SCOPES = {
  deeper: [],
  deeper_modernize: ["modernize"],
  deeper_migrate: ["migrate"],
  deeper_modernize_migrate: ["modernize", "migrate"],
};
const SCOPE_LABELS = {
  deeper: "Deeper assessment",
  deeper_modernize: "Deeper assessment and Modernize",
  deeper_migrate: "Deeper assessment and Migrate",
  deeper_modernize_migrate: "Deeper assessment, Modernize and Migrate",
};
// True when the chosen scope includes the stage ("modernize" or "migrate").
function scopeIncludes(scope, stage) {
  return Object.prototype.hasOwnProperty.call(SCOPES, scope) && SCOPES[scope].includes(stage);
}

// Saves the next stage for one analysis. Modernize and Migrate wait for the deeper assessment to finish.
// Which scopes fit an approach. Modernize goes with the web front end only; Migrate goes with the other two.
// Until an approach is chosen, every scope fits.
function scopeFitsApproach(scope, template) {
  if (!scope || !template) return true;
  const modern = template === "web-modern";
  if (scopeIncludes(scope, "modernize")) return modern;
  if (scopeIncludes(scope, "migrate")) return !modern;
  return true;
}

async function setScope(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  // Open to every member of the workspace for now, while the scope is decided. Limiting it to the application
  // owner, a CIO or a CTO is to be decided later.
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  // null clears the scope, so the team can start the choice again.
  const scope = parsed.value && parsed.value.scope;
  const clearing = scope === null;
  if (!clearing && !Object.prototype.hasOwnProperty.call(SCOPES, scope)) {
    return json({ error: "Choose deeper, deeper and modernize, deeper and migrate, or all three." }, 400);
  }
  if (!clearing && !scopeFitsApproach(scope, access.row.modern_template)) {
    return json({ error: "This scope does not fit the approach you chose." }, 409);
  }
  const refused = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "scope", analysis_id: id, repo: access.row.repo, detail: clearing ? "cleared" : scope });
  if (refused) return refused;
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ scope, scope_set_by_email: clearing ? null : access.user.email, scope_set_at: clearing ? null : new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "Could not save the scope." }, 502);
  if (clearing) return json({ saved: true });
  const labels = SCOPE_LABELS;
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
  // Open to every workspace member for now, while the flow is designed. The rules are to be enforced later.
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const template = parsed.value && parsed.value.template;
  if (!MODERN_TEMPLATES.includes(template)) {
    return json({ error: "Choose web-modern, services-data or lift-contain." }, 400);
  }
  if (!scopeFitsApproach(access.row.scope, template)) {
    return json({ error: "The scope you chose does not fit this approach. Clear the scope first." }, 409);
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
  if (!scopeIncludes(access.row.scope, "modernize")) return json({ error: "Choose Modernize as the next stage first." }, 409);
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
  { id: "assessment", title: "Application Assessment", produces: "What the application is, how it is built and what data it holds, from the code." },
  { id: "approach", title: "Choose the approach", produces: "The modernized approach the team agrees on, from the three proposals.", needs: "assessment" },
  { id: "scope", title: "Choose the scope", produces: "The work this analysis covers: the deeper assessment, Modernize, Migrate, or a mix of them.", needs: "approach" },
  { id: "plan", title: "Project plan", produces: "The plan for this analysis: the order of work, the risks and a rough size, from the findings and the scope.", needs: "scope" },
  { id: "deeper", title: "Deeper assessment", produces: "The architecture, the sections and the documents for this application.", needs: "plan" },
  { id: "starter", title: "Starter project", produces: "A zip with the skeleton for the chosen template, with no copied business logic.", needs: "deeper" },
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

// The modernization stages. Without Modernize in the scope they are not part of the work: they are skipped, and do not block.
// The plan is part of every scope, so it is not skipped. It holds up the deeper assessment and the stages after it.
const MODERNIZE_STAGES = ["approach", "starter", "convert", "pr"];

// The state of every stage for one analysis, as the viewer sees it. Computed here so every screen agrees.
function stageStates(row, viewerId) {
  const saved = progressOf(row);
  const done = {};
  // Until a scope is chosen nothing is skipped.
  const modernizeInScope = !row.scope || scopeIncludes(row.scope, "modernize");
  return PROGRESS_STAGES.map((stage) => {
    const prior = stage.needs ? PROGRESS_STAGES.find((s) => s.id === stage.needs) : null;
    const record = saved[stage.id] && typeof saved[stage.id] === "object" ? saved[stage.id] : null;
    const hasWork = stage.id === "approach" ? Boolean(row.modern_template) : Boolean(record && record.reviewed_at);
    if (!modernizeInScope && MODERNIZE_STAGES.includes(stage.id) && !hasWork) {
      done[stage.id] = true;
      return {
        id: stage.id, title: stage.title, produces: stage.produces, state: "skipped", ready: false,
        unlocked_by: prior ? prior.id : null, lock_reason: null, cleared_by: null, cleared_at: null, celebrate: false,
      };
    }
    const cleared = stage.id === "assessment"
      ? row.status === "complete"
      : stage.id === "scope"
        ? Boolean(row.scope)
      : stage.id === "approach"
        ? Boolean(row.modern_template)
        : stage.id === "deeper"
          ? row.deeper_done === true
          : Boolean(record && record.reviewed_at);
    // Who cleared the stage and when: the approach and scope were chosen by someone; the assessment and deeper
    // assessment finish when the analysis does; the rest are reviews.
    const origin = stage.id === "approach"
      ? { by: row.modern_template_set_by_email, at: row.modern_template_set_at }
      : stage.id === "scope"
        ? { by: row.scope_set_by_email, at: row.scope_set_at }
        : stage.id === "assessment" || stage.id === "deeper"
          ? { by: null, at: row.finished_at }
          : { by: record ? record.reviewed_by : null, at: record ? record.reviewed_at : null };
    // A stage waits for the first earlier stage that is not done yet, so the path cannot be skipped over.
    const blocker = PROGRESS_STAGES.slice(0, PROGRESS_STAGES.indexOf(stage)).find((s) => done[s.id] !== true) || null;
    done[stage.id] = cleared;
    const state = cleared ? "cleared" : blocker ? "locked" : "available";
    const acked = Array.isArray((saved.acknowledged || {})[viewerId]) && saved.acknowledged[viewerId].includes(stage.id);
    return {
      id: stage.id,
      title: stage.title,
      produces: stage.produces,
      state,
      ready: PROGRESS_READY[stage.id] === true,
      unlocked_by: blocker ? blocker.id : null,
      lock_reason: state === "locked" ? `Clear ${blocker.title} to unlock ${stage.title}.` : null,
      cleared_by: cleared ? origin.by || null : null,
      cleared_at: cleared ? origin.at || null : null,
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
    if (target.state === "skipped") return json({ error: "This stage is not in the scope you chose." }, 409);
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

// The original file at the analysed commit, for the side-by-side view. Read only when asked, and never stored.
async function conversionOriginal(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const url = new URL(request.url);
  const path = (url.searchParams.get("path") || "").trim();
  if (!CONVERT_PATH.test(path) || path.split("/").includes("..")) return json({ error: "Choose a file from this analysis." }, 400);
  const row = access.row;
  if (!row.repo || !row.commit_sha) return json({ error: "The original is not available for this analysis." }, 409);
  const known = await serviceRest(env, `analysis_conversions?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&select=id&limit=1`);
  if (!known.ok) return json({ error: "Could not check the file." }, 502);
  if (!(await known.json()).length) return json({ error: "That file has no conversion in this analysis." }, 400);
  const readable = await readToken(env, row.repo);
  if (readable.notInstalled || readable.failed) return json({ error: "Cutover cannot read the original right now. Try again in a minute." }, 502);
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`https://api.github.com/repos/${row.repo}/contents/${encoded}?ref=${encodeURIComponent(row.commit_sha)}`, {
    headers: { ...GH_HEADERS, authorization: `Bearer ${readable.token}`, accept: "application/vnd.github.raw" },
  });
  if (!res.ok) return json({ error: "The original could not be read at this commit." }, 502);
  const text = await res.text();
  if (text.length > 400000) return json({ error: "This file is too large to compare here. Open it on GitHub." }, 413);
  return json({ path, commit_sha: row.commit_sha, text });
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
  if (!row.target_language) return json({ error: "Choose the target language first." }, 409);
  if (!scopeIncludes(row.scope, "modernize")) return json({ error: "Choose Modernize as the next stage first." }, 409);
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

  const busyResp = await refuseIfBusy(env, access.user, row.workspace_id, row.repo);
  if (busyResp) return busyResp;
  const modelToken = (await issueModelToken(env, id, row.model_key_id)) || "";
  if (!modelToken) return json({ error: "Could not prepare the model. Try again in a minute." }, 502);
  const refusedConv = await logFirst(env, { workspace_id: row.workspace_id, user: access.user, action: "convert_start", analysis_id: id, repo: row.repo, detail: path });
  if (refusedConv) return refusedConv;
  await serviceRest(env, `analysis_conversions?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  const made = await serviceRest(env, "analysis_conversions", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ analysis_id: id, path, template: row.modern_template, status: "queued", requested_by_email: normalizeEmail(access.user.email) }),
  });
  if (!made.ok) return json({ error: "Could not start the conversion." }, 502);
  const chosenLanguage = (row.target_options || []).find((o) => o.id === row.target_language);
  const languageName = String((chosenLanguage && chosenLanguage.label) || row.target_language || "");
  if (!/^[A-Za-z0-9 #.()+\/-]{1,80}$/.test(languageName)) return json({ error: "The chosen language name cannot be used. Choose it again." }, 409);
  const dispatch = await dispatchConvert(env, {
    analysis_id: id, repo: row.repo, ref: row.ref || "", path, template: row.modern_template, language: languageName, model_token: modelToken,
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

// File-level review. Every role reads the file-level results; only platform engineers change them.
const FILE_PAGE_MAX = 200;
const FILE_COLUMNS = "id,path,category,purpose,purpose_source,suggestions,review_status,reviewed_by_email,reviewed_at,commit_sha";

async function listFiles(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
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

// ---- Business assessment of one file: a draft from the workspace's model, approved by a platform engineer ----
// Only one approved result per file. An earlier approved result is superseded and kept as history.
// Every change is written to the action log first; if the log cannot be written, nothing changes.
const BUSINESS_MAX_CHARS = 20000;

async function listBusiness(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const path = new URL(request.url).searchParams.get("path") || "";
  if (!CONVERT_PATH.test(path)) return json({ error: "Choose a file." }, 400);
  const res = await serviceRest(env, `file_business_assessments?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&select=id,path,commit_sha,content,review_status,created_by_email,created_at,reviewed_by_email,reviewed_at&order=created_at.desc&limit=50`);
  if (!res.ok) return json({ error: "Could not load the business assessments." }, 502);
  return json({ path, assessments: await res.json() });
}

async function approveBusiness(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can approve business assessments." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const assessmentId = String(parsed.value?.assessment_id || "");
  if (!UUID_PATTERN.test(assessmentId)) return json({ error: "Choose an assessment." }, 400);
  const found = await serviceRest(env, `file_business_assessments?id=eq.${assessmentId}&analysis_id=eq.${id}&select=id,path,review_status`);
  if (!found.ok) return json({ error: "Could not load the assessment." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  if (item.review_status !== "draft") return json({ error: "Only a draft can be approved." }, 409);
  const current = await serviceRest(env, `file_business_assessments?analysis_id=eq.${id}&path=eq.${encodeURIComponent(item.path)}&review_status=eq.approved&select=id`);
  if (!current.ok) return json({ error: "Could not check the earlier approved result." }, 502);
  const [earlier] = await current.json();
  const refusedApprove = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "business_approve", analysis_id: id, repo: access.row.repo, detail: item.path });
  if (refusedApprove) return refusedApprove;
  if (earlier) {
    const refusedSupersede = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "business_supersede", analysis_id: id, repo: access.row.repo, detail: item.path });
    if (refusedSupersede) return refusedSupersede;
    const superseded = await serviceRest(env, `file_business_assessments?id=eq.${earlier.id}`, {
      method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ review_status: "superseded" }),
    });
    if (!superseded.ok) return json({ error: "Could not replace the earlier approved result." }, 502);
  }
  const approved = await serviceRest(env, `file_business_assessments?id=eq.${assessmentId}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ review_status: "approved", reviewed_by_email: normalizeEmail(access.user.email), reviewed_at: new Date().toISOString() }),
  });
  if (!approved.ok) return json({ error: "Could not approve the assessment." }, 502);
  return json({ approved: true, path: item.path });
}

async function discardBusiness(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can discard business assessments." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const assessmentId = String(parsed.value?.assessment_id || "");
  if (!UUID_PATTERN.test(assessmentId)) return json({ error: "Choose an assessment." }, 400);
  const found = await serviceRest(env, `file_business_assessments?id=eq.${assessmentId}&analysis_id=eq.${id}&select=id,path,review_status`);
  if (!found.ok) return json({ error: "Could not load the assessment." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  if (item.review_status !== "draft") return json({ error: "Only a draft can be discarded. An approved result is replaced by approving another." }, 409);
  const refused = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "business_discard", analysis_id: id, repo: access.row.repo, detail: item.path });
  if (refused) return refused;
  const res = await serviceRest(env, `file_business_assessments?id=eq.${assessmentId}&review_status=eq.draft`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  if (!res.ok) return json({ error: "Could not discard the draft." }, 502);
  return json({ discarded: true, path: item.path });
}

// Skips a file whose business view failed, for now, so the feature groups can go on. The failed row is kept, with its
// reason, and marked skipped. A file with a draft, an approved view or a run in progress cannot be skipped.
async function skipBusiness(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can skip a business assessment." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const path = typeof parsed.value?.path === "string" ? parsed.value.path : "";
  if (!CONVERT_PATH.test(path)) return json({ error: "Choose a file." }, 400);
  const busy = await serviceRest(env, `file_business_assessments?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&review_status=in.(running,draft,approved)&select=id&limit=1`);
  if (!busy.ok) return json({ error: "Could not check the file." }, 502);
  if ((await busy.json()).length) return json({ error: "This file has a draft, an approved view or a run in progress. Approve, discard or wait for it first." }, 409);
  const found = await serviceRest(env, `file_business_assessments?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&review_status=eq.failed&select=id,content&order=created_at.desc&limit=1`);
  if (!found.ok) return json({ error: "Could not load the assessment." }, 502);
  const [failed] = await found.json();
  if (!failed) return json({ error: "Only a file whose business assessment failed can be skipped." }, 409);
  const reason = failed.content && failed.content.failure && typeof failed.content.failure.reason === "string"
    ? failed.content.failure.reason : "The assessment did not finish.";
  const refused = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "business_skip", analysis_id: id, repo: access.row.repo, detail: path });
  if (refused) return refused;
  const now = new Date().toISOString();
  const res = await serviceRest(env, `file_business_assessments?id=eq.${failed.id}&review_status=eq.failed`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      review_status: "skipped",
      content: { ...(failed.content || {}), skip: { reason, at: now } },
      reviewed_by_email: normalizeEmail(access.user.email),
      reviewed_at: now,
    }),
  });
  if (!res.ok) return json({ error: "Could not skip the file." }, 502);
  return json({ skipped: true, path, reason });
}

// The feature step's count: how many approved files have an approved business view, and the approved files skipped for
// now, with their reasons. Every role reads it.
async function businessSummary(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const files = await serviceRest(env, `file_findings?analysis_id=eq.${id}&review_status=in.(approved,edited)&select=path&limit=100000`);
  if (!files.ok) return json({ error: "Could not load the file results." }, 502);
  const approvedFiles = [...new Set((await files.json()).map((r) => r.path))];
  const biz = await approvedBusinessPaths(env, id);
  if (biz.failed) return json({ error: "Could not load the business assessments." }, 502);
  const withView = new Set(biz.paths);
  const skippedRes = await serviceRest(env, `file_business_assessments?analysis_id=eq.${id}&review_status=eq.skipped&select=path,content&limit=100000`);
  if (!skippedRes.ok) return json({ error: "Could not load the business assessments." }, 502);
  const approvedSet = new Set(approvedFiles);
  const skipped = (await skippedRes.json())
    .filter((r) => approvedSet.has(r.path) && !withView.has(r.path))
    .map((r) => ({ path: r.path, reason: (r.content && r.content.skip && r.content.skip.reason) || "The assessment did not finish." }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return json({
    files: approvedFiles.length,
    with_view: approvedFiles.filter((p) => withView.has(p)).length,
    without_view: approvedFiles.filter((p) => !withView.has(p)).sort((a, b) => a.localeCompare(b)),
    skipped,
  });
}

// The runner saves one draft. The analysis may already be complete: the draft is not part of its run.
// The runner has reached the model for a business run. The running row says so, and the portal ticks the connection step.
async function saveBusinessProgress(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const parsed = await readJson(request, 2000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const path = typeof body.path === "string" ? body.path : "";
  if (!CONVERT_PATH.test(path)) return json({ error: "Choose a file." }, 400);
  if (body.connected !== true) return json({ error: "connected must be true." }, 400);
  const now = new Date().toISOString();
  const res = await serviceRest(env, `file_business_assessments?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&review_status=eq.running`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ content: { progress: { connected_at: now, reported_at: now } } }),
  });
  if (!res.ok) return json({ error: "Could not save the progress." }, 502);
  return json({ saved: true }, 200);
}

async function saveBusiness(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const found = await serviceRest(env, `analyses?id=eq.${id}&select=id,workspace_id,repo`);
  if (!found.ok) return json({ error: "Could not load the analysis." }, 502);
  const [analysis] = await found.json();
  if (!analysis) return json({ error: "Not found." }, 404);
  const parsed = await readJson(request, BUSINESS_MAX_CHARS + 2000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const path = typeof body.path === "string" ? body.path : "";
  if (!CONVERT_PATH.test(path)) return json({ error: "Choose a file." }, 400);
  const commitSha = typeof body.commit_sha === "string" && body.commit_sha.length <= 64 ? body.commit_sha : null;
  const pathFilter = `analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&review_status=eq.running`;
  if (body.status !== "ok") {
    // The run did not produce a usable draft. Its running row is cleared, and the failure is logged.
    const refusedFail = await logFirst(env, { workspace_id: analysis.workspace_id, user: null, action: "business_fail", analysis_id: id, repo: analysis.repo, detail: path });
    if (refusedFail) return refusedFail;
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "The file was not assessed.";
    // The failure stays on the file, with its reason, so the portal can say so. If the database does not allow the
    // failed status yet (add-business-failed.sql), the row is removed as before.
    const kept = await serviceRest(env, `file_business_assessments?${pathFilter}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ review_status: "failed", content: { failure: { reason, at: new Date().toISOString() } } }),
    });
    if (!kept.ok) await serviceRest(env, `file_business_assessments?${pathFilter}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    return json({ saved: false, reason });
  }
  const content = body.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return json({ error: "content must be an object." }, 400);
  if (JSON.stringify(content).length > BUSINESS_MAX_CHARS) return json({ error: "The assessment is too large to save." }, 400);
  const known = await serviceRest(env, `file_findings?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&select=id&limit=1`);
  if (!known.ok) return json({ error: "Could not check the file." }, 502);
  if (!(await known.json()).length) return json({ error: "That file is not in this analysis." }, 400);
  const refused = await logFirst(env, { workspace_id: analysis.workspace_id, user: null, action: "business_finish", analysis_id: id, repo: analysis.repo, detail: path });
  if (refused) return refused;
  await serviceRest(env, `file_business_assessments?${pathFilter}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  const res = await serviceRest(env, "file_business_assessments", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ analysis_id: id, path, commit_sha: commitSha, content, review_status: "draft" }),
  });
  if (!res.ok) return json({ error: "Could not save the assessment." }, 502);
  const [saved] = await res.json();
  return json({ saved: true, id: saved ? saved.id : null }, 201);
}

// Starts a business assessment of one file with the analysis's model. The row is 'running' until the runner answers.
async function startBusiness(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can start a business assessment." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const path = typeof parsed.value?.path === "string" ? parsed.value.path : "";
  if (!CONVERT_PATH.test(path) || path.split("/").includes("..")) return json({ error: "Choose a file from this analysis." }, 400);
  const row = access.row;
  if (row.status !== "complete") return json({ error: "Finish the assessment first." }, 409);
  if (!row.model_key_id) return json({ error: "Choose a language model for this analysis first." }, 409);
  const chosen = await chooseAnalysisModel(env, row.workspace_id, row.model_key_id);
  if (chosen.response) return chosen.response;
  const known = await serviceRest(env, `file_findings?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&select=id&limit=1`);
  if (!known.ok) return json({ error: "Could not check the file." }, 502);
  if (!(await known.json()).length) return json({ error: "That file is not in this analysis." }, 400);

  const busyResp = await refuseIfBusy(env, access.user, row.workspace_id, row.repo);
  if (busyResp) return busyResp;
  const modelToken = (await issueModelToken(env, id, row.model_key_id)) || "";
  if (!modelToken) return json({ error: "Could not prepare the model. Try again in a minute." }, 502);
  const refusedStart = await logFirst(env, { workspace_id: row.workspace_id, user: access.user, action: "business_start", analysis_id: id, repo: row.repo, detail: path });
  if (refusedStart) return refusedStart;
  await serviceRest(env, `file_business_assessments?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&review_status=in.(running,failed,skipped)`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  const made = await serviceRest(env, "file_business_assessments", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ analysis_id: id, path, content: {}, review_status: "running", created_by_email: normalizeEmail(access.user.email) }),
  });
  if (!made.ok) return json({ error: "Could not start the assessment." }, 502);
  const dispatch = await dispatchBusiness(env, { analysis_id: id, repo: row.repo, ref: row.ref || "", path, model_token: modelToken });
  if (!dispatch.ok) {
    await serviceRest(env, `file_business_assessments?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&review_status=eq.running`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    return json({ error: "The runner could not be started. Try again in a minute." }, 502);
  }
  return json({ queued: true, path }, 202);
}

function dispatchBusiness(env, inputs) {
  return fetch(`https://api.github.com/repos/${env.RUNNER_REPO}/actions/workflows/business.yml/dispatches`, {
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

// ---- Deep file assessments: list, approve and discard (platform engineers). Approving replaces the earlier approved one. ----
// The deep assessment state of each file in an analysis, for the file map. An approved account wins over a later
// draft; otherwise the latest run decides. Platform engineers only.
async function deepSummary(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const res = await serviceRest(env, `file_deep_assessments?analysis_id=eq.${id}&select=id,file_path,status,created_at,finished_at&order=created_at.desc&limit=5000`);
  if (!res.ok) return json({ error: "Could not load the deep assessments." }, 502);
  const files = {};
  const approved = {};
  for (const r of await res.json()) {
    if (r.status === "approved" && !approved[r.file_path]) {
      approved[r.file_path] = { state: "approved", job: r.id, started_at: r.created_at, finished_at: r.finished_at || null };
    }
    if (!files[r.file_path]) files[r.file_path] = { state: r.status, job: r.id, started_at: r.created_at, finished_at: r.finished_at || null };
  }
  return json({ files: { ...files, ...approved } });
}

// The function names each file defines and calls, from its approved assessment, or its latest draft when none is
// approved. Only names are returned, never the purposes or stories, so the file map can link files that call each other.
const DEEP_LINK_NAMES = 300;
async function deepLinks(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const res = await serviceRest(env, `file_deep_assessments?analysis_id=eq.${id}&status=in.(draft,approved)&select=file_path,status,content,created_at&order=created_at.desc&limit=2000`);
  if (!res.ok) return json({ error: "Could not load the deep assessment links." }, 502);
  const chosen = {};
  for (const r of await res.json()) {
    const current = chosen[r.file_path];
    if (current && (current.status === "approved" || r.status === "draft")) continue;
    chosen[r.file_path] = r;
  }
  const links = {};
  for (const [path, r] of Object.entries(chosen)) {
    const content = r.content || {};
    const defines = [];
    const calls = [];
    for (const fn of Array.isArray(content.functions) ? content.functions : []) {
      if (typeof fn?.name === "string" && defines.length < DEEP_LINK_NAMES) defines.push(fn.name);
      for (const c of Array.isArray(fn?.calls) ? fn.calls : []) {
        if (typeof c === "string" && calls.length < DEEP_LINK_NAMES && !calls.includes(c)) calls.push(c);
      }
    }
    links[path] = { defines, calls, status: r.status };
  }
  return json({ links });
}

async function listDeepFiles(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const path = new URL(request.url).searchParams.get("path") || "";
  if (!CONVERT_PATH.test(path)) return json({ error: "Choose a file." }, 400);
  const res = await serviceRest(env, `file_deep_assessments?analysis_id=eq.${id}&file_path=eq.${encodeURIComponent(path)}&select=id,file_path,status,content,confidence,dropped,commit_sha,created_by_email,created_at,finished_at,reviewed_by_email,reviewed_at&order=created_at.desc&limit=50`);
  if (!res.ok) return json({ error: "Could not load the deep file assessments." }, 502);
  return json({ path, assessments: await res.json() });
}

async function approveDeepFile(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can approve deep file assessments." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const assessmentId = String(parsed.value?.assessment_id || "");
  if (!UUID_PATTERN.test(assessmentId)) return json({ error: "Choose an assessment." }, 400);
  const found = await serviceRest(env, `file_deep_assessments?id=eq.${assessmentId}&analysis_id=eq.${id}&select=id,file_path,status`);
  if (!found.ok) return json({ error: "Could not load the assessment." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  if (item.status !== "draft") return json({ error: "Only a draft can be approved." }, 409);
  const current = await serviceRest(env, `file_deep_assessments?analysis_id=eq.${id}&file_path=eq.${encodeURIComponent(item.file_path)}&status=eq.approved&select=id`);
  if (!current.ok) return json({ error: "Could not check the earlier approved account." }, 502);
  const [earlier] = await current.json();
  const refusedApprove = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "deep_file_approve", analysis_id: id, repo: access.row.repo, detail: item.file_path });
  if (refusedApprove) return refusedApprove;
  if (earlier) {
    const refusedSupersede = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "deep_file_supersede", analysis_id: id, repo: access.row.repo, detail: item.file_path });
    if (refusedSupersede) return refusedSupersede;
    const superseded = await serviceRest(env, `file_deep_assessments?id=eq.${earlier.id}`, {
      method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ status: "superseded" }),
    });
    if (!superseded.ok) return json({ error: "Could not replace the earlier approved account." }, 502);
  }
  const approved = await serviceRest(env, `file_deep_assessments?id=eq.${assessmentId}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ status: "approved", reviewed_by_email: normalizeEmail(access.user.email), reviewed_at: new Date().toISOString() }),
  });
  if (!approved.ok) return json({ error: "Could not approve the account." }, 502);
  return json({ approved: true, path: item.file_path });
}

async function discardDeepFile(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can discard deep file assessments." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const assessmentId = String(parsed.value?.assessment_id || "");
  if (!UUID_PATTERN.test(assessmentId)) return json({ error: "Choose an assessment." }, 400);
  const found = await serviceRest(env, `file_deep_assessments?id=eq.${assessmentId}&analysis_id=eq.${id}&select=id,file_path,status`);
  if (!found.ok) return json({ error: "Could not load the assessment." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  if (item.status !== "draft") return json({ error: "Only a draft can be discarded. An approved account is replaced by approving another." }, 409);
  const refused = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "deep_file_discard", analysis_id: id, repo: access.row.repo, detail: item.file_path });
  if (refused) return refused;
  const res = await serviceRest(env, `file_deep_assessments?id=eq.${assessmentId}&status=eq.draft`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  if (!res.ok) return json({ error: "Could not discard the draft." }, 502);
  return json({ discarded: true, path: item.file_path });
}

// ---- Deep file assessment: one file's purpose, functions, calls and user stories (slice 2) ----
// Same flow as the business assessment of one file. A row is 'running' until the runner answers. Every name in the
// account must appear in the file; the runner drops any that do not, and the count is kept with the draft.
const DEEP_MAX_CHARS = 150000;

async function startDeepFile(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can start a deep file assessment." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const path = typeof parsed.value?.path === "string" ? parsed.value.path : "";
  if (!CONVERT_PATH.test(path) || path.split("/").includes("..")) return json({ error: "Choose a file from this analysis." }, 400);
  const row = access.row;
  if (row.status !== "complete") return json({ error: "Finish the assessment first." }, 409);
  if (!row.model_key_id) return json({ error: "Choose a language model for this analysis first." }, 409);
  const chosen = await chooseAnalysisModel(env, row.workspace_id, row.model_key_id);
  if (chosen.response) return chosen.response;
  const known = await serviceRest(env, `file_findings?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&select=id&limit=1`);
  if (!known.ok) return json({ error: "Could not check the file." }, 502);
  if (!(await known.json()).length) return json({ error: "That file is not in this analysis." }, 400);

  const busyResp = await refuseIfBusy(env, access.user, row.workspace_id, row.repo);
  if (busyResp) return busyResp;
  const modelToken = (await issueModelToken(env, id, row.model_key_id)) || "";
  if (!modelToken) return json({ error: "Could not prepare the model. Try again in a minute." }, 502);
  const refusedStart = await logFirst(env, { workspace_id: row.workspace_id, user: access.user, action: "deep_file_start", analysis_id: id, repo: row.repo, detail: path });
  if (refusedStart) return refusedStart;
  const runningFilter = `analysis_id=eq.${id}&file_path=eq.${encodeURIComponent(path)}&status=eq.running`;
  await serviceRest(env, `file_deep_assessments?${runningFilter}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  const made = await serviceRest(env, "file_deep_assessments", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ analysis_id: id, file_path: path, content: {}, status: "running", created_by_email: normalizeEmail(access.user.email) }),
  });
  if (!made.ok) return json({ error: "Could not start the deep assessment." }, 502);
  const dispatch = await dispatchDeepFile(env, { analysis_id: id, repo: row.repo, ref: row.ref || "", path, model_token: modelToken });
  if (!dispatch.ok) {
    await serviceRest(env, `file_deep_assessments?${runningFilter}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    return json({ error: "The runner could not be started. Try again in a minute." }, 502);
  }
  return json({ queued: true, path }, 202);
}

// An engineer switches the model of an existing analysis to one of the workspace's active keys. The analysis must be
// finished, so a run in progress keeps the model it started with.
async function changeAnalysisModel(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can change the model for an analysis." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const keyId = parsed.value?.model_key_id;
  const row = access.row;
  if (row.status === "queued" || row.status === "running") return json({ error: "Wait for the analysis to finish before changing its model." }, 409);
  const chosen = await chooseAnalysisModel(env, row.workspace_id, keyId);
  if (chosen.response) return chosen.response;
  const refused = await logFirst(env, { workspace_id: row.workspace_id, user: access.user, action: "model_change", analysis_id: id, repo: row.repo, detail: `Model changed to ${chosen.key.label || chosen.key.provider}` });
  if (refused) return refused;
  const saved = await serviceRest(env, `analyses?id=eq.${id}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ model_key_id: keyId }) });
  if (!saved.ok) return json({ error: "Could not change the model. Try again in a minute." }, 502);
  return json({ model_key_id: keyId, label: chosen.key.label || chosen.key.provider, model: chosen.key.model || null });
}

function dispatchDeepFile(env, inputs) {
  return fetch(`https://api.github.com/repos/${env.RUNNER_REPO}/actions/workflows/deep-file.yml/dispatches`, {
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

// The time a deep file assessment usually takes, from the file's line count. The model reads the file and writes
// up to a fixed length of answer, so the time grows with the file and levels off. It is an estimate: the portal shows
// it as a range, and the real time is what the draft records.
export function deepEstimateSeconds(lines) {
  const seconds = Math.round(25 + Math.max(0, lines) * 0.04);
  return Math.min(150, Math.max(25, seconds));
}

// The runner reports the size of the file once it has read it, so the portal can show the time it will take.
async function saveDeepProgress(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const parsed = await readJson(request, 2000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const path = typeof body.path === "string" ? body.path : "";
  const lines = body.lines;
  const chars = body.chars;
  if (!CONVERT_PATH.test(path)) return json({ error: "Choose a file." }, 400);
  if (!Number.isInteger(lines) || lines < 0 || lines > 10000000) return json({ error: "lines must be a whole number." }, 400);
  if (!Number.isInteger(chars) || chars < 0 || chars > 100000000) return json({ error: "chars must be a whole number." }, 400);
  // connected is sent once the runner has reached the model. Only then does the portal tick the connection step.
  if (body.connected !== undefined && typeof body.connected !== "boolean") return json({ error: "connected must be true or false." }, 400);
  const now = new Date().toISOString();
  const progress = { lines, chars, estimate_seconds: deepEstimateSeconds(lines), reported_at: now, ...(body.connected === true ? { connected_at: now } : {}) };
  const res = await serviceRest(env, `file_deep_assessments?analysis_id=eq.${id}&file_path=eq.${encodeURIComponent(path)}&status=eq.running`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ content: { progress } }),
  });
  if (!res.ok) return json({ error: "Could not save the progress." }, 502);
  return json({ saved: true, estimate_seconds: progress.estimate_seconds }, 200);
}

async function saveDeepFile(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const found = await serviceRest(env, `analyses?id=eq.${id}&select=id,workspace_id,repo`);
  if (!found.ok) return json({ error: "Could not load the analysis." }, 502);
  const [analysis] = await found.json();
  if (!analysis) return json({ error: "Not found." }, 404);
  const parsed = await readJson(request, DEEP_MAX_CHARS + 4000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const path = typeof body.path === "string" ? body.path : "";
  if (!CONVERT_PATH.test(path)) return json({ error: "Choose a file." }, 400);
  const commitSha = typeof body.commit_sha === "string" && body.commit_sha.length <= 64 ? body.commit_sha : null;
  const runningFilter = `analysis_id=eq.${id}&file_path=eq.${encodeURIComponent(path)}&status=eq.running`;
  if (body.status !== "ok") {
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.slice(0, 300) : "The file was not assessed.";
    const refusedFail = await logFirst(env, { workspace_id: analysis.workspace_id, user: null, action: "deep_file_fail", analysis_id: id, repo: analysis.repo, detail: `${path}: ${reason}`.slice(0, 300) });
    if (refusedFail) return refusedFail;
    // The row stays, marked failed with the reason, so the portal can say why. If that cannot be saved, the row is removed.
    const marked = await serviceRest(env, `file_deep_assessments?${runningFilter}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", content: { failure: { reason, at: new Date().toISOString() } }, finished_at: new Date().toISOString() }),
    });
    if (!marked.ok) await serviceRest(env, `file_deep_assessments?${runningFilter}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    return json({ saved: false, reason });
  }
  const content = body.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) return json({ error: "content must be an object." }, 400);
  if (JSON.stringify(content).length > DEEP_MAX_CHARS) return json({ error: "The assessment is too large to save." }, 400);
  const dropped = Number.isInteger(body.dropped) && body.dropped >= 0 ? body.dropped : 0;
  const known = await serviceRest(env, `file_findings?analysis_id=eq.${id}&path=eq.${encodeURIComponent(path)}&select=id&limit=1`);
  if (!known.ok) return json({ error: "Could not check the file." }, 502);
  if (!(await known.json()).length) return json({ error: "That file is not in this analysis." }, 400);
  const refused = await logFirst(env, { workspace_id: analysis.workspace_id, user: null, action: "deep_file_finish", analysis_id: id, repo: analysis.repo, detail: path });
  if (refused) return refused;
  const finishedAt = new Date().toISOString();
  // The running row becomes the draft: it keeps the time the run started and its job id.
  const claimed = await serviceRest(env, `file_deep_assessments?${runningFilter}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ status: "draft", content, confidence: "model_read", dropped, commit_sha: commitSha, finished_at: finishedAt }),
  });
  if (claimed.ok) {
    const [kept] = await claimed.json();
    if (kept) return json({ saved: true, id: kept.id }, 201);
  }
  const res = await serviceRest(env, "file_deep_assessments", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ analysis_id: id, file_path: path, commit_sha: commitSha, content, confidence: "model_read", dropped, status: "draft", finished_at: finishedAt }),
  });
  if (!res.ok) return json({ error: "Could not save the deep assessment." }, 502);
  const [saved] = await res.json();
  return json({ saved: true, id: saved ? saved.id : null }, 201);
}

// ---- Cleanup: superseded business assessments in a workspace. Preview first, then confirm the same count. ----
// Only superseded results are removed. Drafts and approved results are never touched here.
async function supersededInWorkspace(env, workspaceId) {
  const res = await serviceRest(env, `file_business_assessments?review_status=eq.superseded&select=id,path,analysis_id,analyses!inner(workspace_id,app_name,repo)&analyses.workspace_id=eq.${workspaceId}&limit=100000`);
  if (!res.ok) return { failed: true };
  return { rows: await res.json() };
}

async function previewCleanup(request, env, workspaceId) {
  const access = await workspaceAccess(env, request, workspaceId);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can clean up assessment data." }, 403);
  const found = await supersededInWorkspace(env, workspaceId);
  if (found.failed) return json({ error: "Could not check the superseded results. Try again in a minute." }, 502);
  const groups = new Map();
  for (const row of found.rows) {
    const key = `${row.analysis_id}|${row.path}`;
    const item = groups.get(key) || { app: row.analyses.app_name || row.analyses.repo, repo: row.analyses.repo, path: row.path, count: 0 };
    item.count += 1;
    groups.set(key, item);
  }
  return json({ count: found.rows.length, items: [...groups.values()].slice(0, 50) });
}

async function runCleanup(request, env, workspaceId) {
  const access = await workspaceAccess(env, request, workspaceId);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can clean up assessment data." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const expected = parsed.value?.expected_count;
  if (!Number.isInteger(expected) || expected < 0) return json({ error: "Preview the cleanup first." }, 400);
  const found = await supersededInWorkspace(env, workspaceId);
  if (found.failed) return json({ error: "Could not check the superseded results. Try again in a minute." }, 502);
  if (found.rows.length !== expected) {
    return json({ error: "The superseded results changed since the preview. Preview again before confirming." }, 409);
  }
  if (found.rows.length === 0) return json({ removed: 0 });
  const refused = await logFirst(env, { workspace_id: workspaceId, user: access.user, action: "business_cleanup", analysis_id: null, repo: null, detail: `superseded: ${found.rows.length}` });
  if (refused) return refused;
  const ids = [...new Set(found.rows.map((row) => row.id))];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100).join(",");
    const res = await serviceRest(env, `file_business_assessments?id=in.(${batch})&review_status=eq.superseded`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    if (!res.ok) return json({ error: "Could not remove every superseded result. Preview again to see what is left." }, 502);
  }
  return json({ removed: ids.length });
}

// ---- Feature grouping: the model proposes feature groups from the approved business results; an engineer approves ----
// Only files with an approved business assessment can be grouped. A file may be in more than one feature.
const GROUP_MAX = 30;
const GROUP_FILES_MAX = 200;

async function approvedBusinessPaths(env, id) {
  const res = await serviceRest(env, `file_business_assessments?analysis_id=eq.${id}&review_status=eq.approved&select=path&limit=100000`);
  if (!res.ok) return { failed: true };
  return { paths: [...new Set((await res.json()).map((r) => r.path))] };
}

export function checkGroups(value, allowed, capabilities) {
  if (!Array.isArray(value) || value.length < 1 || value.length > GROUP_MAX) return { error: `A grouping holds 1 to ${GROUP_MAX} features.` };
  const groups = [];
  const missing = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "Each feature must be an object." };
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name || name.length > 80) return { error: "Each feature needs a name of up to 80 characters." };
    const summary = typeof item.summary === "string" ? item.summary.trim().slice(0, 300) : "";
    if (!Array.isArray(item.paths) || item.paths.length < 1 || item.paths.length > GROUP_FILES_MAX) return { error: "Each feature needs 1 to 200 files." };
    const paths = [];
    for (const path of item.paths) {
      if (typeof path !== "string") return { error: "Each file in a feature must be a file name." };
      if (!allowed.has(path) && !missing.includes(path)) missing.push(path);
      if (!paths.includes(path)) paths.push(path);
    }
    groups.push({ name, summary, paths });
  }
  // Every file that lacks an approved business view is named, so the engineer knows which one to approve or remove.
  if (missing.length) {
    return { error: `These files have no approved business assessment: ${missing.join(", ")}. Approve their business view, or take them out of the features, then save again.`, missing };
  }
  const caps = capabilities == null ? null : checkCapabilities(capabilities, groups.length);
  if (caps && caps.error) return caps;
  return { groups, capabilities: caps ? caps.capabilities : null };
}

// The capabilities of a grouping. Each one names its features by their position in the grouping, so a feature
// can be renamed without losing its place. A feature sits in exactly one capability.
const CAPABILITY_MAX = 30;
export function checkCapabilities(value, featureCount) {
  if (!Array.isArray(value) || value.length < 1 || value.length > CAPABILITY_MAX) return { error: `A grouping holds 1 to ${CAPABILITY_MAX} capabilities.` };
  const capabilities = [];
  const seen = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "Each capability must be an object." };
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name || name.length > 80) return { error: "Each capability needs a name of up to 80 characters." };
    const summary = typeof item.summary === "string" ? item.summary.trim().slice(0, 300) : "";
    if (!Array.isArray(item.features) || item.features.length < 1) return { error: "Each capability needs at least one feature." };
    const features = [];
    for (const index of item.features) {
      if (!Number.isInteger(index) || index < 0 || index >= featureCount) return { error: "A capability names a feature that is not in the grouping." };
      if (seen.has(index)) return { error: "A feature can be in one capability only." };
      seen.add(index);
      features.push(index);
    }
    capabilities.push({ name, summary, features });
  }
  if (seen.size !== featureCount) return { error: "Every feature must be in a capability." };
  return { capabilities };
}


async function listGroupings(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const res = await serviceRest(env, `feature_groupings?analysis_id=eq.${id}&select=id,status,groups,capabilities,source_count,created_by_email,created_at,reviewed_by_email,reviewed_at,review_note,review_note_by_email,review_note_at,edited_by_email,edited_at&order=created_at.desc&limit=20`);
  if (!res.ok) return json({ error: "Could not load the feature groupings." }, 502);
  return json({ groupings: await res.json() });
}

// The feature view: the approved grouping only, with each story and the approved rules it cites. Every workspace member
// who may see the findings reads it, auditors included. Only approved features are returned.
async function listFeatures(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const res = await serviceRest(env, `feature_groupings?analysis_id=eq.${id}&status=eq.approved&select=id,groups,capabilities,reviewed_by_email,reviewed_at&order=reviewed_at.desc.nullslast&limit=1`);
  if (!res.ok) return json({ error: "Could not load the groupings." }, 502);
  const [grouping] = await res.json();
  if (!grouping) return json({ grouping: null, features: [] });
  const groups = Array.isArray(grouping.groups) ? grouping.groups : [];
  const approved = await approvedRulesFor(env, id, groups.flatMap((g) => g.paths || []));
  if (approved.failed) return json({ error: "Could not load the approved rules." }, 502);
  const features = groups.map((g) => ({
    name: g.name || "",
    summary: g.summary || "",
    files: [...new Set(g.paths || [])].map((path) => {
      const a = approved.found.get(path);
      return {
        path,
        purpose: a ? a.file_purpose : "",
        // The approved assessment behind the map. Null when the file has no approved assessment yet.
        assessment: a ? { dropped: a.dropped, functions: a.functions, rules: a.rules, examples: a.examples, database: a.database } : null,
      };
    }),
    stories: (Array.isArray(g.stories) ? g.stories : []).map((st) => ({
      id: st.id,
      story: st.story,
      rules: (Array.isArray(st.rules) ? st.rules : []).map((cite) => {
        const current = ((approved.found.get(cite.file) || {}).rules || []).find((r) => r.id === cite.id);
        return {
          file: cite.file,
          id: cite.id,
          lines: current ? current.lines : (cite.lines || null),
          statement: current ? current.statement : "",
          condition: current ? current.condition : "",
          outcome: current ? current.outcome : "",
          current: !!current,
        };
      }),
    })),
  }));
  const capabilities = Array.isArray(grouping.capabilities) ? grouping.capabilities : null;
  return json({
    grouping: { id: grouping.id, approved_by_email: grouping.reviewed_by_email || null, approved_at: grouping.reviewed_at || null },
    features,
    capabilities,
  });
}

// Any member of the workspace can rename a capability, on the draft or the approved grouping. The log records
// the position of the capability, not its name.
async function renameCapability(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  const parsed = await readJson(request, 4000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const groupingId = String(parsed.value?.grouping_id || "");
  if (!UUID_PATTERN.test(groupingId)) return json({ error: "Choose a grouping." }, 400);
  const name = typeof parsed.value?.name === "string" ? parsed.value.name.trim() : "";
  if (!name || name.length > 80) return json({ error: "A capability needs a name of up to 80 characters." }, 400);
  const found = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&analysis_id=eq.${id}&select=id,status,capabilities`);
  if (!found.ok) return json({ error: "Could not load the grouping." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  if (item.status !== "draft" && item.status !== "approved") return json({ error: "Only the current grouping can be renamed." }, 409);
  const caps = Array.isArray(item.capabilities) ? item.capabilities : null;
  if (!caps) return json({ error: "This grouping has no capabilities yet. Propose the grouping again." }, 409);
  const index = parsed.value?.index;
  if (!Number.isInteger(index) || index < 0 || index >= caps.length) return json({ error: "That capability is not in the grouping." }, 400);
  const next = caps.map((c, i) => (i === index ? { ...c, name } : c));
  const refused = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "capability_rename", analysis_id: id, repo: access.row.repo, detail: `capability ${index + 1}` });
  if (refused) return refused;
  const res = await serviceRest(env, `feature_groupings?id=eq.${groupingId}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ capabilities: next }),
  });
  if (!res.ok) return json({ error: "Could not save the name." }, 502);
  return json({ saved: true, capabilities: next });
}

async function startGrouping(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can group the features." }, 403);
  const row = access.row;
  if (row.status !== "complete") return json({ error: "Finish the assessment first." }, 409);
  if (!row.model_key_id) return json({ error: "Choose a language model for this analysis first." }, 409);
  const chosen = await chooseAnalysisModel(env, row.workspace_id, row.model_key_id);
  if (chosen.response) return chosen.response;
  const approved = await approvedBusinessPaths(env, id);
  if (approved.failed) return json({ error: "Could not check the approved results. Try again in a minute." }, 502);
  if (!approved.paths.length) return json({ error: "Approve some file business assessments first. The features are grouped from them." }, 409);

  const busyResp = await refuseIfBusy(env, access.user, row.workspace_id, row.repo);
  if (busyResp) return busyResp;
  const modelToken = (await issueModelToken(env, id, row.model_key_id)) || "";
  if (!modelToken) return json({ error: "Could not prepare the model. Try again in a minute." }, 502);
  const refusedStart = await logFirst(env, { workspace_id: row.workspace_id, user: access.user, action: "grouping_start", analysis_id: id, repo: row.repo, detail: `${approved.paths.length} approved files` });
  if (refusedStart) return refusedStart;
  await serviceRest(env, `feature_groupings?analysis_id=eq.${id}&status=eq.running`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  const made = await serviceRest(env, "feature_groupings", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ analysis_id: id, status: "running", groups: [], source_count: approved.paths.length, created_by_email: normalizeEmail(access.user.email) }),
  });
  if (!made.ok) return json({ error: "Could not start the grouping." }, 502);
  const dispatch = await dispatchGrouping(env, { analysis_id: id, model_token: modelToken });
  if (!dispatch.ok) {
    await serviceRest(env, `feature_groupings?analysis_id=eq.${id}&status=eq.running`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    return json({ error: "The runner could not be started. Try again in a minute." }, 502);
  }
  // A new proposal replaces the drafts still waiting for review, so only one draft is ever listed. The drafts are
  // removed once the run has started, and the removal is logged first. Approved groupings are kept.
  const drafts = await serviceRest(env, `feature_groupings?analysis_id=eq.${id}&status=eq.draft&select=id`);
  if (drafts.ok && (await drafts.json()).length) {
    if (await recordAction(env, { workspace_id: row.workspace_id, user: access.user, action: "grouping_discard", analysis_id: id, repo: row.repo, detail: "Replaced by a new proposal" })) {
      await serviceRest(env, `feature_groupings?analysis_id=eq.${id}&status=eq.draft`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    }
  }
  return json({ queued: true }, 202);
}

function dispatchGrouping(env, inputs) {
  return fetch(`https://api.github.com/repos/${env.RUNNER_REPO}/actions/workflows/grouping.yml/dispatches`, {
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

// The runner posts the proposed features. Each file it names must have an approved business assessment.
async function saveGrouping(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const found = await serviceRest(env, `analyses?id=eq.${id}&select=id,workspace_id,repo`);
  if (!found.ok) return json({ error: "Could not load the analysis." }, 502);
  const [analysis] = await found.json();
  if (!analysis) return json({ error: "Not found." }, 404);
  const parsed = await readJson(request, 60000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const runningOnly = `feature_groupings?analysis_id=eq.${id}&status=eq.running`;
  if (body.status !== "ok") {
    const refusedFail = await logFirst(env, { workspace_id: analysis.workspace_id, user: null, action: "grouping_fail", analysis_id: id, repo: analysis.repo, detail: typeof body.reason === "string" ? body.reason.slice(0, 200) : null });
    if (refusedFail) return refusedFail;
    await serviceRest(env, runningOnly, { method: "DELETE", headers: { prefer: "return=minimal" } });
    return json({ saved: false, reason: typeof body.reason === "string" ? body.reason.slice(0, 300) : "The features were not grouped." });
  }
  const approved = await approvedBusinessPaths(env, id);
  if (approved.failed) return json({ error: "Could not check the approved results." }, 502);
  const checked = checkGroups(body.groups, new Set(approved.paths), body.capabilities);
  if (checked.error) return json({ error: checked.error }, 400);
  const serialised = JSON.stringify(checked.groups);
  if (serialised.length > 40000) return json({ error: "The grouping is too large to save." }, 400);
  const refused = await logFirst(env, { workspace_id: analysis.workspace_id, user: null, action: "grouping_finish", analysis_id: id, repo: analysis.repo, detail: `${checked.groups.length} features` });
  if (refused) return refused;
  await serviceRest(env, runningOnly, { method: "DELETE", headers: { prefer: "return=minimal" } });
  const res = await serviceRest(env, "feature_groupings", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ analysis_id: id, status: "draft", groups: checked.groups, capabilities: checked.capabilities, source_count: approved.paths.length }),
  });
  if (!res.ok) return json({ error: "Could not save the grouping." }, 502);
  const [saved] = await res.json();
  return json({ saved: true, id: saved ? saved.id : null }, 201);
}

// The runner reads the approved business summaries to group them. Read only, with the shared secret.
async function groupingSources(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const res = await serviceRest(env, `file_business_assessments?analysis_id=eq.${id}&review_status=eq.approved&select=path,content&limit=100000`);
  if (!res.ok) return json({ error: "Could not load the approved results." }, 502);
  return json({ files: (await res.json()).map((r) => ({ path: r.path, content: r.content })) });
}

// Who may approve or send back a grouping: the named application owner, or a CIO or CTO in the workspace.
function canReviewGrouping(row, member, user) {
  return canApproveTarget(row, member, user);
}

async function approveGrouping(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canReviewGrouping(access.row, access.member, access.user)) {
    return json({ error: "Only the application owner, or a CIO or CTO, can approve the grouping. Name the owner on the next steps page first." }, 403);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const groupingId = String(parsed.value?.grouping_id || "");
  if (!UUID_PATTERN.test(groupingId)) return json({ error: "Choose a grouping." }, 400);
  const found = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&analysis_id=eq.${id}&select=id,status`);
  if (!found.ok) return json({ error: "Could not load the grouping." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  if (item.status !== "draft") return json({ error: "Only a draft grouping can be approved." }, 409);
  const current = await serviceRest(env, `feature_groupings?analysis_id=eq.${id}&status=eq.approved&select=id&limit=1`);
  if (!current.ok) return json({ error: "Could not check the earlier grouping." }, 502);
  const [earlier] = await current.json();
  const refusedApprove = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "grouping_approve", analysis_id: id, repo: access.row.repo, detail: "features" });
  if (refusedApprove) return refusedApprove;
  if (earlier) {
    const refusedSupersede = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "grouping_supersede", analysis_id: id, repo: access.row.repo, detail: "features" });
    if (refusedSupersede) return refusedSupersede;
    const superseded = await serviceRest(env, `feature_groupings?id=eq.${earlier.id}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ status: "superseded" }) });
    if (!superseded.ok) return json({ error: "Could not replace the earlier grouping." }, 502);
  }
  const approved = await serviceRest(env, `feature_groupings?id=eq.${groupingId}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ status: "approved", reviewed_by_email: normalizeEmail(access.user.email), reviewed_at: new Date().toISOString() }),
  });
  if (!approved.ok) return json({ error: "Could not approve the grouping." }, 502);
  return json({ approved: true });
}

// The application owner sends a draft back with a note. It stays a draft for the engineer to change and send again.
async function rejectGrouping(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canReviewGrouping(access.row, access.member, access.user)) {
    return json({ error: "Only the application owner, or a CIO or CTO, can send a grouping back." }, 403);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const groupingId = String(parsed.value?.grouping_id || "");
  if (!UUID_PATTERN.test(groupingId)) return json({ error: "Choose a grouping." }, 400);
  const note = typeof parsed.value?.note === "string" ? parsed.value.note.trim() : "";
  if (!note || note.length > 1000) return json({ error: "Say what should change, in up to 1000 characters." }, 400);
  const found = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&analysis_id=eq.${id}&select=id,status`);
  if (!found.ok) return json({ error: "Could not load the grouping." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  if (item.status !== "draft") return json({ error: "Only a draft grouping can be sent back." }, 409);
  const refused = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "grouping_reject", analysis_id: id, repo: access.row.repo, detail: "features" });
  if (refused) return refused;
  const res = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&status=eq.draft`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ review_note: note, review_note_by_email: normalizeEmail(access.user.email), review_note_at: new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "Could not send the grouping back." }, 502);
  return json({ sent_back: true });
}

// A platform engineer changes the groups of a draft before it goes to the owner. Overlap is allowed.
async function editGrouping(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can change a grouping." }, 403);
  const parsed = await readJson(request, 60000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const groupingId = String(parsed.value?.grouping_id || "");
  if (!UUID_PATTERN.test(groupingId)) return json({ error: "Choose a grouping." }, 400);
  const found = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&analysis_id=eq.${id}&select=id,status,groups`);
  if (!found.ok) return json({ error: "Could not load the grouping." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  if (item.status !== "draft") return json({ error: "Only a draft grouping can be changed." }, 409);
  const earlier = Array.isArray(item.groups) ? item.groups : [];
  const approved = await approvedBusinessPaths(env, id);
  if (approved.failed) return json({ error: "Could not check the approved results. Try again in a minute." }, 502);
  const checked = checkGroups(parsed.value?.groups, new Set(approved.paths), parsed.value?.capabilities);
  if (checked.error) return json({ error: checked.error }, 400);
  const serialised = JSON.stringify(checked.groups);
  if (serialised.length > 40000) return json({ error: "The grouping is too large to save." }, 400);
  // A feature keeps its stories while every file they cite is still in it; a story that cites a file taken out is dropped.
  const kept = checked.groups.map((g, index) => {
    const old = earlier[index];
    const stories = old && Array.isArray(old.stories) ? old.stories.filter((st) => (st.rules || []).every((r) => g.paths.includes(r.file))) : [];
    return stories.length ? { ...g, stories } : g;
  });
  const refused = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "grouping_edit", analysis_id: id, repo: access.row.repo, detail: `${checked.groups.length} features` });
  if (refused) return refused;
  const res = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&status=eq.draft`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ groups: kept, capabilities: checked.capabilities, edited_by_email: normalizeEmail(access.user.email), edited_at: new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "Could not save the changes." }, 502);
  return json({ saved: true });
}

async function discardGrouping(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can discard a grouping." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const groupingId = String(parsed.value?.grouping_id || "");
  if (!UUID_PATTERN.test(groupingId)) return json({ error: "Choose a grouping." }, 400);
  const found = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&analysis_id=eq.${id}&select=id,status`);
  if (!found.ok) return json({ error: "Could not load the grouping." }, 502);
  const [item] = await found.json();
  if (!item) return json({ error: "Not found." }, 404);
  if (item.status !== "draft") return json({ error: "Only a draft grouping can be discarded. An approved one is replaced by approving another." }, 409);
  const refused = await logFirst(env, { workspace_id: access.row.workspace_id, user: access.user, action: "grouping_discard", analysis_id: id, repo: access.row.repo, detail: "features" });
  if (refused) return refused;
  const res = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&status=eq.draft`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  if (!res.ok) return json({ error: "Could not discard the grouping." }, 502);
  return json({ discarded: true });
}

// ---- Feature user stories: drafted per feature from the approved rules of its files. The engineer checks them, and
// they are final only when the application owner approves the grouping. Every rule a story cites must exist. ----
const STORY_MAX = 12;
const STORY_TEXT_MAX = 300;
const STORY_CITES_MAX = 20;
const STORY_SHAPE = /^As an? .+ I can .+ so that .+/i;

// The approved rules of the given files, with what the story drafting reads. Only approved assessments count.
// Replaces anything that looks like personal or identifying data in a sample value with a generic placeholder.
function scrubSample(value) {
  return String(value || "")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "name@example.com")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "XXX-XX-XXXX")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "555-0100")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "192.0.2.1")
    .replace(/\b\d{6,}\b/g, "123456");
}

async function approvedRulesFor(env, id, paths) {
  const found = new Map();
  const unique = [...new Set(paths)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50).map((p) => `"${p.replace(/"/g, "")}"`).join(",");
    const res = await serviceRest(env, `file_deep_assessments?analysis_id=eq.${id}&status=eq.approved&file_path=in.(${encodeURIComponent(batch)})&select=file_path,content,dropped&limit=10000`);
    if (!res.ok) return { failed: true };
    for (const r of await res.json()) {
      const content = r.content || {};
      const rules = (Array.isArray(content.rules) ? content.rules : []).slice(0, 60).filter((x) => x && typeof x.id === "string").map((x) => ({
        id: x.id, statement: x.statement || "", condition: x.condition || "", outcome: x.outcome || "",
        function: typeof x.function === "string" ? x.function : "",
        lines: Array.isArray(x.lines) && x.lines.length === 2 ? x.lines : null,
      }));
      // The map needs the functions, the worked-example links, the data and how many names were left out.
      const functions = (Array.isArray(content.functions) ? content.functions : []).slice(0, 60).filter((f) => f && typeof f.name === "string").map((f) => ({
        name: f.name,
        purpose: String(f.purpose || "").slice(0, 300),
        calls: (Array.isArray(f.calls) ? f.calls : []).filter((c) => typeof c === "string").slice(0, 30),
      }));
      // The worked examples become acceptance tests in the module spec. Their values are scrubbed first: anything that
      // looks like an e-mail, a phone number, an ID or an address is replaced with a placeholder.
      const examples = (Array.isArray(content.examples) ? content.examples : []).slice(0, 120).filter((e) => e && typeof e.rule === "string").map((e) => ({
        rule: e.rule,
        given: scrubSample(e.given).slice(0, 300),
        expect: scrubSample(e.expect).slice(0, 300),
      }));
      const db = content.database && typeof content.database === "object" ? content.database : {};
      const database = {
        tables: (Array.isArray(db.tables) ? db.tables : []).slice(0, 40).filter((t) => t && typeof t.name === "string").map((t) => ({
          name: t.name,
          operations: (Array.isArray(t.operations) ? t.operations : []).filter((o) => typeof o === "string").slice(0, 4),
          fields: (Array.isArray(t.fields) ? t.fields : []).filter((x) => typeof x === "string").slice(0, 60),
        })),
        queries: (Array.isArray(db.queries) ? db.queries : []).slice(0, 60).filter((q) => q && typeof q.operation === "string").map((q) => ({
          function: String(q.function || "").slice(0, 80),
          operation: q.operation,
          tables: (Array.isArray(q.tables) ? q.tables : []).filter((x) => typeof x === "string").slice(0, 10),
        })),
      };
      found.set(r.file_path, {
        file_purpose: content.file_purpose || "",
        file_user_stories: (Array.isArray(content.file_user_stories) ? content.file_user_stories : []).slice(0, 5),
        rules,
        functions,
        examples,
        database,
        dropped: Math.max(0, Number(r.dropped) || 0),
      });
    }
  }
  return { found };
}

// The story checks. A story must be in the story form, cite at least one rule, and every cited rule must exist in a
// file of its feature. The line numbers come from the stored rule, never from the runner.
function checkStories(value, featurePaths, approved) {
  if (!Array.isArray(value) || value.length > STORY_MAX) return { error: `A feature holds up to ${STORY_MAX} stories.` };
  const allowedPaths = new Set(featurePaths);
  const stories = [];
  for (const item of value) {
    const text = item && typeof item.story === "string" ? item.story.trim() : "";
    if (!text || text.length > STORY_TEXT_MAX || !STORY_SHAPE.test(text)) return { error: "Each story must read: As a <role> I can <action> so that <result>." };
    if (!Array.isArray(item.rules) || item.rules.length < 1 || item.rules.length > STORY_CITES_MAX) return { error: "Each story must cite 1 to 20 rules." };
    const cites = [];
    for (const cite of item.rules) {
      const file = cite && typeof cite.file === "string" ? cite.file : "";
      const ruleId = cite && typeof cite.id === "string" ? cite.id : "";
      if (!allowedPaths.has(file)) return { error: "A story cites a file that is not in its feature." };
      const rule = (approved.get(file) || { rules: [] }).rules.find((r) => r.id === ruleId);
      if (!rule) return { error: "A story cites a rule that does not exist in the approved assessment." };
      if (!cites.some((c) => c.file === file && c.id === ruleId)) cites.push({ file, id: ruleId, lines: rule.lines });
    }
    stories.push({ id: `S${stories.length + 1}`, story: text, rules: cites, status: "draft" });
  }
  return { stories };
}

async function startStories(request, env, id) {
  const access = await analysisAccess(env, request, id);
  if (access.response) return access.response;
  if (!canStart(access.member)) return json({ error: "Only platform engineers can draft the user stories." }, 403);
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const groupingId = String(parsed.value?.grouping_id || "");
  if (!UUID_PATTERN.test(groupingId)) return json({ error: "Choose a grouping." }, 400);
  const row = access.row;
  if (row.status !== "complete") return json({ error: "Finish the assessment first." }, 409);
  if (!row.model_key_id) return json({ error: "Choose a language model for this analysis first." }, 409);
  const found = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&analysis_id=eq.${id}&select=id,status,groups`);
  if (!found.ok) return json({ error: "Could not load the grouping." }, 502);
  const [grouping] = await found.json();
  if (!grouping) return json({ error: "Not found." }, 404);
  if (grouping.status !== "draft") return json({ error: "The stories are drafted on a draft grouping. Send it back or edit it first." }, 409);
  const chosen = await chooseAnalysisModel(env, row.workspace_id, row.model_key_id);
  if (chosen.response) return chosen.response;
  const busyResp = await refuseIfBusy(env, access.user, row.workspace_id, row.repo);
  if (busyResp) return busyResp;
  const modelToken = (await issueModelToken(env, id, row.model_key_id)) || "";
  if (!modelToken) return json({ error: "Could not prepare the model. Try again in a minute." }, 502);
  const refusedStart = await logFirst(env, { workspace_id: row.workspace_id, user: access.user, action: "stories_start", analysis_id: id, repo: row.repo, detail: `${(grouping.groups || []).length} features` });
  if (refusedStart) return refusedStart;
  const dispatch = await dispatchStories(env, { analysis_id: id, grouping_id: groupingId, model_token: modelToken });
  if (!dispatch.ok) return json({ error: "The runner could not be started. Try again in a minute." }, 502);
  return json({ queued: true }, 202);
}

function dispatchStories(env, inputs) {
  return fetch(`https://api.github.com/repos/${env.RUNNER_REPO}/actions/workflows/stories.yml/dispatches`, {
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

// The runner reads the features of a draft grouping and the approved rules of their files. Read only, with the secret.
async function storySources(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const groupingId = new URL(request.url).searchParams.get("grouping_id") || "";
  if (!UUID_PATTERN.test(groupingId)) return json({ error: "Choose a grouping." }, 400);
  const found = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&analysis_id=eq.${id}&select=id,status,groups`);
  if (!found.ok) return json({ error: "Could not load the grouping." }, 502);
  const [grouping] = await found.json();
  if (!grouping || grouping.status !== "draft") return json({ error: "Not found." }, 404);
  const groups = Array.isArray(grouping.groups) ? grouping.groups : [];
  const approved = await approvedRulesFor(env, id, groups.flatMap((g) => g.paths || []));
  if (approved.failed) return json({ error: "Could not load the approved rules." }, 502);
  const features = groups.map((g, index) => {
    const files = (g.paths || []).filter((p) => approved.found.has(p)).map((p) => ({ path: p, content: approved.found.get(p) }));
    return { index, name: g.name, summary: g.summary || "", files, missing_files: (g.paths || []).length - files.length };
  });
  return json({ features });
}

// The runner posts the stories of each feature. Each rule is checked against the approved assessment; a feature whose
// name has changed since the draft was started is refused, so stories are never put on the wrong feature.
async function saveStories(request, env, id) {
  if (!timingSafeEqual(request.headers.get("x-runner-secret") || "", env.RUNNER_SECRET || "")) {
    return json({ error: "Unauthorized." }, 401);
  }
  const found = await serviceRest(env, `analyses?id=eq.${id}&select=id,workspace_id,repo`);
  if (!found.ok) return json({ error: "Could not load the analysis." }, 502);
  const [analysis] = await found.json();
  if (!analysis) return json({ error: "Not found." }, 404);
  const parsed = await readJson(request, 120000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const groupingId = typeof body.grouping_id === "string" ? body.grouping_id : "";
  if (!UUID_PATTERN.test(groupingId)) return json({ error: "Choose a grouping." }, 400);
  const current = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&analysis_id=eq.${id}&select=id,status,groups`);
  if (!current.ok) return json({ error: "Could not load the grouping." }, 502);
  const [grouping] = await current.json();
  if (!grouping || grouping.status !== "draft") return json({ error: "Not found." }, 404);
  if (body.status !== "ok") {
    const refusedFail = await logFirst(env, { workspace_id: analysis.workspace_id, user: null, action: "stories_fail", analysis_id: id, repo: analysis.repo, detail: typeof body.reason === "string" ? body.reason.slice(0, 200) : null });
    if (refusedFail) return refusedFail;
    return json({ saved: false, reason: typeof body.reason === "string" ? body.reason.slice(0, 300) : "The stories were not drafted." });
  }
  const groups = Array.isArray(grouping.groups) ? grouping.groups : [];
  const incoming = Array.isArray(body.features) ? body.features : [];
  const approved = await approvedRulesFor(env, id, groups.flatMap((g) => g.paths || []));
  if (approved.failed) return json({ error: "Could not load the approved rules." }, 502);
  const next = groups.map((g, index) => ({ ...g }));
  let count = 0;
  for (const item of incoming) {
    const index = Number(item && item.index);
    if (!Number.isInteger(index) || index < 0 || index >= groups.length) return json({ error: "A feature does not match the grouping." }, 409);
    if (String(item.name || "") !== groups[index].name) return json({ error: "The features changed while the stories were drafted. Draft them again." }, 409);
    const checked = checkStories(item.stories, groups[index].paths || [], approved.found);
    if (checked.error) return json({ error: checked.error }, 400);
    next[index].stories = checked.stories;
    count += checked.stories.length;
  }
  const serialised = JSON.stringify(next);
  if (serialised.length > 40000) return json({ error: "The stories are too large to save." }, 400);
  const refused = await logFirst(env, { workspace_id: analysis.workspace_id, user: null, action: "stories_finish", analysis_id: id, repo: analysis.repo, detail: `${count} stories` });
  if (refused) return refused;
  const res = await serviceRest(env, `feature_groupings?id=eq.${groupingId}&status=eq.draft`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ groups: next }),
  });
  if (!res.ok) return json({ error: "Could not save the stories." }, 502);
  return json({ saved: true, stories: count }, 201);
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
  // A path that already has an approved or edited result keeps it. Only new paths are saved.
  const keptPaths = new Set();
  for (const status of ["approved", "edited"]) {
    const found = await serviceRest(env, `file_findings?analysis_id=eq.${id}&review_status=eq.${status}&select=path&limit=100000`);
    if (!found.ok) return json({ error: "Could not check the earlier file results." }, 502);
    for (const item of await found.json()) keptPaths.add(item.path);
  }
  const fresh = rows.filter((row) => !keptPaths.has(row.path));
  const kept = rows.length - fresh.length;
  const bytes = new TextEncoder().encode(JSON.stringify(fresh)).length;
  const total = Number(analysis.file_bytes || 0) + bytes;
  if (total > FREE_TIER_ANALYSIS_BYTES) {
    await serviceRest(env, `file_findings?analysis_id=eq.${id}&review_status=eq.draft`, { method: "DELETE", headers: { prefer: "return=minimal" } });
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
  if (fresh.length > 0) {
    const res = await serviceRest(env, "file_findings", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify(fresh.map((row) => ({ ...row, analysis_id: id }))),
    });
    if (!res.ok) return json({ error: "Could not save these file results. A path may already be saved." }, 502);
  }
  const update = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ status: "running", file_bytes: total }),
  });
  if (!update.ok) return json({ error: "Could not update the analysis." }, 502);
  return json({ saved: fresh.length, kept, total_bytes: total }, 201);
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
  const current = await loadAnalysis(env, id);
  if (current.row) {
    const refused = await logFirst(env, { workspace_id: current.row.workspace_id, action: body.status === "complete" ? "finish" : "fail", analysis_id: id, repo: current.row.repo, commit_sha: update.commit_sha, detail: body.status === "complete" ? "Runner" : update.error });
    if (refused) return refused;
  }
  const res = await serviceRest(env, `analyses?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(update),
  });
  if (!res.ok) return json({ error: "Could not save the result." }, 502);
  // The drafts this run wrote are stamped with the commit it read. Approved results keep the commit they were approved at,
  // so the portal can flag one that is older than the code now analysed. Stamping only fills in drafts without a commit.
  if (update.commit_sha) {
    const stamped = await serviceRest(env, `file_findings?analysis_id=eq.${id}&review_status=eq.draft&commit_sha=is.null`, {
      method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ commit_sha: update.commit_sha }),
    });
    if (!stamped.ok) return json({ error: "Could not record the commit for the file results." }, 502);
  }
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

// ---- Retention: assessments nobody opens, and the size of the action log ----

const UNOPENED_MS = 90 * 24 * 60 * 60 * 1000;
const OPENED_SAVE_MS = 60 * 60 * 1000;
const LOG_TRIM_AT = 0.7; // the log is trimmed once the database passes 70% of its limit
const LOG_TRIM_SHARE = 0.2; // one run removes the oldest 20% of log rows. Freed space is reclaimed later, so this is gradual.
const SYSTEM_WORKSPACE = "00000000-0000-0000-0000-000000000000"; // the log entries that belong to no workspace

// Notes that an assessment was opened, at most once an hour, so the 90-day rule knows it is still in use.
async function noteOpened(env, row) {
  if (row.last_opened_at && Date.now() - Date.parse(row.last_opened_at) < OPENED_SAVE_MS) return;
  const now = new Date().toISOString();
  await serviceRest(env, `analyses?id=eq.${row.id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ last_opened_at: now }),
  });
  row.last_opened_at = now;
}

// Deletes assessments not opened for 90 days (or, if never opened, not created for 90 days).
// Each one is logged, and the deletion record is saved, before anything is removed. If either cannot be saved, nothing is removed.
async function purgeUnopened(env) {
  const cutoff = encodeURIComponent(new Date(Date.now() - UNOPENED_MS).toISOString());
  const cols = "id,repo,workspace_id,owner_id,app_name,source_path,source_kind";
  const opened = await serviceRest(env, `analyses?last_opened_at=lt.${cutoff}&select=${cols}`);
  const never = await serviceRest(env, `analyses?last_opened_at=is.null&created_at=lt.${cutoff}&select=${cols}`);
  if (!opened.ok || !never.ok) throw new Error("Unopened lookup failed.");
  const rows = [...(await opened.json()), ...(await never.json())];
  if (rows.length === 0) return;
  for (const r of rows) {
    if (!(await recordAction(env, { workspace_id: r.workspace_id, action: "retention_delete", analysis_id: r.id, repo: r.repo, detail: "Not opened for 90 days" }))) {
      throw new Error("Could not record a deletion in the log, so nothing was deleted.");
    }
  }
  if (!(await recordDeletion(env, rows, "unopened"))) {
    throw new Error("Could not save the deletion records, so nothing was deleted.");
  }
  for (const r of rows) {
    if (!(await deleteSourceFile(env, r))) throw new Error("Could not delete an uploaded zip, so the rest was kept.");
  }
  const ids = rows.map((r) => r.id).join(",");
  const res = await serviceRest(env, `analyses?id=in.(${ids})`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  if (!res.ok) throw new Error(`Unopened purge failed with status ${res.status}`);
  // Tell the owner and the workspace admins, in the portal and by email. The deletion is also in the log.
  for (const r of rows) {
    const admins = await adminIdsExcept(env, r.workspace_id, SYSTEM_WORKSPACE);
    const people = [r.owner_id, ...admins];
    const title = `Deleted after 90 days unopened: ${r.app_name || r.repo}`;
    const body = "Nobody opened this assessment for 90 days, so its results were removed. The deletion is recorded in the action log.";
    await notifyPeople(env, r.workspace_id, people, { kind: "retention_deleted", tone: "warning", title, body });
    await emailPeople(env, r.workspace_id, people, `Cutover: ${title}`, `${body}\n\nOpen the Cutover portal to see the action log for this workspace.`);
  }
}

// Trims the action log once the database passes 70% of its limit: the oldest 20% of entries go, once per run.
async function trimLog(env) {
  const size = await serviceRest(env, "rpc/database_size_bytes", { method: "POST", body: "{}" });
  if (!size.ok) throw new Error("Could not read the database size.");
  const bytes = Number(await size.json());
  if (!Number.isFinite(bytes) || bytes < FREE_TIER_DATABASE_BYTES * LOG_TRIM_AT) return;
  const logged = await recordAction(env, { workspace_id: SYSTEM_WORKSPACE, action: "log_trim", detail: `Database over 70% of its limit. Removing the oldest ${Math.round(LOG_TRIM_SHARE * 100)}% of log entries.` });
  if (!logged) throw new Error("Could not record the log trim, so nothing was removed.");
  const res = await serviceRest(env, "rpc/purge_oldest_assessment_log", { method: "POST", body: JSON.stringify({ batch_share: LOG_TRIM_SHARE }) });
  if (!res.ok) throw new Error("The log trim failed.");
}

// ---- Email (Resend). Off until RESEND_API_KEY and EMAIL_FROM are set. The portal notice is always written. ----

// Sends one email to people in a workspace. Never throws: a failed email must not undo the action it reports.
async function emailPeople(env, workspaceId, userIds, subject, text) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  const ids = [...new Set((userIds || []).filter((id) => typeof id === "string" && UUID_PATTERN.test(id)))];
  if (ids.length === 0) return false;
  try {
    const res = await serviceRest(env, `members?workspace_id=eq.${workspaceId}&select=user_id,email`);
    if (!res.ok) return false;
    const to = (await res.json()).filter((m) => ids.includes(m.user_id) && m.email).map((m) => m.email);
    if (to.length === 0) return false;
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject: String(subject).slice(0, 200), text: String(text).slice(0, 4000) }),
    });
    return sent.ok;
  } catch {
    return false;
  }
}

// The daily job. Each step runs on its own, so one failing step does not stop the others.
// The first failure is raised at the end, so the run is reported as failed.
async function runRetention(env) {
  let firstError = null;
  for (const step of [purgeExpired, purgeUnopened, trimLog, purgeClicks]) {
    try {
      await step(env);
    } catch (err) {
      console.error("Retention step failed:", err && err.message);
      firstError = firstError || err;
    }
  }
  if (firstError) throw firstError;
}

// ---- Where people click: anonymous click positions, read back as heat maps by workspace admins ----
// A click keeps only the screen, the position as a percentage of the screen (rounded), the width class and a
// button name from the page's own list. It never keeps who clicked, any text, field values or page content.
const CLICK_SCREEN = /^s-[a-z-]{1,30}$/;
const CLICK_TARGET = /^[a-z0-9-]{1,40}$/;
const CLICK_WIDTHS = ["phone", "tablet", "desktop"];
const CLICK_BATCH = 200;
const CLICK_READ_LIMIT = 50000;
const CLICK_KEEP_DAYS = 30;
const HEAT_CELLS = 20; // 5% cells across and down

async function recordClicks(request, env) {
  const auth = await requireUser(env, request);
  if (auth.response) return auth.response;
  const parsed = await readJson(request, 200_000);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value && typeof parsed.value === "object" ? parsed.value : {};
  const access = await workspaceAccessAs(env, auth, body.workspace_id);
  if (access.response) return access.response;
  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length === 0 || events.length > CLICK_BATCH) return json({ error: `Send 1 to ${CLICK_BATCH} clicks at a time.` }, 400);
  const rows = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const good = typeof e.screen === "string" && CLICK_SCREEN.test(e.screen)
      && Number.isInteger(e.x) && e.x >= 0 && e.x <= 100
      && Number.isInteger(e.y) && e.y >= 0 && e.y <= 100
      && CLICK_WIDTHS.includes(e.width)
      && (e.target == null || (typeof e.target === "string" && CLICK_TARGET.test(e.target)));
    if (good) rows.push({ workspace_id: access.workspace_id, screen: e.screen, target: e.target ?? null, x: e.x, y: e.y, width_class: e.width });
  }
  if (rows.length === 0) return json({ saved: 0 }, 202);
  const res = await serviceRest(env, "ui_clicks", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(rows) });
  if (!res.ok) return json({ error: "Could not save the clicks." }, 502);
  return json({ saved: rows.length }, 202);
}

async function heatmap(request, env, workspaceId) {
  // Only members of the workspace, as before: a Cutover role does not open a customer's heat map.
  const access = await workspaceAdmin(env, request, workspaceId);
  if (access.response) return access.response;
  const url = new URL(request.url);
  const screen = url.searchParams.get("screen") || "";
  if (!CLICK_SCREEN.test(screen)) return json({ error: "Choose a screen." }, 400);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), CLICK_KEEP_DAYS);
  const since = encodeURIComponent(new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());
  const res = await serviceRest(env, `ui_clicks?workspace_id=eq.${workspaceId}&screen=eq.${screen}&created_at=gte.${since}&select=x,y,target,width_class&limit=${CLICK_READ_LIMIT}`);
  if (!res.ok) return json({ error: "Could not load the clicks." }, 502);
  const rows = await res.json();
  const step = 100 / HEAT_CELLS;
  const cells = Array.from({ length: HEAT_CELLS }, () => new Array(HEAT_CELLS).fill(0));
  const targets = new Map();
  const widths = { phone: 0, tablet: 0, desktop: 0 };
  for (const r of rows) {
    const cx = Math.min(HEAT_CELLS - 1, Math.floor(r.x / step));
    const cy = Math.min(HEAT_CELLS - 1, Math.floor(r.y / step));
    cells[cy][cx] += 1;
    if (r.target) targets.set(r.target, (targets.get(r.target) || 0) + 1);
    if (widths[r.width_class] !== undefined) widths[r.width_class] += 1;
  }
  const topTargets = [...targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([target, count]) => ({ target, count }));
  return json({
    screen,
    days,
    total: rows.length,
    truncated: rows.length >= CLICK_READ_LIMIT,
    cells,
    targets: topTargets,
    widths,
  });
}

async function purgeClicks(env) {
  const cutoff = encodeURIComponent(new Date(Date.now() - CLICK_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString());
  const res = await serviceRest(env, `ui_clicks?created_at=lt.${cutoff}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  if (!res.ok) throw new Error(`Click retention failed with status ${res.status}`);
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
  // The marketing site hosts the booking page. It only calls the public booking routes, which need a signed link.
  const list = [...DEV_ORIGINS, SITE_ORIGIN, ...(env.APP_ORIGIN ? [env.APP_ORIGIN] : [])];
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
    if (path === "/api/me/time" && method === "POST") return recordScreenTime(request, env);
    if (path === "/api/me/engagement" && method === "GET") return engagementSummary(request, env);
    if (path === "/api/workspaces" && method === "POST") return createWorkspace(request, env);
    if (path === "/api/repo-check" && method === "GET") return repoCheck(request, env);
    if (path === "/api/admin/workspaces" && method === "GET") return overviewWorkspaces(request, env);
    if (path === "/api/admin/database" && method === "GET") return databaseSize(request, env);
    if (path === "/api/calendar" && method === "GET") return calendarStatus(request, env);
    if (path === "/api/calendar" && method === "DELETE") return calendarDisconnect(request, env);
    if (path === "/api/calendar/connect-url" && method === "POST") return calendarConnectUrl(request, env);
    if (path === "/api/calendar/callback" && method === "GET") return calendarCallback(request, env);
    if (path === "/api/staff/invitations" && method === "GET") return staffInvitations(request, env);
    if (path === "/api/prospects" && method === "GET") return listProspects(request, env);
    if (path === "/api/prospects" && method === "POST") return createProspect(request, env);
    const bookSlots = path.match(/^\/api\/book\/([^/]+)\/slots$/);
    if (bookSlots && method === "GET") return bookingSlots(request, env, decodeURIComponent(bookSlots[1]));
    const bookOne = path.match(/^\/api\/book\/([^/]+)$/);
    if (bookOne && method === "GET") return bookingInfo(request, env, decodeURIComponent(bookOne[1]));
    if (bookOne && method === "POST") return bookMeeting(request, env, decodeURIComponent(bookOne[1]));
    const bookCancel = path.match(/^\/api\/book\/([^/]+)\/cancel$/);
    if (bookCancel && method === "POST") return cancelMeeting(request, env, decodeURIComponent(bookCancel[1]));
    if (path === "/api/staff" && method === "GET") return listStaff(request, env);
    if (path === "/api/staff" && method === "POST") return addStaff(request, env);
    const staffOne = path.match(/^\/api\/staff\/(.+)$/);
    if (staffOne && method === "DELETE") return removeStaff(request, env, decodeURIComponent(staffOne[1]));

    if (path === "/api/clicks" && method === "POST") return recordClicks(request, env);
    const heatRoute = path.match(/^\/api\/workspaces\/([^/]+)\/heatmap$/);
    if (heatRoute && UUID_PATTERN.test(heatRoute[1]) && method === "GET") return heatmap(request, env, heatRoute[1]);

    const cleanupPreview = path.match(/^\/api\/workspaces\/([^/]+)\/cleanup\/superseded$/);
    if (cleanupPreview && UUID_PATTERN.test(cleanupPreview[1]) && method === "GET") return previewCleanup(request, env, cleanupPreview[1]);
    if (cleanupPreview && UUID_PATTERN.test(cleanupPreview[1]) && method === "POST") return runCleanup(request, env, cleanupPreview[1]);

    const oneWorkspace = path.match(/^\/api\/workspaces\/([^/]+)$/);
    if (oneWorkspace && method === "PATCH") return renameWorkspace(request, env, oneWorkspace[1]);
    if (oneWorkspace && method === "DELETE") return deleteWorkspace(request, env, oneWorkspace[1]);

    if (path === "/api/analyses" && method === "POST") return startAnalysis(request, env);
    if (path === "/api/analyses/upload" && method === "POST") return startUpload(request, env);
    if (path === "/api/analyses" && method === "GET") return listAnalyses(request, env);
    if (path === "/api/insights" && method === "GET") return workspaceInsights(request, env);

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
    const analysisRedraw = path.match(/^\/api\/analyses\/([^/]+)\/screens\/redraw$/);
    if (analysisRedraw && UUID_PATTERN.test(analysisRedraw[1]) && method === "POST") return redrawScreens(request, env, analysisRedraw[1]);
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
    const analysisOriginal = path.match(/^\/api\/analyses\/([^/]+)\/conversions\/original$/);
    if (analysisOriginal && UUID_PATTERN.test(analysisOriginal[1]) && method === "GET") return conversionOriginal(request, env, analysisOriginal[1]);
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

    const businessList = path.match(/^\/api\/analyses\/([^/]+)\/business$/);
    if (businessList && UUID_PATTERN.test(businessList[1]) && method === "GET") return listBusiness(request, env, businessList[1]);
    const businessApprove = path.match(/^\/api\/analyses\/([^/]+)\/business\/approve$/);
    if (businessApprove && UUID_PATTERN.test(businessApprove[1]) && method === "POST") return approveBusiness(request, env, businessApprove[1]);
    const groupings = path.match(/^\/api\/analyses\/([^/]+)\/groupings$/);
    if (groupings && UUID_PATTERN.test(groupings[1]) && method === "GET") return listGroupings(request, env, groupings[1]);
    const features = path.match(/^\/api\/analyses\/([^/]+)\/features$/);
    if (features && UUID_PATTERN.test(features[1]) && method === "GET") return listFeatures(request, env, features[1]);
    const groupingStart = path.match(/^\/api\/analyses\/([^/]+)\/groupings\/start$/);
    if (groupingStart && UUID_PATTERN.test(groupingStart[1]) && method === "POST") return startGrouping(request, env, groupingStart[1]);
    const groupingApprove = path.match(/^\/api\/analyses\/([^/]+)\/groupings\/approve$/);
    if (groupingApprove && UUID_PATTERN.test(groupingApprove[1]) && method === "POST") return approveGrouping(request, env, groupingApprove[1]);
    const groupingReject = path.match(/^\/api\/analyses\/([^/]+)\/groupings\/reject$/);
    if (groupingReject && UUID_PATTERN.test(groupingReject[1]) && method === "POST") return rejectGrouping(request, env, groupingReject[1]);
    const capabilityRename = path.match(/^\/api\/analyses\/([^/]+)\/capabilities$/);
    if (capabilityRename && UUID_PATTERN.test(capabilityRename[1]) && method === "PATCH") return renameCapability(request, env, capabilityRename[1]);
    const groupingEdit = path.match(/^\/api\/analyses\/([^/]+)\/groupings\/edit$/);
    if (groupingEdit && UUID_PATTERN.test(groupingEdit[1]) && method === "POST") return editGrouping(request, env, groupingEdit[1]);
    const groupingDiscard = path.match(/^\/api\/analyses\/([^/]+)\/groupings\/discard$/);
    if (groupingDiscard && UUID_PATTERN.test(groupingDiscard[1]) && method === "POST") return discardGrouping(request, env, groupingDiscard[1]);
    const storiesStart = path.match(/^\/api\/analyses\/([^/]+)\/groupings\/stories$/);
    if (storiesStart && UUID_PATTERN.test(storiesStart[1]) && method === "POST") return startStories(request, env, storiesStart[1]);
    const storiesSources = path.match(/^\/api\/runner\/([^/]+)\/story-sources$/);
    if (storiesSources && UUID_PATTERN.test(storiesSources[1]) && method === "GET") return storySources(request, env, storiesSources[1]);
    const storiesSave = path.match(/^\/api\/runner\/([^/]+)\/stories$/);
    if (storiesSave && UUID_PATTERN.test(storiesSave[1]) && method === "POST") return saveStories(request, env, storiesSave[1]);
    const groupingSave = path.match(/^\/api\/runner\/([^/]+)\/grouping$/);
    if (groupingSave && UUID_PATTERN.test(groupingSave[1]) && method === "POST") return saveGrouping(request, env, groupingSave[1]);
    const groupingInputs = path.match(/^\/api\/runner\/([^/]+)\/grouping-sources$/);
    if (groupingInputs && UUID_PATTERN.test(groupingInputs[1]) && method === "GET") return groupingSources(request, env, groupingInputs[1]);

    const businessStart = path.match(/^\/api\/analyses\/([^/]+)\/business\/start$/);
    if (businessStart && UUID_PATTERN.test(businessStart[1]) && method === "POST") return startBusiness(request, env, businessStart[1]);
    const businessDiscard = path.match(/^\/api\/analyses\/([^/]+)\/business\/discard$/);
    if (businessDiscard && UUID_PATTERN.test(businessDiscard[1]) && method === "POST") return discardBusiness(request, env, businessDiscard[1]);
    const businessSkip = path.match(/^\/api\/analyses\/([^/]+)\/business\/skip$/);
    if (businessSkip && UUID_PATTERN.test(businessSkip[1]) && method === "POST") return skipBusiness(request, env, businessSkip[1]);
    const screenDelete = path.match(/^\/api\/analyses\/([^/]+)\/screens\/([^/]+)$/);
    if (screenDelete && UUID_PATTERN.test(screenDelete[1]) && UUID_PATTERN.test(screenDelete[2]) && method === "DELETE") return deleteScreen(request, env, screenDelete[1], screenDelete[2]);
    const businessSum = path.match(/^\/api\/analyses\/([^/]+)\/business-summary$/);
    if (businessSum && UUID_PATTERN.test(businessSum[1]) && method === "GET") return businessSummary(request, env, businessSum[1]);
    const deepLinksRoute = path.match(/^\/api\/analyses\/([^/]+)\/deep-files\/links$/);
    if (deepLinksRoute && UUID_PATTERN.test(deepLinksRoute[1]) && method === "GET") return deepLinks(request, env, deepLinksRoute[1]);
    const deepSummaryRoute = path.match(/^\/api\/analyses\/([^/]+)\/deep-files\/summary$/);
    if (deepSummaryRoute && UUID_PATTERN.test(deepSummaryRoute[1]) && method === "GET") return deepSummary(request, env, deepSummaryRoute[1]);
    const deepList = path.match(/^\/api\/analyses\/([^/]+)\/deep-files$/);
    if (deepList && UUID_PATTERN.test(deepList[1]) && method === "GET") return listDeepFiles(request, env, deepList[1]);
    const deepApprove = path.match(/^\/api\/analyses\/([^/]+)\/deep-files\/approve$/);
    if (deepApprove && UUID_PATTERN.test(deepApprove[1]) && method === "POST") return approveDeepFile(request, env, deepApprove[1]);
    const deepDiscard = path.match(/^\/api\/analyses\/([^/]+)\/deep-files\/discard$/);
    if (deepDiscard && UUID_PATTERN.test(deepDiscard[1]) && method === "POST") return discardDeepFile(request, env, deepDiscard[1]);
    const analysisModel = path.match(/^\/api\/analyses\/([^/]+)\/model$/);
    if (analysisModel && UUID_PATTERN.test(analysisModel[1]) && method === "PATCH") return changeAnalysisModel(request, env, analysisModel[1]);
    const deepStart = path.match(/^\/api\/analyses\/([^/]+)\/deep-files\/start$/);
    if (deepStart && UUID_PATTERN.test(deepStart[1]) && method === "POST") return startDeepFile(request, env, deepStart[1]);
    const deepProgress = path.match(/^\/api\/runner\/([^/]+)\/deep-file-progress$/);
    if (deepProgress && UUID_PATTERN.test(deepProgress[1]) && method === "POST") return saveDeepProgress(request, env, deepProgress[1]);
    const businessProgress = path.match(/^\/api\/runner\/([^/]+)\/business-progress$/);
    if (businessProgress && UUID_PATTERN.test(businessProgress[1]) && method === "POST") return saveBusinessProgress(request, env, businessProgress[1]);
    const deepSave = path.match(/^\/api\/runner\/([^/]+)\/deep-file$/);
    if (deepSave && UUID_PATTERN.test(deepSave[1]) && method === "POST") return saveDeepFile(request, env, deepSave[1]);
    const businessSave = path.match(/^\/api\/runner\/([^/]+)\/business$/);
    if (businessSave && UUID_PATTERN.test(businessSave[1]) && method === "POST") return saveBusiness(request, env, businessSave[1]);

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
    const screenPaths = path.match(/^\/api\/runner\/([^/]+)\/screen-paths$/);
    if (screenPaths && UUID_PATTERN.test(screenPaths[1]) && method === "GET") {
      return runnerScreenPaths(request, env, screenPaths[1]);
    }
    const screensDone = path.match(/^\/api\/runner\/([^/]+)\/screens-done$/);
    if (screensDone && UUID_PATTERN.test(screensDone[1]) && method === "POST") {
      return runnerScreensDone(request, env, screensDone[1]);
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
    ctx.waitUntil(runRetention(env));
  },
};
