// Tests for the Worker's behavior: who can see and change what, and what is recorded.
//   node --test service/worker/test/api.test.mjs
// Supabase is replaced by a small in-memory stand-in (it understands the filters the Worker uses),
// and GitHub is mocked. No real account, database or secret is needed.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import worker from "../src/index.mjs";

const appKeys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

const env = {
  SUPABASE_URL: "https://example.supabase.test",
  SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-test",
  GITHUB_DISPATCH_TOKEN: "gh-test",
  RUNNER_SECRET: "runner-secret-test",
  RUNNER_REPO: "owner/cutover",
  GITHUB_APP_ID: "5361797",
  GITHUB_APP_PRIVATE_KEY: appKeys.privateKey,
  OPERATOR_EMAILS: "operator@cutover.test",
};

// ---- Fixed identities and records ----
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const W_ACME = uid(101);
const W_BETA = uid(102);
const PEOPLE = {
  admin_a: { id: uid(1), email: "admin@acme.test", name: "Ada Admin" },
  eng_a: { id: uid(2), email: "engineer@acme.test", name: "Eli Engineer" },
  sec_a: { id: uid(3), email: "security@acme.test" },
  inf_a: { id: uid(4), email: "informatics@acme.test" },
  cio_a: { id: uid(5), email: "cio@acme.test" },
  aud_a: { id: uid(6), email: "auditor@acme.test" },
  eng_b: { id: uid(7), email: "engineer@beta.test" },
  operator: { id: uid(8), email: "operator@cutover.test", name: "Olivia Operator" },
  newhire: { id: uid(9), email: "newhire@acme.test" },
  stranger: { id: uid(10), email: "stranger@example.test" },
};
const AN_ACME = uid(201);
const AN_BETA = uid(202);
const COMMENT_ACME = uid(301);
const ACTION_ACME = uid(401);
const CONTINGENCY_ACME = uid(501);
const AN_RUNNING = uid(203);
const FILE_ACME = uid(601);
const NOW = "2026-10-17T12:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const LONG_AGO = "2020-01-01T00:00:00.000Z";

const item = (category, title, extra = {}) => ({
  category, title, value: true, confidence: "high", evidence: ["src/file.cs"], evidence_count: 1, ...extra,
});
const REPORT = {
  schema_version: 1,
  generated_at: NOW,
  source: { type: "github", url: "https://github.com/acme/app", ref: null, commit: "abc123" },
  history: { available: true, total_commits: 10 },
  findings: {
    sec1: item("security", "Admin role has no MFA check", { severity: "high" }),
    priv1: item("privacy", "Logs contain identifiers"),
    data1: item("data", "Patient table has 40 columns", { severity: "medium" }),
    epic1: item("epic", "Bridges interface found"),
    stack1: item("stack", "Java 11"),
    ui1: item("ui_portal", "Login page"),
    cont1: item("containers", "Dockerfile found"),
    del1: item("delivery", "CI pipeline found"),
    inf1: item("infrastructure", "Linux VMs described"),
  },
  flags: ["sec1", "data1"],
  limitations: ["Only the code in this repository is read."],
};

function seed() {
  return {
    workspaces: [
      { id: W_ACME, name: "Acme Health", created_at: NOW },
      { id: W_BETA, name: "Beta Clinic", created_at: NOW },
    ],
    members: [
      { workspace_id: W_ACME, user_id: PEOPLE.admin_a.id, email: PEOPLE.admin_a.email, role: "platform_engineer", is_admin: true, created_at: NOW },
      { workspace_id: W_ACME, user_id: PEOPLE.eng_a.id, email: PEOPLE.eng_a.email, role: "platform_engineer", is_admin: false, created_at: NOW },
      { workspace_id: W_ACME, user_id: PEOPLE.sec_a.id, email: PEOPLE.sec_a.email, role: "security_officer", is_admin: false, created_at: NOW },
      { workspace_id: W_ACME, user_id: PEOPLE.inf_a.id, email: PEOPLE.inf_a.email, role: "informatics_lead", is_admin: false, created_at: NOW },
      { workspace_id: W_ACME, user_id: PEOPLE.cio_a.id, email: PEOPLE.cio_a.email, role: "cio_cto", is_admin: false, created_at: NOW },
      { workspace_id: W_ACME, user_id: PEOPLE.aud_a.id, email: PEOPLE.aud_a.email, role: "auditor", is_admin: false, created_at: NOW },
      { workspace_id: W_BETA, user_id: PEOPLE.eng_b.id, email: PEOPLE.eng_b.email, role: "platform_engineer", is_admin: true, created_at: NOW },
    ],
    invitations: [
      { workspace_id: W_ACME, email: PEOPLE.newhire.email, role: "auditor", is_admin: false, created_at: NOW },
    ],
    analyses: [
      { id: AN_ACME, workspace_id: W_ACME, owner_id: PEOPLE.eng_a.id, repo: "acme/app", ref: null, app_name: "Acme app",
        status: "complete", commit_sha: "abc123", findings: structuredClone(REPORT), error: null,
        created_at: NOW, finished_at: NOW, expires_at: FAR_FUTURE },
      { id: AN_BETA, workspace_id: W_BETA, owner_id: PEOPLE.eng_b.id, repo: "beta/app", ref: null, app_name: "Beta app",
        status: "complete", commit_sha: "def456", findings: structuredClone(REPORT), error: null,
        created_at: NOW, finished_at: NOW, expires_at: FAR_FUTURE },
    ],
    file_findings: [
      { id: FILE_ACME, analysis_id: AN_ACME, path: "src/A.java", category: "source", purpose: "Application code.",
        suggestions: [{ text: "No test file was found for this code.", severity: "medium" }], sample_only: true,
        review_status: "draft", reviewed_by_email: null, reviewed_at: null, created_at: NOW },
    ],
    analysis_comments: [
      { id: COMMENT_ACME, analysis_id: AN_ACME, author_id: PEOPLE.eng_a.id, author_email: PEOPLE.eng_a.email, body: "Start here.", created_at: NOW },
    ],
    action_items: [
      { id: ACTION_ACME, analysis_id: AN_ACME, title: "Confirm HL7 scope", status: "open", created_by: PEOPLE.eng_a.id, created_by_email: PEOPLE.eng_a.email, created_at: NOW, done_at: null, done_by_email: null },
    ],
    contingencies: [
      { id: CONTINGENCY_ACME, analysis_id: AN_ACME, finding_id: "hl7.gap", risk: "Patient messages stop during cutover",
        contingency: "Keep the old interface running read-only until the new one passes the message test.",
        rollback_step: null, trigger_condition: null, owner_email: null, status: "proposed",
        created_by: PEOPLE.eng_a.id, created_by_email: PEOPLE.eng_a.email, updated_by_email: null,
        created_at: NOW, updated_at: NOW },
    ],
    deletion_log: [],
    privacy_signoffs: [],
  };
}

