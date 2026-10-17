// Cutover SaaS API (Cloudflare Worker).
//
// Routes (all under /api). Every route needs a signed-in member, except the runner callback.
//   GET    /api/me                               your role
//   POST   /api/analyses                         start an analysis (not compliance reviewers)
//   GET    /api/analyses                         every analysis in the workspace
//   GET    /api/analyses/:id                     one analysis, with its comments and action items
//   DELETE /api/analyses/:id                     delete (the person who started it, or a workspace admin)
//   POST   /api/analyses/:id/comments            add a comment
//   DELETE /api/comments/:id                     delete a comment (its author, or a workspace admin)
//   POST   /api/analyses/:id/actions             add an action item (not compliance reviewers)
//   PATCH  /api/actions/:id                      mark an action item open or done (not compliance reviewers)
//   GET    /api/admin/invitations                list pending invitations (workspace admins)
//   POST   /api/admin/invitations                invite an email address with a role (workspace admins)
//   DELETE /api/admin/invitations/:email         remove a pending invitation (workspace admins)
//   POST   /api/runner/:id/result                runner callback with findings (shared secret)
//
// Only invited people can use the portal. An invitation turns into membership the first time
// the invited person signs in. A scheduled job deletes analyses past their expires_at (retention).
//
// Required secrets (set with `wrangler secret put`, never in code):
//   SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GITHUB_DISPATCH_TOKEN, RUNNER_SECRET
// Required vars (wrangler.toml): SUPABASE_URL, RUNNER_REPO

// GitHub owner: letters, digits, hyphens. Repo name: no leading dot, so "." and ".." are rejected.
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const REF_PATTERN = /^(?!.*\.\.)[A-Za-z0-9_./-]{1,200}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const ROLES = ["platform_engineer", "application_owner", "developer", "compliance_reviewer", "workspace_admin"];
const MAX_BODY_BYTES = 5_000_000; // findings can be large, but not unbounded
const MAX_COMMENT = 2000;
const MAX_TITLE = 200;

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