// ---- A small stand-in for Supabase's REST API ----
let state;
let outbound;
let github;
let failLog;
const realFetch = globalThis.fetch;

const j = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const SKIP_PARAMS = ["select", "order", "limit", "offset", "on_conflict"];

function matches(row, key, value) {
  if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
  if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
  if (value.startsWith("lt.")) return String(row[key]) < value.slice(3);
  throw new Error(`Unsupported filter ${value}`);
}

// Each new sign-off row gets a later time than the one before, so "newest first" is unambiguous.
let signoffClock = Date.parse(NOW);

function defaultsFor(table) {
  const base = { id: randomUUID(), created_at: NOW };
  if (table === "privacy_signoffs") return { ...base, created_at: new Date(signoffClock += 1000).toISOString() };
  if (table === "analyses") return { ...base, status: "queued", findings: null, error: null, commit_sha: null, finished_at: null, expires_at: FAR_FUTURE };
  if (table === "action_items") return { ...base, status: "open", done_at: null, done_by_email: null };
  if (table === "members" || table === "invitations") return { is_admin: false, ...base };
  return base;
}

const DATABASE_BYTES = 125 * 1024 * 1024;

function handleRest(url, init) {
  const u = new URL(url);
  const table = u.pathname.replace("/rest/v1/", "");
  if (table === "rpc/database_size_bytes") return j(DATABASE_BYTES);
  const method = init.method || "GET";
  const prefer = init.headers?.prefer || "";
  const rows = state[table];
  const filters = [...u.searchParams.entries()].filter(([k]) => !SKIP_PARAMS.includes(k));
  const hit = (row) => filters.every(([k, v]) => matches(row, k, v));

  if (method === "GET") {
    let out = rows.filter(hit).map((r) => ({ ...r }));
    if ((u.searchParams.get("select") || "").includes("workspace:workspaces")) {
      out = out.map((r) => {
        const ws = state.workspaces.find((w) => w.id === r.workspace_id);
        return { ...r, workspace: ws ? { id: ws.id, name: ws.name } : null };
      });
    }
    return j(out);
  }

  if (method === "POST") {
    if (table === "deletion_log" && failLog) return j({ message: "forced failure" }, 500);
    const body = JSON.parse(init.body);
    const list = Array.isArray(body) ? body : [body];
    const onConflict = u.searchParams.get("on_conflict")?.split(",");
    const inserted = [];
    for (const b of list) {
      if (table === "deletion_log") {
        const row = { id: state.deletion_log.length + 1, deleted_at: NOW, ...b };
        state.deletion_log.push(row);
        inserted.push(row);
        continue;
      }
      if (onConflict) {
        const existing = rows.find((r) => onConflict.every((c) => String(r[c]) === String(b[c])));
        if (existing) {
          if (!prefer.includes("merge-duplicates")) return j({ message: "duplicate" }, 409);
          Object.assign(existing, b);
          inserted.push(existing);
          continue;
        }
      }
      const row = { ...defaultsFor(table), ...b };
      rows.push(row);
      inserted.push(row);
    }
    return prefer.includes("return=representation") ? j(inserted, 201) : new Response(null, { status: 201 });
  }

  if (method === "PATCH") {
    const changed = rows.filter(hit);
    for (const row of changed) Object.assign(row, JSON.parse(init.body));
    return prefer.includes("return=representation") ? j(changed.map((r) => ({ ...r }))) : new Response(null, { status: 204 });
  }

  if (method === "DELETE") {
    state[table] = rows.filter((r) => !hit(r));
    return new Response(null, { status: 204 });
  }
  return j({ message: "unsupported" }, 405);
}

function handleGithub(url, init) {
  const path = url.split("?")[0];
  if (path.endsWith("/installation")) {
    if (path.includes("/repos/private/missing/")) return j({ message: "Not Found" }, 404);
    return j({ id: 99 });
  }
  if (path.endsWith("/app/installations/99/access_tokens")) return j({ token: "ghs_test" }, 201);
  if (path.endsWith("/actions/workflows/analyze.yml/dispatches")) {
    github.dispatches.push(JSON.parse(init.body));
    return github.dispatchOk ? new Response(null, { status: 204 }) : j({ message: "failed" }, 500);
  }
  if (path.includes("/git/trees/")) return j({ tree: [{ type: "blob" }, { type: "blob" }, { type: "tree" }], truncated: false });
  if (path.endsWith("/commits")) return j([{ commit: { committer: { date: "2026-10-01T00:00:00Z" } } }]);
  if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(path)) return j({ default_branch: "main" });
  return j({ message: "unmocked" }, 599);
}

function userForToken(authHeader) {
  const token = String(authHeader || "").replace("Bearer ", "");
  return Object.values(PEOPLE).find((p) => `tok-${p.email}` === token) || null;
}

beforeEach(() => {
  state = seed();
  outbound = [];
  failLog = false;
  github = { dispatches: [], dispatchOk: true };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    outbound.push({ url: u, method: init.method || "GET" });
    if (u.startsWith(`${env.SUPABASE_URL}/auth/v1/user`)) {
      const person = userForToken(init.headers?.authorization);
      return person ? j({ id: person.id, email: person.email, user_metadata: { full_name: person.name } }) : j({ message: "bad token" }, 401);
    }
    if (u.startsWith(`${env.SUPABASE_URL}/rest/v1/`)) return handleRest(u, init);
    if (u.startsWith("https://api.github.com/")) return handleGithub(u, init);
    return j({ message: "unmocked" }, 599);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---- Helpers ----
function request(path, { method = "GET", as, body, secret } = {}) {
  const headers = { "content-type": "application/json" };
  if (as) headers.authorization = `Bearer tok-${PEOPLE[as].email}`;
  if (secret) headers["x-runner-secret"] = secret;
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(path, options = {}) {
  const res = await worker.fetch(request(path, options), env);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const START = { app_name: "Test application", data_rules_confirmed: true, repo: "acme/app" };
const visibleIds = (findings) => Object.keys(findings || {}).sort();

// ---- Signing in and access ----

test("anonymous requests are refused without any outbound call", async () => {
  const res = await worker.fetch(new Request("https://api.test/api/me"), env);
  assert.equal(res.status, 401);
  assert.equal(outbound.length, 0);
});

test("an invalid token is refused", async () => {
  const res = await worker.fetch(new Request("https://api.test/api/me", { headers: { authorization: "Bearer nope" } }), env);
  assert.equal(res.status, 401);
});

test("me lists only the workspaces the person was invited to, with their role in each", async () => {
  const eng = await call("/api/me", { as: "eng_a" });
  assert.equal(eng.status, 200);
  assert.equal(eng.body.is_operator, false);
  assert.deepEqual(eng.body.workspaces, [{ id: W_ACME, name: "Acme Health", role: "platform_engineer", is_admin: false }]);
});

test("a person with no invitation sees no workspaces and cannot open any", async () => {
  const me = await call("/api/me", { as: "stranger" });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.workspaces, []);
  const list = await call(`/api/analyses?workspace=${W_ACME}`, { as: "stranger" });
  assert.equal(list.status, 404);
});

test("an invitation becomes membership on first sign-in, and is used up", async () => {
  const me = await call("/api/me", { as: "newhire" });
  assert.deepEqual(me.body.workspaces, [{ id: W_ACME, name: "Acme Health", role: "auditor", is_admin: false }]);
  assert.equal(state.invitations.length, 0, "invitation removed");
  assert.ok(state.members.find((m) => m.user_id === PEOPLE.newhire.id), "membership created");
});

test("the operator sees the operator flag but no customer data", async () => {
  const me = await call("/api/me", { as: "operator" });
  assert.equal(me.body.is_operator, true);
  assert.deepEqual(me.body.workspaces, []);
  const list = await call(`/api/analyses?workspace=${W_ACME}`, { as: "operator" });
  assert.equal(list.status, 404);
});

// ---- Separation between customers ----

test("analyses are listed only for the workspace asked for, and only to its members", async () => {
  const mine = await call(`/api/analyses?workspace=${W_ACME}`, { as: "eng_a" });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.map((a) => a.id), [AN_ACME]);
  assert.equal(mine.body[0].is_mine, true);
  assert.equal(mine.body[0].owner_id, undefined, "owner id is not sent");

  const other = await call(`/api/analyses?workspace=${W_ACME}`, { as: "eng_b" });
  assert.equal(other.status, 404);
});

test("another customer's analysis answers Not found, the same as a missing one", async () => {
  const foreign = await call(`/api/analyses/${AN_BETA}`, { as: "eng_a" });
  const missing = await call(`/api/analyses/${uid(999)}`, { as: "eng_a" });
  assert.equal(foreign.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(foreign.body, missing.body, "no hint that the record exists");
});

test("a member of one workspace cannot comment on, act on, or delete another workspace's work", async () => {
  const comment = await call(`/api/analyses/${AN_BETA}/comments`, { as: "eng_a", method: "POST", body: { body: "hello" } });
  assert.equal(comment.status, 404);
  const action = await call(`/api/analyses/${AN_BETA}/actions`, { as: "eng_a", method: "POST", body: { title: "x" } });
  assert.equal(action.status, 404);
  const del = await call(`/api/analyses/${AN_BETA}`, { as: "admin_a", method: "DELETE" });
  assert.equal(del.status, 404, "an admin of Acme cannot delete Beta's analysis");
  assert.equal(state.analyses.length, 2);
});

test("workspace admins can see people in their own workspace only", async () => {
  const own = await call(`/api/workspaces/${W_ACME}/members`, { as: "admin_a" });
  assert.equal(own.status, 200);
  assert.ok(own.body.some((m) => m.email === PEOPLE.sec_a.email));

  const notAdmin = await call(`/api/workspaces/${W_ACME}/members`, { as: "eng_a" });
  assert.equal(notAdmin.status, 403);

  const otherCustomer = await call(`/api/workspaces/${W_ACME}/members`, { as: "eng_b" });
  assert.equal(otherCustomer.status, 404);
});

// ---- Roles: what each role may see and do ----

test("the platform engineer sees every finding and every flag", async () => {
  const res = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(res.status, 200);
  assert.deepEqual(visibleIds(res.body.findings.findings), Object.keys(REPORT.findings).sort());
  assert.deepEqual(res.body.findings.flags, ["sec1", "data1"]);
  assert.deepEqual(res.body.findings.counts, { total: 9, shown: 9 });
});

test("the security officer sees security and privacy findings only", async () => {
  const res = await call(`/api/analyses/${AN_ACME}`, { as: "sec_a" });
  assert.deepEqual(visibleIds(res.body.findings.findings), ["priv1", "sec1"]);
  assert.deepEqual(res.body.findings.flags, ["sec1"]);
  assert.deepEqual(res.body.findings.counts, { total: 9, shown: 2 });
});

test("the informatics lead sees data and Epic findings only", async () => {
  const res = await call(`/api/analyses/${AN_ACME}`, { as: "inf_a" });
  assert.deepEqual(visibleIds(res.body.findings.findings), ["data1", "epic1"]);
  assert.deepEqual(res.body.findings.flags, ["data1"]);
});

test("the CIO or CTO sees the overview categories, not security or data detail", async () => {
  const res = await call(`/api/analyses/${AN_ACME}`, { as: "cio_a" });
  assert.deepEqual(visibleIds(res.body.findings.findings), ["cont1", "del1", "inf1", "stack1", "ui1"]);
  assert.deepEqual(res.body.findings.flags, []);
});

test("the auditor sees the summary and no finding detail", async () => {
  const res = await call(`/api/analyses/${AN_ACME}`, { as: "aud_a" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.findings.findings, {});
  assert.deepEqual(res.body.findings.flags, []);
  assert.deepEqual(res.body.findings.limitations, REPORT.limitations);
  assert.equal(res.body.can_work_items, false);
});

test("hidden findings are not sent in the downloadable report either", async () => {
  const res = await call(`/api/analyses/${AN_ACME}`, { as: "sec_a" });
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes("Patient table has 40 columns"), "data finding must not reach the security officer");
});

test("only platform engineers start analyses", async () => {
  const body = { ...START, workspace_id: W_ACME };
  for (const as of ["sec_a", "inf_a", "cio_a", "aud_a"]) {
    const res = await call("/api/analyses", { as, method: "POST", body });
    assert.equal(res.status, 403, `${as} must not start an analysis`);
  }
  assert.equal(github.dispatches.length, 0);
});

test("a platform engineer starts an analysis in their workspace, and the runner is dispatched", async () => {
  const res = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME } });
  assert.equal(res.status, 202);
  const row = state.analyses.find((a) => a.id === res.body.id);
  assert.equal(row.workspace_id, W_ACME);
  assert.equal(row.owner_id, PEOPLE.eng_a.id);
  assert.equal(github.dispatches.length, 1);
});