// Looks up the member row for a user. If there is none but an invitation exists for their
// email, the invitation becomes a member row and is used up. Returns the member row or null.
async function findOrAcceptMember(env, user) {
  const found = await serviceRest(env, `members?user_id=eq.${user.id}&select=user_id,email,role`);
  if (!found.ok) return null;
  const [existing] = await found.json();
  if (existing) return existing;

  const email = String(user.email || "").toLowerCase();
  if (!email) return null;
  const invite = await serviceRest(env, `invitations?email=eq.${encodeURIComponent(email)}&select=email,role`);
  if (!invite.ok) return null;
  const [pending] = await invite.json();
  if (!pending) return null;

  const created = await serviceRest(env, "members", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ user_id: user.id, email, role: pending.role }),
  });
  if (!created.ok) return null;
  await serviceRest(env, `invitations?email=eq.${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  const [row] = await created.json();
  return row || null;
}

// Gate for every signed-in route. Responds with 401 (not signed in) or 403 (signed in, not invited).
async function requireMember(env, request) {
  const user = await currentUser(env, request);
  if (!user) return { response: json({ error: "Sign in first." }, 401) };
  const member = await findOrAcceptMember(env, user);
  if (!member) return { response: json({ error: "Your account has not been invited to Cutover." }, 403) };
  return { user, member };
}

// Gate for admin routes: members with the workspace_admin role only.
async function requireAdmin(env, request) {
  const gate = await requireMember(env, request);
  if (gate.response) return gate;
  if (gate.member.role !== "workspace_admin") {
    return { response: json({ error: "Only workspace admins can do this." }, 403) };
  }
  return gate;
}

// Compliance reviewers read and comment. They do not start analyses or change the work.
function isReviewerOnly(member) {
  return member.role === "compliance_reviewer";
}

// Calls PostgREST as the signed-in user, so row-level security applies.
function userRest(env, token, path, init = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

// Calls PostgREST with the service role. Only used after the member check in this file.
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

async function me(request, env) {
  const gate = await requireMember(env, request);
  if (gate.response) return gate.response;
  return json({ email: gate.user.email, role: gate.member.role });
}

async function startAnalysis(request, env) {
  const gate = await requireMember(env, request);
  if (gate.response) return gate.response;
  if (isReviewerOnly(gate.member)) {
    return json({ error: "Compliance reviewers cannot start analyses." }, 403);
  }
  const token = request.headers.get("authorization").slice(7);

  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const { repo, ref, app_name, data_rules_confirmed } = parsed.value || {};
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

  // Create the row as the user, so RLS enforces owner_id = auth.uid().
  const created = await userRest(env, token, "analyses", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      owner_id: gate.user.id,
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

// Every member sees every analysis in the workspace. The owner id is not exposed; is_mine says if it is yours.
async function listAnalyses(request, env) {
  const gate = await requireMember(env, request);
  if (gate.response) return gate.response;
  const res = await serviceRest(env,
    "analyses?select=id,owner_id,repo,ref,app_name,status,commit_sha,created_at,finished_at,expires_at&order=created_at.desc&limit=100");
  if (!res.ok) return json({ error: "Could not load analyses." }, 502);
  const rows = await res.json();
  return json(rows.map(({ owner_id, ...rest }) => ({ ...rest, is_mine: owner_id === gate.user.id })));
}

async function getAnalysis(request, env, id) {
  const gate = await requireMember(env, request);
  if (gate.response) return gate.response;
  const found = await loadAnalysis(env, id);
  if (found.failed) return json({ error: "Could not load the analysis." }, 502);
  if (found.missing) return json({ error: "Not found." }, 404);

  const [commentsRes, actionsRes] = await Promise.all([
    serviceRest(env, `analysis_comments?analysis_id=eq.${id}&select=id,author_id,author_email,body,created_at&order=created_at.asc`),
    serviceRest(env, `action_items?analysis_id=eq.${id}&select=id,title,status,created_by_email,done_by_email,created_at,done_at&order=created_at.asc`),
  ]);
  if (!commentsRes.ok || !actionsRes.ok) return json({ error: "Could not load the analysis." }, 502);

  const isAdmin = gate.member.role === "workspace_admin";
  const { owner_id, ...analysis } = found.row;
  const comments = (await commentsRes.json()).map(({ author_id, ...c }) => ({
    ...c,
    can_delete: author_id === gate.user.id || isAdmin,
  }));
  return json({
    ...analysis,
    is_mine: owner_id === gate.user.id,
    can_delete: owner_id === gate.user.id || isAdmin,
    viewer_role: gate.member.role,
    comments,
    action_items: await actionsRes.json(),
  });
}

async function deleteAnalysis(request, env, id) {
  const gate = await requireMember(env, request);
  if (gate.response) return gate.response;
  const found = await loadAnalysis(env, id);
  if (found.failed) return json({ error: "Could not load the analysis." }, 502);
  if (found.missing) return json({ error: "Not found." }, 404);

  const isOwner = found.row.owner_id === gate.user.id;
  if (!isOwner && gate.member.role !== "workspace_admin") {
    return json({ error: "Only the person who started this analysis or a workspace admin can delete it." }, 403);
  }
  if (!(await recordDeletion(env, [{ id, repo: found.row.repo }], "requested"))) {
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
  const gate = await requireMember(env, request);
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const text = typeof parsed.value?.body === "string" ? parsed.value.body.trim() : "";
  if (!text || text.length > MAX_COMMENT) {
    return json({ error: `Comments must be 1 to ${MAX_COMMENT} characters.` }, 400);
  }
  const found = await loadAnalysis(env, id);
  if (found.failed) return json({ error: "Could not load the analysis." }, 502);
  if (found.missing) return json({ error: "Not found." }, 404);

  const res = await serviceRest(env, "analysis_comments", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ analysis_id: id, author_id: gate.user.id, author_email: gate.user.email, body: text }),
  });
  if (!res.ok) return json({ error: "Could not save the comment." }, 502);
  return json({ saved: true }, 201);
}

async function deleteComment(request, env, id) {
  const gate = await requireMember(env, request);
  if (gate.response) return gate.response;
  const res = await serviceRest(env, `analysis_comments?id=eq.${id}&select=id,author_id`);
  if (!res.ok) return json({ error: "Could not load the comment." }, 502);
  const [comment] = await res.json();
  if (!comment) return json({ error: "Not found." }, 404);
  if (comment.author_id !== gate.user.id && gate.member.role !== "workspace_admin") {
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
  const gate = await requireMember(env, request);
  if (gate.response) return gate.response;
  if (isReviewerOnly(gate.member)) {
    return json({ error: "Compliance reviewers can read and comment, but cannot add action items." }, 403);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const title = typeof parsed.value?.title === "string" ? parsed.value.title.trim() : "";
  if (!title || title.length > MAX_TITLE) {
    return json({ error: `Action items must be 1 to ${MAX_TITLE} characters.` }, 400);
  }
  const found = await loadAnalysis(env, id);
  if (found.failed) return json({ error: "Could not load the analysis." }, 502);
  if (found.missing) return json({ error: "Not found." }, 404);

  const res = await serviceRest(env, "action_items", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ analysis_id: id, title, created_by: gate.user.id, created_by_email: gate.user.email }),
  });
  if (!res.ok) return json({ error: "Could not save the action item." }, 502);
  return json({ saved: true }, 201);
}

async function updateAction(request, env, id) {
  const gate = await requireMember(env, request);
  if (gate.response) return gate.response;
  if (isReviewerOnly(gate.member)) {
    return json({ error: "Compliance reviewers can read and comment, but cannot change action items." }, 403);
  }
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const status = parsed.value?.status;
  if (status !== "open" && status !== "done") {
    return json({ error: "status must be open or done." }, 400);
  }
  const change = status === "done"
    ? { status, done_by_email: gate.user.email, done_at: new Date().toISOString() }
    : { status, done_by_email: null, done_at: null };
  const res = await serviceRest(env, `action_items?id=eq.${id}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(change),
  });
  if (!res.ok) return json({ error: "Could not update the action item." }, 502);
  return json({ updated: true });
}