test("starting an analysis in a workspace the engineer is not in is refused", async () => {
  const res = await call("/api/analyses", { as: "eng_b", method: "POST", body: { ...START, workspace_id: W_ACME } });
  assert.equal(res.status, 404);
  assert.equal(state.analyses.length, 2);
});

test("a start request needs a workspace, a name and the data-rules confirmation", async () => {
  const noWorkspace = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START } });
  assert.equal(noWorkspace.status, 400);
  const noRules = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, data_rules_confirmed: false } });
  assert.equal(noRules.status, 400);
});

test("a repository Cutover cannot read is refused with the install instruction", async () => {
  const res = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, repo: "private/missing" } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /install the Cutover reader/);
  assert.equal(github.dispatches.length, 0);
});

test("repo check: a platform engineer sees the file count, others are refused", async () => {
  const ok = await call(`/api/repo-check?workspace=${W_ACME}&repo=acme/app`, { as: "eng_a" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.files, 2);
  const refused = await call(`/api/repo-check?workspace=${W_ACME}&repo=acme/app`, { as: "sec_a" });
  assert.equal(refused.status, 403);
});

test("repo check explains a repository that needs the install", async () => {
  const res = await call(`/api/repo-check?workspace=${W_ACME}&repo=private/missing`, { as: "eng_a" });
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, "not_readable");
  assert.match(res.body.install_url, /cutover-reader-portal\/installations\/new/);
});

// ---- Discussion and action items ----

test("every member can comment, the auditor included", async () => {
  const res = await call(`/api/analyses/${AN_ACME}/comments`, { as: "aud_a", method: "POST", body: { body: "Please add the retention date." } });
  assert.equal(res.status, 201);
});

test("the auditor cannot add or change action items", async () => {
  const add = await call(`/api/analyses/${AN_ACME}/actions`, { as: "aud_a", method: "POST", body: { title: "Review" } });
  assert.equal(add.status, 403);
  const change = await call(`/api/actions/${ACTION_ACME}`, { as: "aud_a", method: "PATCH", body: { status: "done" } });
  assert.equal(change.status, 403);
  assert.equal(state.action_items[0].status, "open");
});

test("other members can add and close action items", async () => {
  const add = await call(`/api/analyses/${AN_ACME}/actions`, { as: "sec_a", method: "POST", body: { title: "Check logs" } });
  assert.equal(add.status, 201);
  const close = await call(`/api/actions/${ACTION_ACME}`, { as: "inf_a", method: "PATCH", body: { status: "done" } });
  assert.equal(close.status, 200);
  assert.equal(state.action_items.find((a) => a.id === ACTION_ACME).done_by_email, PEOPLE.inf_a.email);
});

// ---- Contingency planning ----

test("every member can read the contingency plans with the analysis, but only platform engineers see can_plan", async () => {
  const auditor = await call(`/api/analyses/${AN_ACME}`, { as: "aud_a" });
  assert.equal(auditor.status, 200);
  assert.equal(auditor.body.contingencies.length, 1);
  assert.equal(auditor.body.can_plan, false);
  const engineer = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(engineer.body.can_plan, true);
});

test("a contingency is kept inside its own workspace", async () => {
  const res = await call(`/api/analyses/${AN_ACME}/contingencies`, { as: "eng_b", method: "POST", body: { risk: "x", contingency: "y" } });
  assert.equal(res.status, 404);
});

test("only platform engineers can add, change or remove contingencies", async () => {
  const add = await call(`/api/analyses/${AN_ACME}/contingencies`, { as: "inf_a", method: "POST", body: { risk: "r", contingency: "c" } });
  assert.equal(add.status, 403);
  const change = await call(`/api/contingencies/${CONTINGENCY_ACME}`, { as: "sec_a", method: "PATCH", body: { risk: "changed" } });
  assert.equal(change.status, 403);
  const remove = await call(`/api/contingencies/${CONTINGENCY_ACME}`, { as: "aud_a", method: "DELETE" });
  assert.equal(remove.status, 403);
  assert.equal(state.contingencies.length, 1);
  assert.equal(state.contingencies[0].risk, "Patient messages stop during cutover");
});

test("a platform engineer adds a contingency, which starts as a proposal and records who saved it", async () => {
  const res = await call(`/api/analyses/${AN_ACME}/contingencies`, {
    as: "eng_a", method: "POST",
    body: { risk: "Check-in fails at peak", contingency: "Switch to paper check-in for one shift.", owner_email: "informatics@acme.test" },
  });
  assert.equal(res.status, 201);
  const added = state.contingencies.find((c) => c.risk === "Check-in fails at peak");
  assert.equal(added.status, "proposed");
  assert.equal(added.created_by_email, PEOPLE.eng_a.email);
  assert.equal(added.owner_email, "informatics@acme.test");
});

test("a new contingency needs a risk and a fallback", async () => {
  const missing = await call(`/api/analyses/${AN_ACME}/contingencies`, { as: "eng_a", method: "POST", body: { contingency: "c" } });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /risk is required/);
  const blank = await call(`/api/analyses/${AN_ACME}/contingencies`, { as: "eng_a", method: "POST", body: { risk: "  ", contingency: "c" } });
  assert.equal(blank.status, 400);
  const badStatus = await call(`/api/analyses/${AN_ACME}/contingencies`, { as: "eng_a", method: "POST", body: { risk: "r", contingency: "c", status: "done" } });
  assert.equal(badStatus.status, 400);
});

test("editing a proposal marks it edited, but an explicit status is kept", async () => {
  const edit = await call(`/api/contingencies/${CONTINGENCY_ACME}`, { as: "eng_a", method: "PATCH", body: { contingency: "Keep the old interface read-only for one week." } });
  assert.equal(edit.status, 200);
  const row = state.contingencies.find((c) => c.id === CONTINGENCY_ACME);
  assert.equal(row.status, "edited");
  assert.equal(row.updated_by_email, PEOPLE.eng_a.email);
  const accept = await call(`/api/contingencies/${CONTINGENCY_ACME}`, { as: "eng_a", method: "PATCH", body: { status: "accepted" } });
  assert.equal(accept.status, 200);
  assert.equal(state.contingencies.find((c) => c.id === CONTINGENCY_ACME).status, "accepted");
});

test("an empty update is refused, and a removed contingency is gone", async () => {
  const empty = await call(`/api/contingencies/${CONTINGENCY_ACME}`, { as: "eng_a", method: "PATCH", body: {} });
  assert.equal(empty.status, 400);
  const remove = await call(`/api/contingencies/${CONTINGENCY_ACME}`, { as: "eng_a", method: "DELETE" });
  assert.equal(remove.status, 200);
  assert.equal(state.contingencies.length, 0);
  const again = await call(`/api/contingencies/${CONTINGENCY_ACME}`, { as: "eng_a", method: "DELETE" });
  assert.equal(again.status, 404);
});

test("a comment can be deleted by its author or a workspace admin, not by others", async () => {
  const other = await call(`/api/comments/${COMMENT_ACME}`, { as: "sec_a", method: "DELETE" });
  assert.equal(other.status, 403);
  const admin = await call(`/api/comments/${COMMENT_ACME}`, { as: "admin_a", method: "DELETE" });
  assert.equal(admin.status, 200);
});

// ---- Deleting and retention ----

test("an analysis is deleted only after its deletion record is saved", async () => {
  const res = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a", method: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal(state.deletion_log.length, 1);
  assert.equal(state.deletion_log[0].reason, "requested");
  assert.equal(state.analyses.some((a) => a.id === AN_ACME), false);
});

test("if the deletion record cannot be saved, the analysis is kept", async () => {
  failLog = true;
  const res = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a", method: "DELETE" });
  assert.equal(res.status, 502);
  assert.equal(state.analyses.some((a) => a.id === AN_ACME), true);
});

test("an auditor cannot delete an analysis, and an admin can delete one from their workspace", async () => {
  const aud = await call(`/api/analyses/${AN_ACME}`, { as: "aud_a", method: "DELETE" });
  assert.equal(aud.status, 403);
  const admin = await call(`/api/analyses/${AN_ACME}`, { as: "admin_a", method: "DELETE" });
  assert.equal(admin.status, 200);
});

test("retention writes a deletion record before it removes expired analyses", async () => {
  state.analyses[0].expires_at = LONG_AGO;
  let pending;
  await worker.scheduled({}, env, { waitUntil: (p) => { pending = p; } });
  await pending;
  assert.equal(state.deletion_log.length, 1);
  assert.equal(state.deletion_log[0].reason, "expired");
  assert.equal(state.analyses.some((a) => a.id === AN_ACME), false);
  assert.equal(state.analyses.some((a) => a.id === AN_BETA), true, "unexpired analyses stay");
});

test("retention keeps expired analyses when its records cannot be saved", async () => {
  state.analyses[0].expires_at = LONG_AGO;
  failLog = true;
  let pending;
  await worker.scheduled({}, env, { waitUntil: (p) => { pending = p; } });
  await assert.rejects(pending);
  assert.equal(state.analyses.some((a) => a.id === AN_ACME), true);
});

// ---- Managing people ----

test("an admin invites a person into their workspace with a role and admin flag", async () => {
  const res = await call(`/api/workspaces/${W_ACME}/invitations`, {
    as: "admin_a", method: "POST", body: { email: "Lead@Acme.test", role: "informatics_lead", is_admin: false },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.invited, "lead@acme.test");
  assert.ok(state.invitations.find((i) => i.email === "lead@acme.test" && i.workspace_id === W_ACME));
});

test("an invitation with an unknown role is refused", async () => {
  const res = await call(`/api/workspaces/${W_ACME}/invitations`, {
    as: "admin_a", method: "POST", body: { email: "x@acme.test", role: "workspace_admin" },
  });
  assert.equal(res.status, 400);
});

test("a non-admin cannot invite, and an admin of one workspace cannot invite into another", async () => {
  const notAdmin = await call(`/api/workspaces/${W_ACME}/invitations`, {
    as: "eng_a", method: "POST", body: { email: "x@acme.test", role: "auditor" },
  });
  assert.equal(notAdmin.status, 403);
  const otherWorkspace = await call(`/api/workspaces/${W_ACME}/invitations`, {
    as: "eng_b", method: "POST", body: { email: "x@acme.test", role: "auditor" },
  });
  assert.equal(otherWorkspace.status, 404);
});

test("an admin can remove a member, but not themselves", async () => {
  const self = await call(`/api/workspaces/${W_ACME}/members/${PEOPLE.admin_a.id}`, { as: "admin_a", method: "DELETE" });
  assert.equal(self.status, 400);
  const other = await call(`/api/workspaces/${W_ACME}/members/${PEOPLE.sec_a.id}`, { as: "admin_a", method: "DELETE" });
  assert.equal(other.status, 200);
  assert.equal(state.members.some((m) => m.user_id === PEOPLE.sec_a.id && m.workspace_id === W_ACME), false);
});

test("only Cutover operators can create a customer workspace, and it starts with its first admin", async () => {
  const body = { name: "Riverside Health", admin_email: "it@riverside.test" };
  const refused = await call("/api/workspaces", { as: "admin_a", method: "POST", body });
  assert.equal(refused.status, 403);

  const created = await call("/api/workspaces", { as: "operator", method: "POST", body });
  assert.equal(created.status, 201);
  const invite = state.invitations.find((i) => i.workspace_id === created.body.id);
  assert.equal(invite.email, "it@riverside.test");
  assert.equal(invite.is_admin, true);
  assert.equal(invite.role, "platform_engineer");
});

test("a workspace is not left behind when its first admin cannot be invited", async () => {
  const mocked = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/rest/v1/invitations") && init.method === "POST") return j({ message: "down" }, 500);
    return mocked(url, init);
  };
  const res = await call("/api/workspaces", { as: "operator", method: "POST", body: { name: "Lost", admin_email: "it@lost.test" } });
  assert.equal(res.status, 502);
  assert.equal(state.workspaces.some((w) => w.name === "Lost"), false);
});