async function listInvitations(request, env) {
  const gate = await requireAdmin(env, request);
  if (gate.response) return gate.response;
  const res = await serviceRest(env, "invitations?select=email,role,created_at&order=created_at.desc");
  if (!res.ok) return json({ error: "Could not load invitations." }, 502);
  return json(await res.json());
}

async function createInvitation(request, env) {
  const gate = await requireAdmin(env, request);
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const body = parsed.value || {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    return json({ error: "Enter a valid email address." }, 400);
  }
  if (!ROLES.includes(body.role)) {
    return json({ error: `Role must be one of: ${ROLES.join(", ")}.` }, 400);
  }
  const res = await serviceRest(env, "invitations?on_conflict=email", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ email, role: body.role, invited_by: gate.user.id }),
  });
  if (!res.ok) return json({ error: "Could not save the invitation." }, 502);
  return json({ invited: email, role: body.role }, 201);
}

async function deleteInvitation(request, env, email) {
  const gate = await requireAdmin(env, request);
  if (gate.response) return gate.response;
  const res = await serviceRest(env, `invitations?email=eq.${encodeURIComponent(email.trim().toLowerCase())}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (!res.ok) return json({ error: "Could not remove the invitation." }, 502);
  return json({ removed: true });
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
  const gate = await requireMember(env, request);
  if (gate.response) return gate.response;
  const url = new URL(request.url);
  const repo = url.searchParams.get("repo") || "";
  const ref = url.searchParams.get("ref") || "";
  if (!REPO_PATTERN.test(repo)) return json({ error: "Use the form owner/name." }, 400);
  if (ref && !REF_PATTERN.test(ref)) return json({ error: "The branch, tag or commit name is not valid." }, 400);

  const access = await readToken(env, repo);
  if (access.notInstalled) {
    return json({
      ok: false,
      reason: "not_readable",
      message: "Cutover cannot read this repository yet. Check the name, or install the Cutover reader on it, then check again.",
      install_url: `https://github.com/apps/${APP_SLUG}/installations/new`,
    });
  }
  if (access.failed) return json({ ok: false, reason: "failed", message: "Cutover could not check the repository right now. Try again in a minute." });

  const h = { ...GH_HEADERS, authorization: `Bearer ${access.token}` };
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

    if (path === "/api/analyses" && method === "POST") return startAnalysis(request, env);
    if (path === "/api/analyses" && method === "GET") return listAnalyses(request, env);
    if (path === "/api/repo-check" && method === "GET") return repoCheck(request, env);

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

    if (path === "/api/admin/invitations" && method === "GET") return listInvitations(request, env);
    if (path === "/api/admin/invitations" && method === "POST") return createInvitation(request, env);
    const invite = path.match(/^\/api\/admin\/invitations\/([^/]+)$/);
    if (invite && method === "DELETE") return deleteInvitation(request, env, decodeURIComponent(invite[1]));

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