// ---- File-level chunks from the runner ----

function runningAnalysis(extra = {}) {
  state.analyses.push({
    id: AN_RUNNING, workspace_id: W_ACME, owner_id: PEOPLE.eng_a.id, repo: "acme/app", ref: null, app_name: "Acme app",
    status: "running", commit_sha: null, findings: null, error: null, created_at: NOW, finished_at: null, expires_at: FAR_FUTURE,
    file_bytes: 0, ...extra,
  });
}

const sampleFile = (path) => ({
  path, category: "application", purpose: "Handles requests for one resource and passes them to a service.",
  suggestions: [{ text: "Add a test for the empty-input branch.", severity: "low" }], sample_only: true,
});

test("a runner chunk needs the shared secret", async () => {
  runningAnalysis();
  const res = await call(`/api/runner/${AN_RUNNING}/files`, { method: "POST", body: { files: [sampleFile("src/A.java")] }, secret: "wrong" });
  assert.equal(res.status, 401);
});

test("a valid chunk is saved, and the analysis is marked running with its running total", async () => {
  runningAnalysis();
  const res = await call(`/api/runner/${AN_RUNNING}/files`, { method: "POST", body: { files: [sampleFile("src/A.java"), sampleFile("src/B.java")] }, secret: env.RUNNER_SECRET });
  assert.equal(res.status, 201);
  assert.equal(res.body.saved, 2);
  assert.equal(state.file_findings.filter((f) => f.analysis_id === AN_RUNNING).length, 2);
  const row = state.analyses.find((a) => a.id === AN_RUNNING);
  assert.equal(row.status, "running");
  assert.ok(row.file_bytes > 0);
});

test("a chunk with a bad record, a repeated path or too many files is refused and nothing is saved", async () => {
  runningAnalysis();
  const longPath = await call(`/api/runner/${AN_RUNNING}/files`, { method: "POST", body: { files: [sampleFile("x".repeat(600))] }, secret: env.RUNNER_SECRET });
  assert.equal(longPath.status, 400);
  const twice = await call(`/api/runner/${AN_RUNNING}/files`, { method: "POST", body: { files: [sampleFile("src/A.java"), sampleFile("src/A.java")] }, secret: env.RUNNER_SECRET });
  assert.equal(twice.status, 400);
  const many = await call(`/api/runner/${AN_RUNNING}/files`, { method: "POST", body: { files: Array.from({ length: 201 }, (_, i) => sampleFile(`f${i}.java`)) }, secret: env.RUNNER_SECRET });
  assert.equal(many.status, 400);
  assert.equal(state.file_findings.filter((f) => f.analysis_id === AN_RUNNING).length, 0);
});

test("a finished analysis takes no more file chunks", async () => {
  const res = await call(`/api/runner/${AN_ACME}/files`, { method: "POST", body: { files: [sampleFile("src/A.java")] }, secret: env.RUNNER_SECRET });
  assert.equal(res.status, 409);
});

test("going over the free-tier cap fails the analysis and removes its file rows", async () => {
  runningAnalysis({ file_bytes: 25 * 1024 * 1024 - 10 });
  state.file_findings.push({ id: uid(900), analysis_id: AN_RUNNING, path: "old.java", category: "application", purpose: null, suggestions: [], sample_only: true, created_at: NOW });
  const res = await call(`/api/runner/${AN_RUNNING}/files`, { method: "POST", body: { files: [sampleFile("src/A.java")] }, secret: env.RUNNER_SECRET });
  assert.equal(res.status, 413);
  const row = state.analyses.find((a) => a.id === AN_RUNNING);
  assert.equal(row.status, "failed");
  assert.match(row.error, /25 MB limit/);
  assert.equal(state.file_findings.filter((f) => f.analysis_id === AN_RUNNING).length, 0);
});

// ---- Reviewing file-level results (platform engineers) ----

test("only platform engineers see the file-level results", async () => {
  const engineer = await call(`/api/analyses/${AN_ACME}/files`, { as: "eng_a" });
  assert.equal(engineer.status, 200);
  assert.equal(engineer.body.files.length, 1);
  assert.equal(engineer.body.files[0].review_status, "draft");
  const auditor = await call(`/api/analyses/${AN_ACME}/files`, { as: "aud_a" });
  assert.equal(auditor.status, 403);
  const other = await call(`/api/analyses/${AN_ACME}/files`, { as: "eng_b" });
  assert.equal(other.status, 404);
});

test("a platform engineer approves a file, and the approval records who and when", async () => {
  const res = await call(`/api/file-findings/${FILE_ACME}`, { as: "eng_a", method: "PATCH", body: { review_status: "approved" } });
  assert.equal(res.status, 200);
  const row = state.file_findings.find((f) => f.id === FILE_ACME);
  assert.equal(row.review_status, "approved");
  assert.equal(row.reviewed_by_email, PEOPLE.eng_a.email);
  assert.ok(row.reviewed_at);
});

test("an edited file must say what changed, and is marked edited", async () => {
  const none = await call(`/api/file-findings/${FILE_ACME}`, { as: "eng_a", method: "PATCH", body: { review_status: "edited" } });
  assert.equal(none.status, 400);
  const edit = await call(`/api/file-findings/${FILE_ACME}`, { as: "eng_a", method: "PATCH", body: { review_status: "edited", purpose: "Checks the order before it is sent." } });
  assert.equal(edit.status, 200);
  const row = state.file_findings.find((f) => f.id === FILE_ACME);
  assert.equal(row.review_status, "edited");
  assert.equal(row.purpose, "Checks the order before it is sent.");
});

test("an edit with a bad status or bad suggestions is refused", async () => {
  const badStatus = await call(`/api/file-findings/${FILE_ACME}`, { as: "eng_a", method: "PATCH", body: { review_status: "final", purpose: "x" } });
  assert.equal(badStatus.status, 400);
  const badSuggestions = await call(`/api/file-findings/${FILE_ACME}`, { as: "eng_a", method: "PATCH", body: { review_status: "edited", suggestions: "none" } });
  assert.equal(badSuggestions.status, 400);
});

test("auditors and security officers cannot review files", async () => {
  const review = await call(`/api/file-findings/${FILE_ACME}`, { as: "aud_a", method: "PATCH", body: { review_status: "approved" } });
  assert.equal(review.status, 403);
  const approveAll = await call(`/api/analyses/${AN_ACME}/files/approve-all`, { as: "sec_a", method: "POST" });
  assert.equal(approveAll.status, 403);
});

test("approve-all approves the files still in draft", async () => {
  state.file_findings.push({ id: uid(602), analysis_id: AN_ACME, path: "src/B.java", category: "source", purpose: null, suggestions: [], sample_only: true, review_status: "draft", reviewed_by_email: null, reviewed_at: null, created_at: NOW });
  const res = await call(`/api/analyses/${AN_ACME}/files/approve-all`, { as: "eng_a", method: "POST" });
  assert.equal(res.status, 200);
  assert.ok(state.file_findings.every((f) => f.review_status === "approved"));
});

// ---- Runner callback ----

test("the runner callback needs the shared secret", async () => {
  const bad = await call(`/api/runner/${AN_ACME}/result`, { method: "POST", body: { status: "failed", error: "x" }, secret: "wrong" });
  assert.equal(bad.status, 401);
  const good = await call(`/api/runner/${AN_ACME}/result`, { method: "POST", body: { status: "failed", error: "x" }, secret: env.RUNNER_SECRET });
  assert.equal(good.status, 200);
});

// ---- Database size (operators) ----

test("operators see the database size against the free-tier limit", async () => {
  const res = await call("/api/admin/database", { as: "operator" });
  assert.equal(res.status, 200);
  assert.equal(res.body.bytes, DATABASE_BYTES);
  assert.equal(res.body.limit_bytes, 500 * 1024 * 1024);
  assert.equal(res.body.percent, 25);
});

test("the database size is only for operators", async () => {
  const res = await call("/api/admin/database", { as: "admin_a" });
  assert.equal(res.status, 403);
});

// ---- Names, and managing workspaces (operators) ----

test("a person's Google name is saved on their memberships at sign-in", async () => {
  const res = await call("/api/me", { as: "admin_a" });
  assert.equal(res.status, 200);
  const rows = state.members.filter((m) => m.user_id === PEOPLE.admin_a.id);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((m) => m.name === PEOPLE.admin_a.name));
});

test("the people list shows each member's name with their email", async () => {
  await call("/api/me", { as: "eng_a" });
  const res = await call(`/api/workspaces/${W_ACME}/members`, { as: "admin_a" });
  assert.equal(res.status, 200);
  const eng = res.body.find((m) => m.email === PEOPLE.eng_a.email);
  assert.equal(eng.name, PEOPLE.eng_a.name);
});

test("only operators see the workspace overview, and people only where the operator is a member", async () => {
  state.members.push({ workspace_id: W_BETA, user_id: PEOPLE.operator.id, email: PEOPLE.operator.email, name: PEOPLE.operator.name, role: "platform_engineer", is_admin: true, created_at: NOW });
  const denied = await call("/api/admin/workspaces", { as: "admin_a" });
  assert.equal(denied.status, 403);

  const res = await call("/api/admin/workspaces", { as: "operator" });
  assert.equal(res.status, 200);
  const acme = res.body.find((w) => w.id === W_ACME);
  const beta = res.body.find((w) => w.id === W_BETA);
  assert.ok(acme.people_count > 0, "counts are shown for every workspace");
  assert.equal(acme.analyses_count, state.analyses.filter((a) => a.workspace_id === W_ACME).length);
  assert.equal(acme.you_are_member, false);
  assert.equal(acme.members, undefined, "no one's details are shown for a workspace the operator is not in");
  assert.equal(beta.you_are_member, true);
  assert.ok(beta.members.some((m) => m.email === PEOPLE.operator.email));
});

test("only operators rename a workspace", async () => {
  const denied = await call(`/api/workspaces/${W_ACME}`, { as: "admin_a", method: "PATCH", body: { name: "Renamed" } });
  assert.equal(denied.status, 403);
  const res = await call(`/api/workspaces/${W_ACME}`, { as: "operator", method: "PATCH", body: { name: "Acme Clinic" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, "Acme Clinic");
  assert.equal(state.workspaces.find((w) => w.id === W_ACME).name, "Acme Clinic");
});

test("deleting a workspace needs its exact name, and logs its analyses before removing it", async () => {
  const wrong = await call(`/api/workspaces/${W_ACME}`, { as: "operator", method: "DELETE", body: { confirm_name: "acme" } });
  assert.equal(wrong.status, 400);
  assert.ok(state.workspaces.some((w) => w.id === W_ACME), "nothing deleted on a wrong name");

  const denied = await call(`/api/workspaces/${W_ACME}`, { as: "admin_a", method: "DELETE", body: { confirm_name: "Acme Health" } });
  assert.equal(denied.status, 403);

  const res = await call(`/api/workspaces/${W_ACME}`, { as: "operator", method: "DELETE", body: { confirm_name: "Acme Health" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, true);
  assert.ok(!state.workspaces.some((w) => w.id === W_ACME));
  const logged = state.deletion_log.filter((d) => d.reason === "requested").map((d) => d.analysis_id);
  assert.ok(logged.includes(AN_ACME), "the analysis is recorded in the deletion log");
});

test("if the deletions cannot be logged, the workspace is kept", async () => {
  failLog = true;
  const res = await call(`/api/workspaces/${W_ACME}`, { as: "operator", method: "DELETE", body: { confirm_name: "Acme Health" } });
  assert.equal(res.status, 502);
  assert.ok(state.workspaces.some((w) => w.id === W_ACME));
});


// ---- Privacy sign-off ----

const SIGN = (name = "Ada Admin", overrides = {}) => ({
  notice_version: "2026-10-18.1",
  statements: ["code_only", "no_personal_data", "provider_terms", "withdraw"],
  full_name: name,
  ...overrides,
});

test("a member can read the sign-off status: not signed off yet, with the statements to read", async () => {
  const res = await call(`/api/workspaces/${W_ACME}/privacy`, { as: "eng_a" });
  assert.equal(res.status, 200);
  assert.equal(res.body.signed_off, false);
  assert.equal(res.body.current, null);
  assert.equal(res.body.can_change, false);
  assert.equal(res.body.statements.length, 4);
  assert.equal(res.body.notice_version, "2026-10-18.1");
});

test("only a workspace admin is offered to sign off", async () => {
  const res = await call(`/api/workspaces/${W_ACME}/privacy`, { as: "admin_a" });
  assert.equal(res.body.can_change, true);
});

test("someone outside the workspace cannot read its sign-off status", async () => {
  const stranger = await call(`/api/workspaces/${W_ACME}/privacy`, { as: "stranger" });
  const otherCustomer = await call(`/api/workspaces/${W_ACME}/privacy`, { as: "eng_b" });
  assert.equal(stranger.status, 404);
  assert.equal(otherCustomer.status, 404);
  assert.deepEqual(stranger.body, { error: "Not found." });
});

test("an admin signs off: the record holds who signed, the name typed, and the text the server holds", async () => {
  const res = await call(`/api/workspaces/${W_ACME}/privacy/signoff`, {
    method: "POST", as: "admin_a", body: SIGN("  Ada Admin  ", { notice_text: "forged text" }),
  });
  assert.equal(res.status, 201);
  assert.equal(state.privacy_signoffs.length, 1);
  const row = state.privacy_signoffs[0];
  assert.equal(row.workspace_id, W_ACME);
  assert.equal(row.email, PEOPLE.admin_a.email);
  assert.equal(row.full_name, "Ada Admin");
  assert.equal(row.action, "signed_off");
  assert.equal(row.notice_version, "2026-10-18.1");
  assert.match(row.notice_text, /Cutover can send code/);
  assert.ok(!row.notice_text.includes("forged"), "the browser cannot change the recorded text");
  assert.deepEqual(row.statements, ["code_only", "no_personal_data", "provider_terms", "withdraw"]);

  const status = await call(`/api/workspaces/${W_ACME}/privacy`, { as: "eng_a" });
  assert.equal(status.body.signed_off, true);
  assert.equal(status.body.current.full_name, "Ada Admin");
  assert.equal(status.body.current.email, PEOPLE.admin_a.email);
});

test("people who are not admins cannot sign off, and nothing is recorded", async () => {
  const res = await call(`/api/workspaces/${W_ACME}/privacy/signoff`, { method: "POST", as: "eng_a", body: SIGN("Eli Engineer") });
  assert.equal(res.status, 403);
  assert.equal(state.privacy_signoffs.length, 0);
});

test("a sign-off needs every statement ticked, the current notice version, and a real name", async () => {
  const path = `/api/workspaces/${W_ACME}/privacy/signoff`;
  const partial = await call(path, { method: "POST", as: "admin_a", body: SIGN("Ada Admin", { statements: ["code_only"] }) });
  assert.equal(partial.status, 400);
  const outdated = await call(path, { method: "POST", as: "admin_a", body: SIGN("Ada Admin", { notice_version: "2026-01-01.0" }) });
  assert.equal(outdated.status, 409);
  const noName = await call(path, { method: "POST", as: "admin_a", body: SIGN("A") });
  assert.equal(noName.status, 400);
  assert.equal(state.privacy_signoffs.length, 0, "nothing recorded");
});

test("a workspace is signed off once; a second sign-off is refused", async () => {
  const path = `/api/workspaces/${W_ACME}/privacy/signoff`;
  await call(path, { method: "POST", as: "admin_a", body: SIGN() });
  const again = await call(path, { method: "POST", as: "admin_a", body: SIGN() });
  assert.equal(again.status, 409);
  assert.equal(state.privacy_signoffs.length, 1);
});

test("withdrawing ends the sign-off, and both events stay in the history", async () => {
  const path = `/api/workspaces/${W_ACME}/privacy`;
  await call(`${path}/signoff`, { method: "POST", as: "admin_a", body: SIGN() });
  const notAdmin = await call(`${path}/withdraw`, { method: "POST", as: "eng_a", body: { full_name: "Eli Engineer" } });
  assert.equal(notAdmin.status, 403);
  const withdrawn = await call(`${path}/withdraw`, { method: "POST", as: "admin_a", body: { full_name: "Ada Admin" } });
  assert.equal(withdrawn.status, 201);
  const status = await call(path, { as: "eng_a" });
  assert.equal(status.body.signed_off, false);
  assert.deepEqual(status.body.history.map((h) => h.action), ["withdrawn", "signed_off"]);
  const again = await call(`${path}/withdraw`, { method: "POST", as: "admin_a", body: { full_name: "Ada Admin" } });
  assert.equal(again.status, 409, "nothing left to withdraw");
});

test("sign-off rows are only read or inserted, never changed or deleted", async () => {
  const path = `/api/workspaces/${W_ACME}/privacy`;
  await call(`${path}/signoff`, { method: "POST", as: "admin_a", body: SIGN() });
  await call(`${path}/withdraw`, { method: "POST", as: "admin_a", body: { full_name: "Ada Admin" } });
  await call(path, { as: "admin_a" });
  const touched = outbound.filter((c) => c.url.includes("/rest/v1/privacy_signoffs"));
  assert.ok(touched.length > 0);
  assert.ok(touched.every((c) => c.method === "GET" || c.method === "POST"), "no PATCH or DELETE on sign-off rows");
});
