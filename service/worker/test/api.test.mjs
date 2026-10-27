// Tests for the Worker's behavior: who can see and change what, and what is recorded.
//   node --test service/worker/test/api.test.mjs
// Supabase is replaced by a small in-memory stand-in (it understands the filters the Worker uses),
// and GitHub is mocked. No real account, database or secret is needed.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import worker from "../src/index.mjs";
import { validateDbMetadata } from "../src/db-metadata.mjs";

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
  CUTOVER_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

// Keys the fake provider accepts, refuses, or rate-limits. The test keys are long enough to pass the length check.
const GOOD_KEY = "sk-ant-test-good-key-abcd1234";
const BAD_KEY = "sk-ant-test-bad-key-zzzz0000";
const BUSY_KEY = "sk-ant-test-busy-key-qqqq9999";
const GOOD_GOOGLE_KEY = "AIza-test-good-key-google-5678";
const BAD_GOOGLE_KEY = "AIza-test-bad-key-google-0000";
const GOOD_OPENAI_KEY = "sk-test-openai-compatible-key-7777";

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
    notifications: [],
    terraform_versions: [],
    privacy_signoffs: [],
    model_keys: [],
    analysis_model_tokens: [],
    analysis_screens: [],
    analysis_conversions: [],
    assessment_log: [],
    analysis_target_approvals: [],
    analysis_db_metadata: [],
  };
}

// ---- A small stand-in for Supabase's REST API ----
let state;
let outbound;
let github;
let failLog;
let failActivityLog;
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
  if (value === "is.null") return row[key] === null || row[key] === undefined;
  throw new Error(`Unsupported filter ${value}`);
}

// Each new sign-off row gets a later time than the one before, so "newest first" is unambiguous.
let signoffClock = Date.parse(NOW);

function defaultsFor(table) {
  const base = { id: randomUUID(), created_at: NOW };
  if (table === "privacy_signoffs") return { ...base, created_at: new Date(signoffClock += 1000).toISOString() };
  if (table === "analyses") return { ...base, created_at: new Date().toISOString(), status: "queued", findings: null, error: null, commit_sha: null, finished_at: null, expires_at: FAR_FUTURE };
  if (table === "action_items") return { ...base, status: "open", done_at: null, done_by_email: null };
  if (table === "analysis_model_tokens") return { ...base, used_at: null };
  if (table === "analysis_target_approvals") return { ...base, approved_at: NOW };
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
    if (table === "assessment_log" && failActivityLog) return j({ message: "forced failure" }, 500);
    if (table === "analysis_model_tokens" && github.failTokens) return j({ message: "forced failure" }, 500);
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

// The private zip bucket: stores what is posted, returns it to the runner, and deletes it.
const storedZips = new Map();
function handleStorage(url, init) {
  const name = decodeURIComponent(new URL(url).pathname.split("/analysis-sources/")[1] || "");
  const method = init.method || "GET";
  if (method === "POST") {
    if (storedZips.has(name)) return j({ message: "exists" }, 409);
    storedZips.set(name, Buffer.from(init.body));
    return j({ Key: `analysis-sources/${name}` });
  }
  if (method === "DELETE") return storedZips.delete(name) ? j({ message: "deleted" }) : j({ message: "not found" }, 404);
  const bytes = storedZips.get(name);
  return bytes ? new Response(bytes, { status: 200 }) : j({ message: "not found" }, 404);
}

function handleGithub(url, init) {
  const path = url.split("?")[0];
  if (path.endsWith("/installation")) {
    if (path.includes("/repos/private/missing/")) return j({ message: "Not Found" }, 404);
    return j({ id: 99 });
  }
  if (path.endsWith("/app/installations/99/access_tokens")) return j({ token: "ghs_test" }, 201);
  if (path.endsWith("/actions/workflows/analyze.yml/dispatches") || path.endsWith("/actions/workflows/convert.yml/dispatches")) {
    github.dispatches.push(JSON.parse(init.body));
    return github.dispatchOk ? new Response(null, { status: 204 }) : j({ message: "failed" }, 500);
  }
  if (path.includes("/git/trees/")) return j({ tree: [{ type: "blob" }, { type: "blob" }, { type: "tree" }], truncated: false });
  if (path.endsWith("/commits")) return j([{ sha: github.head || "abc123", commit: { committer: { date: "2026-10-01T00:00:00Z" } } }]);
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
  failActivityLog = false;
  github = { dispatches: [], dispatchOk: true };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    outbound.push({ url: u, method: init.method || "GET" });
    if (u.startsWith(`${env.SUPABASE_URL}/auth/v1/user`)) {
      const person = userForToken(init.headers?.authorization);
      return person ? j({ id: person.id, email: person.email, user_metadata: { full_name: person.name } }) : j({ message: "bad token" }, 401);
    }
    if (u.startsWith(`${env.SUPABASE_URL}/rest/v1/`)) return handleRest(u, init);
    if (u.startsWith(`${env.SUPABASE_URL}/storage/v1/object/analysis-sources/`)) return handleStorage(u, init);
    if (u.startsWith("https://api.github.com/")) return handleGithub(u, init);
    if (u.startsWith("https://generativelanguage.googleapis.com/v1beta/models/")) {
      const key = init.headers?.["x-goog-api-key"];
      if (key === GOOD_GOOGLE_KEY) return j({ candidates: [{ content: { parts: [{ text: "OK" }] } }] });
      return j({ error: { code: 400, message: "API key not valid." } }, 400);
    }
    // Any provider that speaks the chat-completions shape: one check for the key, and one for the model name.
    if (u.endsWith("/chat/completions")) {
      github.chatCalls = (github.chatCalls || 0) + 1;
      if (init.headers?.authorization !== `Bearer ${GOOD_OPENAI_KEY}`) return j({ error: { message: "bad key" } }, 401);
      const requested = JSON.parse(init.body).model;
      if (requested === "no-such-model") return j({ error: { message: "model not found" } }, 404);
      return j({ choices: [{ message: { content: "OK" } }] });
    }
    if (u === "https://api.anthropic.com/v1/messages") {
      const key = init.headers?.["x-api-key"];
      github.anthropicCalls = (github.anthropicCalls || 0) + 1;
      if (key === GOOD_KEY) return j({ type: "message", content: [{ type: "text", text: "OK" }] });
      if (key === BUSY_KEY) return j({ type: "error" }, 429);
      return j({ type: "error", error: { message: "invalid x-api-key" } }, 401);
    }
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

// ---- Choosing the modernized template ----

test("only a platform engineer can choose the modernized template, from the three there are", async () => {
  state.analyses.find((a) => a.id === AN_ACME).scope = "modernize";
  const auditor = await call(`/api/analyses/${AN_ACME}/template`, { as: "aud_a", method: "PUT", body: { template: "web-modern" } });
  assert.equal(auditor.status, 403);
  const unknown = await call(`/api/analyses/${AN_ACME}/template`, { as: "eng_a", method: "PUT", body: { template: "anything" } });
  assert.equal(unknown.status, 400);
});

test("the approach can only be chosen once Modernize is the next stage", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.scope = "deeper";
  const early = await call(`/api/analyses/${AN_ACME}/template`, { as: "eng_a", method: "PUT", body: { template: "web-modern" } });
  assert.equal(early.status, 409);
  assert.match(early.body.error, /Choose Modernize/);
  analysis.scope = "modernize";
});

test("a platform engineer's choice is saved with who chose it and when, and a later choice replaces it", async () => {
  state.analyses.find((a) => a.id === AN_ACME).scope = "modernize";
  const first = await call(`/api/analyses/${AN_ACME}/template`, { as: "eng_a", method: "PUT", body: { template: "web-modern" } });
  assert.equal(first.status, 200);
  assert.equal(first.body.template, "web-modern");
  const second = await call(`/api/analyses/${AN_ACME}/template`, { as: "eng_a", method: "PUT", body: { template: "lift-contain" } });
  assert.equal(second.status, 200);
  const read = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(read.body.modern_template, "lift-contain");
  assert.equal(read.body.modern_template_set_by_email, PEOPLE.eng_a.email);
  assert.ok(read.body.modern_template_set_at);
});

// ---- The path through the modernize stages ----

test("the stages unlock one after another, and a locked stage says what to clear first", async () => {
  const before = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  const stages = before.body.stages;
  assert.deepEqual(stages.map((s) => s.id), ["deeper", "approach", "plan", "starter", "convert", "pr"]);
  const plan = stages.find((s) => s.id === "plan");
  const approach = stages.find((s) => s.id === "approach");
  if (before.body.deeper_done !== true) {
    assert.equal(stages[0].state, "available");
    assert.equal(approach.state, "locked");
    assert.equal(plan.state, "locked");
    assert.match(approach.lock_reason, /Clear Deeper assessment to unlock Choose the approach/);
    assert.match(plan.lock_reason, /Clear Choose the approach to unlock Modernization plan/);
  } else {
    assert.equal(stages[0].state, "cleared");
    assert.equal(approach.state, before.body.modern_template ? "cleared" : "available");
    assert.equal(plan.state, before.body.modern_template ? "available" : "locked");
  }
});

test("a stage cannot be reviewed while it is locked, or before its output is ready", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.deeper_done = false;
  analysis.modern_template = null;
  const locked = await call(`/api/analyses/${AN_ACME}/progress`, { as: "eng_a", method: "PUT", body: { action: "review", stage: "plan" } });
  assert.equal(locked.status, 409);
  assert.match(locked.body.error, /Clear Choose the approach/);
  analysis.deeper_done = true;
  analysis.modern_template = "web-modern";
  analysis.modern_progress = { plan: { reviewed_by: PEOPLE.eng_a.email, reviewed_at: NOW }, starter: { reviewed_by: PEOPLE.eng_a.email, reviewed_at: NOW } };
  const notReady = await call(`/api/analyses/${AN_ACME}/progress`, { as: "eng_a", method: "PUT", body: { action: "review", stage: "convert" } });
  assert.equal(notReady.status, 409);
  assert.match(notReady.body.error, /not ready yet/);
});

test("a platform engineer can review the plan once the approach is chosen", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.deeper_done = true;
  analysis.modern_template = "lift-contain";
  analysis.modern_progress = {};
  const plan = await call(`/api/analyses/${AN_ACME}/progress`, { as: "eng_a", method: "PUT", body: { action: "review", stage: "plan" } });
  assert.equal(plan.status, 200);
  assert.equal(plan.body.stages.find((s) => s.id === "plan").state, "cleared");
  assert.equal(plan.body.stages.find((s) => s.id === "starter").state, "available");
});

test("a platform engineer can review the starter project once the plan is cleared", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.deeper_done = true;
  analysis.modern_template = "web-modern";
  analysis.modern_progress = { plan: { reviewed_by: PEOPLE.eng_a.email, reviewed_at: NOW } };
  const starter = await call(`/api/analyses/${AN_ACME}/progress`, { as: "eng_a", method: "PUT", body: { action: "review", stage: "starter" } });
  assert.equal(starter.status, 200);
  assert.equal(starter.body.stages.find((s) => s.id === "starter").state, "cleared");
  assert.equal(starter.body.stages.find((s) => s.id === "convert").state, "available");
});

test("only a platform engineer can review, and an unknown stage or action is refused", async () => {
  const auditor = await call(`/api/analyses/${AN_ACME}/progress`, { as: "aud_a", method: "PUT", body: { action: "review", stage: "plan" } });
  assert.equal(auditor.status, 403);
  const unknown = await call(`/api/analyses/${AN_ACME}/progress`, { as: "eng_a", method: "PUT", body: { action: "review", stage: "magic" } });
  assert.equal(unknown.status, 400);
  const badAction = await call(`/api/analyses/${AN_ACME}/progress`, { as: "eng_a", method: "PUT", body: { action: "skip", stage: "plan" } });
  assert.equal(badAction.status, 400);
});

test("a cleared stage is celebrated once for each viewer, and the acknowledgement is kept", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.deeper_done = true;
  const first = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(first.body.stages.find((s) => s.id === "deeper").celebrate, true);
  const ack = await call(`/api/analyses/${AN_ACME}/progress`, { as: "eng_a", method: "PUT", body: { action: "acknowledge", stage: "deeper" } });
  assert.equal(ack.status, 200);
  const again = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(again.body.stages.find((s) => s.id === "deeper").celebrate, false);
  const other = await call(`/api/analyses/${AN_ACME}`, { as: "aud_a" });
  assert.equal(other.body.stages.find((s) => s.id === "deeper").celebrate, true, "each viewer is told once");
  const early = await call(`/api/analyses/${AN_ACME}/progress`, { as: "eng_a", method: "PUT", body: { action: "acknowledge", stage: "pr" } });
  assert.equal(early.status, 409);
});

// ---- Stage 3: converting one file ----

const CONVERSION_TEXT = "I approve one file at a time being sent to the language model I've chosen, after the personal-data check. I understand the proposed code is reviewed by me, and only I merge it.";

function readyForConversion(overrides = {}) {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  Object.assign(analysis, {
    deeper_done: true, scope: "modernize", modern_template: "web-modern", target_language: "python-fastapi", model_key_id: "key-1", source_upload: false,
    modern_progress: {
      plan: { reviewed_by: PEOPLE.eng_a.email, reviewed_at: NOW },
      starter: { reviewed_by: PEOPLE.eng_a.email, reviewed_at: NOW },
    },
  }, overrides);
  return analysis;
}

test("only a platform engineer can convert a file, from one this analysis holds", async () => {
  readyForConversion();
  state.workspaces.find((w) => w.id === W_ACME).conversion_approved_at = NOW;
  state.workspaces.find((w) => w.id === W_ACME).conversion_approval_version = 1;
  const auditor = await call(`/api/analyses/${AN_ACME}/conversions`, { as: "aud_a", method: "POST", body: { path: "src/A.java" } });
  assert.equal(auditor.status, 403);
  const traversal = await call(`/api/analyses/${AN_ACME}/conversions`, { as: "eng_a", method: "POST", body: { path: "../secret.txt" } });
  assert.equal(traversal.status, 400);
  const unknown = await call(`/api/analyses/${AN_ACME}/conversions`, { as: "eng_a", method: "POST", body: { path: "nope/Missing.java" } });
  assert.equal(unknown.status, 400);
});

test("a file cannot be converted until the plan and the starter are cleared, or without a model, or from a zip", async () => {
  readyForConversion({ modern_progress: { plan: { reviewed_by: PEOPLE.eng_a.email, reviewed_at: NOW } } });
  const locked = await call(`/api/analyses/${AN_ACME}/conversions`, { as: "eng_a", method: "POST", body: { path: "src/A.java" } });
  assert.equal(locked.status, 409);
  assert.match(locked.body.error, /Clear/);
  readyForConversion({ source_upload: true });
  const zip = await call(`/api/analyses/${AN_ACME}/conversions`, { as: "eng_a", method: "POST", body: { path: "src/A.java" } });
  assert.equal(zip.status, 409);
  assert.match(zip.body.error, /zip/);
  readyForConversion({ model_key_id: null });
  const nokey = await call(`/api/analyses/${AN_ACME}/conversions`, { as: "eng_a", method: "POST", body: { path: "src/A.java" } });
  assert.equal(nokey.status, 409);
  assert.match(nokey.body.error, /language model/);
});

test("the workspace admin approves converting files, with the exact wording, and can withdraw it", async () => {
  const notAdmin = await call(`/api/workspaces/${W_ACME}/conversion-approval`, { as: "aud_a", method: "PUT", body: { approve: true, wording: "x" } });
  assert.equal(notAdmin.status, 403);
  const wrongWording = await call(`/api/workspaces/${W_ACME}/conversion-approval`, { as: "admin_a", method: "PUT", body: { approve: true, wording: "yes" } });
  assert.equal(wrongWording.status, 400);
  const approved = await call(`/api/workspaces/${W_ACME}/conversion-approval`, { as: "admin_a", method: "PUT", body: { approve: true, wording: CONVERSION_TEXT } });
  assert.equal(approved.status, 200);
  const ws = state.workspaces.find((w) => w.id === W_ACME);
  assert.equal(ws.conversion_approved_by_email, PEOPLE.admin_a.email);
  assert.equal(ws.conversion_approval_version, 1);
  const curly = CONVERSION_TEXT.replace("I've", "I\u2019ve");
  const spaced = await call(`/api/workspaces/${W_ACME}/conversion-approval`, { as: "admin_a", method: "PUT", body: { approve: true, wording: `  ${curly}\n` } });
  assert.equal(spaced.status, 200, "spaces at the ends and a curly apostrophe are accepted");
  const withdrawn = await call(`/api/workspaces/${W_ACME}/conversion-approval`, { as: "admin_a", method: "PUT", body: { approve: false } });
  assert.equal(withdrawn.status, 200);
  assert.equal(state.workspaces.find((w) => w.id === W_ACME).conversion_approved_at, null);
});

test("a file cannot be converted until a workspace admin has approved it", async () => {
  readyForConversion();
  const none = await call(`/api/analyses/${AN_ACME}/conversions`, { as: "eng_a", method: "POST", body: { path: "src/A.java" } });
  assert.equal(none.status, 409);
  assert.match(none.body.error, /admin must approve/);
});

test("a conversion starts the runner with a one-time token and no key, and its result is kept as a proposal", async () => {
  readyForConversion();
  await call(`/api/workspaces/${W_ACME}/conversion-approval`, { as: "admin_a", method: "PUT", body: { approve: true, wording: CONVERSION_TEXT } });
  github.dispatches.length = 0;
  const started = await call(`/api/analyses/${AN_ACME}/conversions`, { as: "eng_a", method: "POST", body: { path: "src/A.java" } });
  assert.equal(started.status, 202);
  assert.equal(github.dispatches.length, 1);
  const inputs = github.dispatches[0].inputs;
  assert.equal(inputs.path, "src/A.java");
  assert.equal(inputs.template, "web-modern");
  assert.ok(inputs.model_token && inputs.model_token.length > 20, "a one-time token is passed");
  assert.ok(!JSON.stringify(inputs).includes("api_key"), "no key is passed");
  const queued = state.analysis_conversions.find((c) => c.analysis_id === AN_ACME && c.path === "src/A.java");
  assert.equal(queued.status, "queued");

  const wrong = await call(`/api/runner/${AN_ACME}/conversion`, { method: "POST", body: { path: "src/A.java", status: "ok", proposed: "x" }, secret: "wrong" });
  assert.equal(wrong.status, 401);
  const bad = await call(`/api/runner/${AN_ACME}/conversion`, { method: "POST", body: { path: "src/A.java", status: "ok" }, secret: env.RUNNER_SECRET });
  assert.equal(bad.status, 400);
  const saved = await call(`/api/runner/${AN_ACME}/conversion`, { method: "POST", body: { path: "src/A.java", template: "web-modern", status: "ok", proposed: "public class A {}" }, secret: env.RUNNER_SECRET });
  assert.equal(saved.status, 201);
  const kept = state.analysis_conversions.find((c) => c.analysis_id === AN_ACME && c.path === "src/A.java");
  assert.equal(kept.status, "ok");
  assert.equal(kept.proposed, "public class A {}");
  assert.equal(kept.decision, undefined, "decisions are added later, not by the runner");
});

test("a platform engineer sees the proposals and accepts or rejects a kept one; others see none", async () => {
  readyForConversion();
  state.analysis_conversions.push(
    { id: uid(901), analysis_id: AN_ACME, path: "src/A.java", template: "web-modern", status: "ok", proposed: "class A {}", reason: null, kinds: [], stage: null, decision: "pending" },
    { id: uid(902), analysis_id: AN_ACME, path: "src/B.java", template: "web-modern", status: "blocked", proposed: null, reason: "personal data", kinds: ["email address"], stage: "request", decision: "pending" },
  );
  const engineer = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(engineer.body.conversions.length, 2);
  const auditor = await call(`/api/analyses/${AN_ACME}`, { as: "aud_a" });
  assert.deepEqual(auditor.body.conversions, [], "only platform engineers see proposals");
  const blocked = await call(`/api/analyses/${AN_ACME}/conversions/decision`, { as: "eng_a", method: "POST", body: { path: "src/B.java", decision: "accepted" } });
  assert.equal(blocked.status, 409);
  const denied = await call(`/api/analyses/${AN_ACME}/conversions/decision`, { as: "aud_a", method: "POST", body: { path: "src/A.java", decision: "accepted" } });
  assert.equal(denied.status, 403);
  const accepted = await call(`/api/analyses/${AN_ACME}/conversions/decision`, { as: "eng_a", method: "POST", body: { path: "src/A.java", decision: "accepted" } });
  assert.equal(accepted.status, 200);
  const kept = state.analysis_conversions.find((c) => c.path === "src/A.java");
  assert.equal(kept.decision, "accepted");
  assert.equal(kept.decided_by_email, PEOPLE.eng_a.email);
  const bad = await call(`/api/analyses/${AN_ACME}/conversions/decision`, { as: "eng_a", method: "POST", body: { path: "src/A.java", decision: "maybe" } });
  assert.equal(bad.status, 400);
});

// ---- Uploading a zip of the code, without GitHub ----

const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0]);

function uploadRequest(query, { body = ZIP_BYTES, as = "eng_a", contentLength } = {}) {
  const headers = { "content-type": "application/zip", authorization: `Bearer tok-${PEOPLE[as].email}` };
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  return new Request(`https://api.test/api/analyses/upload?${new URLSearchParams(query).toString()}`, {
    method: "POST", headers, body,
  });
}

const UPLOAD_QUERY = { workspace_id: W_ACME, app_name: "Zipped app", data_rules_confirmed: "true" };

test("an upload needs the data rules confirmed and a real zip", async () => {
  const noRules = await worker.fetch(uploadRequest({ ...UPLOAD_QUERY, data_rules_confirmed: "false" }), env);
  assert.equal(noRules.status, 400);
  const notZip = await worker.fetch(uploadRequest(UPLOAD_QUERY, { body: Buffer.from("plain text") }), env);
  assert.equal(notZip.status, 400);
  assert.equal(storedZips.size, 0, "nothing is stored when the upload is refused");
});

test("an upload over 50 MB is refused before it is read", async () => {
  const res = await worker.fetch(uploadRequest(UPLOAD_QUERY, { contentLength: 60 * 1024 * 1024 }), env);
  assert.equal(res.status, 413);
  assert.equal(storedZips.size, 0);
});

test("only a platform engineer can upload code", async () => {
  const res = await worker.fetch(uploadRequest(UPLOAD_QUERY, { as: "aud_a" }), env);
  assert.equal(res.status, 403);
});

test("an upload is stored privately, the run starts without a repository, and the runner reads then deletes the zip", async () => {
  github.dispatches.length = 0;
  const started = await worker.fetch(uploadRequest(UPLOAD_QUERY), env);
  assert.equal(started.status, 202);
  const { id } = await started.json();
  assert.equal(storedZips.size, 1, "the zip is stored once");
  assert.equal(github.dispatches.length, 1);
  assert.equal(github.dispatches[0].inputs.source_upload, true);
  assert.equal(github.dispatches[0].inputs.repo, "upload/archive");

  const refused = await call(`/api/runner/${id}/source`, { secret: "wrong" });
  assert.equal(refused.status, 401);
  const read = await worker.fetch(request(`/api/runner/${id}/source`, { secret: env.RUNNER_SECRET }), env);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("content-type"), "application/zip");
  assert.deepEqual(new Uint8Array(await read.arrayBuffer()), new Uint8Array(ZIP_BYTES));

  const deleted = await call(`/api/runner/${id}/source`, { method: "DELETE", secret: env.RUNNER_SECRET });
  assert.equal(deleted.status, 200);
  assert.equal(storedZips.size, 0, "the zip is gone once the run has read it");
  const after = await call(`/api/runner/${id}/source`, { secret: env.RUNNER_SECRET });
  assert.equal(after.status, 404);
});

test("a GitHub analysis is not given an upload, and the runner gets no zip for it", async () => {
  const res = await call(`/api/runner/${AN_ACME}/source`, { secret: env.RUNNER_SECRET });
  assert.equal(res.status, 404);
});

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

test("a result that found nothing is kept but is not counted as a point", async () => {
  const row = state.analyses.find((a) => a.id === AN_ACME);
  const saved = structuredClone(row.findings);
  row.findings.findings.stack1.point = false;
  try {
    const res = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
    assert.equal(res.body.findings.findings.stack1.point, false, "the finding is still in the report");
    assert.deepEqual(res.body.findings.counts, { total: 8, shown: 8 });
  } finally {
    row.findings = saved;
  }
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

// ---- Model keys ----

const KEYS = (id = W_ACME) => `/api/workspaces/${id}/model-keys`;

// A workspace that has signed off the privacy notice, so keys may be added.
function signedOff(workspaceId = W_ACME) {
  state.privacy_signoffs.push({
    id: randomUUID(), workspace_id: workspaceId, user_id: PEOPLE.admin_a.id, email: PEOPLE.admin_a.email,
    full_name: "Ada Admin", action: "signed_off", notice_version: "2026-10-18.1", notice_text: "text",
    statements: [], created_at: NOW,
  });
}

test("a key is tested first, then saved encrypted, and only the last four characters are shown", async () => {
  signedOff();
  const res = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: res.body.id, provider: "anthropic", label: "Anthropic (Claude)", model: "claude-haiku-5-5", last4: "1234" });
  assert.equal(state.model_keys.length, 1);
  const row = state.model_keys[0];
  assert.equal(row.last4, "1234");
  assert.equal(row.created_by_email, PEOPLE.admin_a.email);
  assert.ok(!row.ciphertext.includes("good-key"), "the stored value is not the key");
  assert.ok(!JSON.stringify(state.model_keys).includes(GOOD_KEY), "the key does not appear anywhere in the stored rows");
  const testCall = outbound.find((c) => c.url === "https://api.anthropic.com/v1/messages");
  assert.ok(testCall, "the key was tested with the provider");
  assert.equal(github.anthropicCalls, 1);
});

test("the key never comes back in any response, and never appears in the URL of any request", async () => {
  signedOff();
  const added = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  const listed = await call(KEYS(), { as: "eng_a" });
  assert.ok(!JSON.stringify(added.body).includes(GOOD_KEY));
  assert.ok(!JSON.stringify(listed.body).includes(GOOD_KEY));
  assert.ok(!outbound.some((c) => c.url.includes(GOOD_KEY)), "the key is never in a URL");
});

test("a key the provider refuses is not saved", async () => {
  signedOff();
  const res = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: BAD_KEY } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /did not accept this key/);
  assert.equal(state.model_keys.length, 0);
});

test("a key cannot be added until the privacy notice is signed off", async () => {
  const res = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Sign off the privacy notice/);
  assert.equal(state.model_keys.length, 0);
  assert.equal(github.anthropicCalls || 0, 0, "the provider is not contacted without a sign-off");
});

test("only a workspace admin can add or remove a key; members can see the list", async () => {
  signedOff();
  const add = await call(KEYS(), { method: "POST", as: "eng_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  assert.equal(add.status, 403);
  await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  const id = state.model_keys[0].id;
  const remove = await call(`${KEYS()}/${id}`, { method: "DELETE", as: "eng_a" });
  assert.equal(remove.status, 403);
  const list = await call(KEYS(), { as: "eng_a" });
  assert.equal(list.status, 200);
  assert.equal(list.body.can_change, false);
  assert.equal(list.body.keys.length, 1);
});

test("one active key per provider; a second is refused until the first is removed", async () => {
  signedOff();
  await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  const second = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  assert.equal(second.status, 409);
  const id = state.model_keys[0].id;
  const removed = await call(`${KEYS()}/${id}`, { method: "DELETE", as: "admin_a" });
  assert.equal(removed.status, 200);
  const again = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  assert.equal(again.status, 201);
});

test("removing a key keeps the record and drops it from the list", async () => {
  signedOff();
  await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  const id = state.model_keys[0].id;
  await call(`${KEYS()}/${id}`, { method: "DELETE", as: "admin_a" });
  assert.equal(state.model_keys.length, 1, "the row is kept");
  assert.ok(state.model_keys[0].revoked_at, "marked as revoked");
  assert.equal(state.model_keys[0].revoked_by_email, PEOPLE.admin_a.email);
  const list = await call(KEYS(), { as: "admin_a" });
  assert.deepEqual(list.body.keys, []);
});

test("rate-limited and malformed requests are refused without saving", async () => {
  signedOff();
  const busy = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: BUSY_KEY } });
  assert.equal(busy.status, 400);
  assert.match(busy.body.error, /limiting requests/);
  const unknown = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "nope", api_key: GOOD_KEY } });
  assert.equal(unknown.status, 400);
  const short = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: "short" } });
  assert.equal(short.status, 400);
  const spaced = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: `${GOOD_KEY} extra` } });
  assert.equal(spaced.status, 400);
  assert.equal(state.model_keys.length, 0);
});

test("keys cannot be saved while the server has no encryption key", async () => {
  signedOff();
  const noSecret = { ...env, CUTOVER_KEY_ENCRYPTION_KEY: undefined };
  const res = await worker.fetch(request(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } }), noSecret);
  assert.equal(res.status, 503);
  assert.equal(state.model_keys.length, 0);
});

test("a key row is never deleted or given more rights than the Worker needs", async () => {
  signedOff();
  await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  await call(`${KEYS()}/${state.model_keys[0].id}`, { method: "DELETE", as: "admin_a" });
  const touched = outbound.filter((c) => c.url.includes("/rest/v1/model_keys"));
  assert.ok(touched.length > 0);
  assert.ok(touched.every((c) => c.method !== "DELETE"), "rows are revoked, never deleted");
});

// ---- Google (Gemini) keys ----

test("a Google key is tested in its header, saved encrypted, and listed beside the Anthropic one", async () => {
  signedOff();
  const google = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "google", api_key: GOOD_GOOGLE_KEY } });
  assert.equal(google.status, 201);
  assert.deepEqual(google.body, { id: google.body.id, provider: "google", label: "Google (Gemini)", model: "gemini-3.5-flash", last4: "5678" });
  const anthropic = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "anthropic", api_key: GOOD_KEY } });
  assert.equal(anthropic.status, 201);
  const list = await call(KEYS(), { as: "eng_a" });
  assert.deepEqual(list.body.keys.map((k) => k.provider).sort(), ["anthropic", "google"]);
  assert.ok(!outbound.some((c) => c.url.includes(GOOD_GOOGLE_KEY)), "the Google key is never in a URL");
  assert.ok(!JSON.stringify(state.model_keys).includes(GOOD_GOOGLE_KEY), "the Google key is not stored in clear");
});

test("a Google key the provider refuses is not saved, with a Google-specific reason", async () => {
  signedOff();
  const res = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "google", api_key: BAD_GOOGLE_KEY } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Google did not accept this key/);
  assert.equal(state.model_keys.length, 0);
});

// ---- A model for an analysis, and the one-time release of its key to the runner ----

const MODEL_TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,100}$/;
const LATER = "2026-10-18T13:00:00.000Z";

async function addGoogleKey(workspaceId = W_ACME, as = "admin_a") {
  signedOff(workspaceId);
  const res = await call(KEYS(workspaceId), { method: "POST", as, body: { provider: "google", api_key: GOOD_GOOGLE_KEY } });
  assert.equal(res.status, 201);
  return res.body.id;
}

function withdraw(workspaceId = W_ACME, at = LATER) {
  state.privacy_signoffs.push({
    id: randomUUID(), workspace_id: workspaceId, user_id: PEOPLE.admin_a.id, email: PEOPLE.admin_a.email,
    full_name: "Ada Admin", action: "withdrawn", notice_version: "2026-10-18.1", notice_text: "text", statements: [], created_at: at,
  });
}

test("starting with a model records its provider, key and sign-off, and the runner gets a token, not the key", async () => {
  const keyId = await addGoogleKey();
  const res = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: keyId } });
  assert.equal(res.status, 202);
  const row = state.analyses.find((a) => a.id === res.body.id);
  assert.equal(row.model_provider, "google");
  assert.equal(row.model_key_id, keyId);
  assert.equal(row.model_notice_version, "2026-10-18.1");
  assert.equal(row.model_chosen_by_email, PEOPLE.eng_a.email);
  const token = github.dispatches[0].inputs.model_token;
  assert.match(token, MODEL_TOKEN_SHAPE);
  assert.ok(!JSON.stringify(github.dispatches).includes(GOOD_GOOGLE_KEY), "the key never goes to GitHub");
  assert.equal(state.analysis_model_tokens.length, 1);
  assert.equal(state.analysis_model_tokens[0].token_hash.length, 64, "only a SHA-256 hash of the token is stored");
  assert.ok(!JSON.stringify(state.analysis_model_tokens).includes(token), "the token itself is not stored");
});

test("starting without a model sends an empty token and records no model", async () => {
  const res = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME } });
  assert.equal(res.status, 202);
  const row = state.analyses.find((a) => a.id === res.body.id);
  assert.equal(row.model_provider ?? null, null);
  assert.equal(github.dispatches[0].inputs.model_token, "");
  assert.equal(state.analysis_model_tokens.length, 0);
});

test("a model needs a current sign-off, a key of this workspace, and a key that is still active", async () => {
  const keyId = await addGoogleKey();
  const betaKey = await addGoogleKey(W_BETA, "eng_b");
  const otherWorkspace = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: betaKey } });
  assert.equal(otherWorkspace.status, 400);

  const notAKey = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: "not-a-key" } });
  assert.equal(notAKey.status, 400);

  withdraw();
  const withdrawn = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: keyId } });
  assert.equal(withdrawn.status, 409);

  state.privacy_signoffs.push({ ...state.privacy_signoffs[0], id: randomUUID(), action: "signed_off", created_at: "2026-10-18T14:00:00.000Z" });
  await call(`${KEYS()}/${keyId}`, { method: "DELETE", as: "admin_a" });
  const removed = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: keyId } });
  assert.equal(removed.status, 400);
  assert.equal(github.dispatches.length, 0, "nothing is started when the model is refused");
});

test("screens from the model are off by default, only an admin can turn them on, and the run is told", async () => {
  const keyId = await addGoogleKey();
  const listed = await call(KEYS(W_ACME), { as: "admin_a" });
  assert.equal(listed.body.draw_screens, false, "off until an admin turns it on");

  await startAndFinish({ as: "eng_a", workspace_id: W_ACME, model_key_id: keyId });
  assert.equal(github.dispatches.at(-1).inputs.draw_screens, false, "the run is told screens are off");

  const notAdmin = await call(`/api/workspaces/${W_ACME}/model-screens`, { as: "eng_a", method: "PUT", body: { enabled: true } });
  assert.equal(notAdmin.status, 403, "only a workspace admin can turn screens on");
  const bad = await call(`/api/workspaces/${W_ACME}/model-screens`, { as: "admin_a", method: "PUT", body: { enabled: "yes" } });
  assert.equal(bad.status, 400);

  const on = await call(`/api/workspaces/${W_ACME}/model-screens`, { as: "admin_a", method: "PUT", body: { enabled: true } });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body, { draw_screens: true });
  assert.equal((await call(KEYS(W_ACME), { as: "admin_a" })).body.draw_screens, true);

  await startAndFinish({ as: "eng_a", workspace_id: W_ACME, model_key_id: keyId });
  assert.equal(github.dispatches.at(-1).inputs.draw_screens, true, "the run is told screens are on");

  await startAndFinish({ as: "eng_a", workspace_id: W_ACME });
  assert.equal(github.dispatches.at(-1).inputs.draw_screens, false, "without a model, no screens are drawn");
});

// Starts a run and lets the runner finish it, so the workspace is free for the next one.
async function startAndFinish(body) {
  const { as, ...rest } = body;
  const res = await call("/api/analyses", { as, method: "POST", body: { ...START, ...rest } });
  assert.equal(res.status, 202);
  await call(`/api/runner/${res.body.id}/result`, { method: "POST", secret: env.RUNNER_SECRET, body: { status: "complete", findings: {} } });
  return res;
}

function runningAnalysisWithId(id, owner = PEOPLE.eng_a.id) {
  state.analyses.push({
    id, workspace_id: W_ACME, owner_id: owner, repo: "acme/app", ref: null, app_name: "Acme app",
    status: "running", commit_sha: null, findings: null, error: null, created_at: NOW, finished_at: null, expires_at: FAR_FUTURE, file_bytes: 0,
  });
}

test("starting an analysis saves a notification for its starter; the bell lists only their own, and marks read", async () => {
  await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME } });
  const started = state.notifications.filter((n) => n.kind === "analysis_started");
  assert.equal(started.length, 1);
  assert.equal(started[0].user_id, PEOPLE.eng_a.id);
  assert.equal(started[0].tone, "info");

  const mine = await call("/api/notifications", { as: "eng_a" });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.unread, 1);
  assert.equal(mine.body.items[0].kind, "analysis_started");
  assert.deepEqual((await call("/api/notifications", { as: "aud_a" })).body.items, [], "other people never see it");

  const read = await call("/api/notifications/read", { as: "eng_a", method: "POST", body: { all: true } });
  assert.equal(read.status, 200);
  assert.equal((await call("/api/notifications", { as: "eng_a" })).body.unread, 0);
  assert.equal((await call("/api/notifications/read", { as: "eng_a", method: "POST", body: {} })).status, 400, "say what to mark");
});

test("the owner hears when an analysis finishes, in green, or fails, in red, with the reason", async () => {
  runningAnalysisWithId(uid(260));
  await call(`/api/runner/${uid(260)}/result`, { method: "POST", secret: env.RUNNER_SECRET, body: { status: "complete", findings: {} } });
  const ok = state.notifications.find((n) => n.kind === "analysis_complete");
  assert.equal(ok.user_id, PEOPLE.eng_a.id);
  assert.equal(ok.tone, "success");
  assert.match(ok.title, /Acme app/);

  runningAnalysisWithId(uid(261));
  await call(`/api/runner/${uid(261)}/result`, { method: "POST", secret: env.RUNNER_SECRET, body: { status: "failed", error: "Clone failed." } });
  const bad = state.notifications.find((n) => n.kind === "analysis_failed");
  assert.equal(bad.tone, "danger");
  assert.match(bad.body, /Clone failed/);
});

test("a privacy sign-off tells the other admins, not the person who signed", async () => {
  state.members.find((m) => m.user_id === PEOPLE.eng_a.id && m.workspace_id === W_ACME).is_admin = true;
  const res = await call(`/api/workspaces/${W_ACME}/privacy/signoff`, { method: "POST", as: "admin_a", body: SIGN("Ada Admin") });
  assert.equal(res.status, 201);
  const told = state.notifications.filter((n) => n.kind === "privacy_signed_off");
  assert.deepEqual(told.map((n) => n.user_id), [PEOPLE.eng_a.id]);
  assert.equal(told[0].tone, "success");
});

test("a new comment tells the analysis owner, but not when the owner writes it", async () => {
  await call(`/api/analyses/${AN_ACME}/comments`, { as: "aud_a", method: "POST", body: { body: "Please add the retention date." } });
  const told = state.notifications.filter((n) => n.kind === "comment_added");
  assert.deepEqual(told.map((n) => n.user_id), [PEOPLE.eng_a.id]);
  assert.equal(told[0].analysis_id, AN_ACME);
  await call(`/api/analyses/${AN_ACME}/comments`, { as: "eng_a", method: "POST", body: { body: "Done." } });
  assert.equal(state.notifications.filter((n) => n.kind === "comment_added").length, 1, "no notice to yourself");
});

test("the browser may send PUT from the app (the screens setting needs it)", async () => {
  const appEnv = { ...env, APP_ORIGIN: "https://app.cutover.site" };
  const res = await worker.fetch(new Request("https://api.test/api/workspaces/" + W_ACME + "/model-screens", {
    method: "OPTIONS",
    headers: { origin: "https://app.cutover.site", "access-control-request-method": "PUT" },
  }), appEnv);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://app.cutover.site");
  assert.match(res.headers.get("access-control-allow-methods"), /\bPUT\b/);
});

test("the runner trades its token once for the key; wrong, reused, or misdirected tokens get nothing", async () => {
  const keyId = await addGoogleKey();
  const started = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: keyId } });
  const token = github.dispatches[0].inputs.model_token;
  const path = `/api/runner/${started.body.id}/model-key`;

  assert.equal((await call(path, { method: "POST", secret: "wrong", body: { token } })).status, 401, "the shared secret is needed");
  assert.equal((await call(path, { method: "POST", secret: env.RUNNER_SECRET, body: { token: "x".repeat(30) } })).status, 401, "a wrong token gets nothing");
  assert.equal((await call(path, { method: "POST", secret: env.RUNNER_SECRET, body: { token: "short" } })).status, 401, "a malformed token gets nothing");
  assert.equal((await call(`/api/runner/${AN_RUNNING}/model-key`, { method: "POST", secret: env.RUNNER_SECRET, body: { token } })).status, 401, "a token only works for its own analysis");

  const released = await call(path, { method: "POST", secret: env.RUNNER_SECRET, body: { token } });
  assert.equal(released.status, 200);
  assert.deepEqual(released.body, { provider: "google", model: "gemini-3.5-flash", base_url: null, token_field: "max_tokens", api_key: GOOD_GOOGLE_KEY });
  assert.equal(released.body.api_key, GOOD_GOOGLE_KEY);

  const again = await call(path, { method: "POST", secret: env.RUNNER_SECRET, body: { token } });
  assert.equal(again.status, 401, "a second use gets nothing");
  assert.ok(!JSON.stringify(again.body).includes(GOOD_GOOGLE_KEY));
});

test("a token expires after ten minutes", async () => {
  const keyId = await addGoogleKey();
  const started = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: keyId } });
  const token = github.dispatches[0].inputs.model_token;
  state.analysis_model_tokens[0].expires_at = LONG_AGO;
  const res = await call(`/api/runner/${started.body.id}/model-key`, { method: "POST", secret: env.RUNNER_SECRET, body: { token } });
  assert.equal(res.status, 401);
  assert.equal(state.analysis_model_tokens[0].used_at, null, "an expired token is not used up");
});

test("a withdrawn sign-off or a removed key stops the release, and the token is kept for a later try", async () => {
  const keyId = await addGoogleKey();
  const started = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: keyId } });
  const token = github.dispatches[0].inputs.model_token;
  const path = `/api/runner/${started.body.id}/model-key`;

  withdraw();
  const refused = await call(path, { method: "POST", secret: env.RUNNER_SECRET, body: { token } });
  assert.equal(refused.status, 403);
  assert.equal(state.analysis_model_tokens[0].used_at, null, "the refusal does not use up the token");

  state.privacy_signoffs.push({ ...state.privacy_signoffs[0], id: randomUUID(), action: "signed_off", created_at: "2026-10-18T14:00:00.000Z" });
  const later = await call(path, { method: "POST", secret: env.RUNNER_SECRET, body: { token } });
  assert.equal(later.status, 200);
});

test("a key removed after the analysis started is not released", async () => {
  const keyId = await addGoogleKey();
  const started = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: keyId } });
  const token = github.dispatches[0].inputs.model_token;
  await call(`${KEYS()}/${keyId}`, { method: "DELETE", as: "admin_a" });
  const res = await call(`/api/runner/${started.body.id}/model-key`, { method: "POST", secret: env.RUNNER_SECRET, body: { token } });
  assert.equal(res.status, 403);
});

test("the analysis shows which model it used, never the key or the token", async () => {
  const keyId = await addGoogleKey();
  const started = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: keyId } });
  const token = github.dispatches[0].inputs.model_token;
  const res = await call(`/api/analyses/${started.body.id}`, { as: "eng_a" });
  assert.equal(res.status, 200);
  assert.equal(res.body.model_provider, "google");
  assert.equal(res.body.model_notice_version, "2026-10-18.1");
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes(GOOD_GOOGLE_KEY));
  assert.ok(!text.includes(token));
});

test("if the token cannot be saved, the analysis is marked failed and the runner is not started", async () => {
  const keyId = await addGoogleKey();
  github.failTokens = true;
  const res = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: keyId } });
  assert.equal(res.status, 502);
  assert.equal(github.dispatches.length, 0);
  const row = state.analyses[state.analyses.length - 1];
  assert.equal(row.status, "failed");
});

// ---- Where each file's purpose came from: the rules engine or the workspace's own model ----

test("a file purpose is marked as the model's or the rules', and only those two values are accepted", async () => {
  runningAnalysis();
  const saved = await call(`/api/runner/${AN_RUNNING}/files`, {
    method: "POST",
    body: { files: [{ ...sampleFile("src/Model.java"), purpose_source: "model" }, sampleFile("src/Rules.java")] },
    secret: env.RUNNER_SECRET,
  });
  assert.equal(saved.status, 201);
  const rows = state.file_findings.filter((f) => f.analysis_id === AN_RUNNING);
  assert.equal(rows.find((r) => r.path === "src/Model.java").purpose_source, "model");
  assert.equal(rows.find((r) => r.path === "src/Rules.java").purpose_source, "rules", "rules is the default");

  const bad = await call(`/api/runner/${AN_RUNNING}/files`, {
    method: "POST",
    body: { files: [{ ...sampleFile("src/Other.java"), purpose_source: "a person" }] },
    secret: env.RUNNER_SECRET,
  });
  assert.equal(bad.status, 400);
  assert.equal(state.file_findings.filter((f) => f.path === "src/Other.java").length, 0);
});

test("the file list tells the app which purposes the model wrote", async () => {
  runningAnalysis();
  await call(`/api/runner/${AN_RUNNING}/files`, {
    method: "POST",
    body: { files: [{ ...sampleFile("src/Model.java"), purpose_source: "model" }] },
    secret: env.RUNNER_SECRET,
  });
  const list = await call(`/api/analyses/${AN_RUNNING}/files`, { as: "eng_a" });
  assert.equal(list.status, 200);
  assert.ok(JSON.stringify(list.body).includes('"purpose_source":"model"'));
});

// ---- Screens drawn by the workspace's own model from the code ----

const SCREEN_HTML = "<!doctype html><html><body><h1>Appointments</h1><p>Sample visit: 10:30, Room 4</p></body></html>";
const screen = (path, extra = {}) => ({ path, name: `Screen ${path}`, html: SCREEN_HTML, ...extra });

test("the runner needs the shared secret, and screens are refused once the analysis is finished", async () => {
  runningAnalysis();
  const wrong = await call(`/api/runner/${AN_RUNNING}/screens`, { method: "POST", body: { screens: [screen("a.html")] }, secret: "wrong" });
  assert.equal(wrong.status, 401);
  const finished = await call(`/api/runner/${AN_ACME}/screens`, { method: "POST", body: { screens: [screen("a.html")] }, secret: env.RUNNER_SECRET });
  assert.equal(finished.status, 409);
  const missing = await call(`/api/runner/${uid(999)}/screens`, { method: "POST", body: { screens: [screen("a.html")] }, secret: env.RUNNER_SECRET });
  assert.equal(missing.status, 404);
});

test("drawn screens are saved, and a later upload replaces the earlier ones", async () => {
  runningAnalysis();
  const first = await call(`/api/runner/${AN_RUNNING}/screens`, { method: "POST", body: { screens: [screen("a.html"), screen("b.html")] }, secret: env.RUNNER_SECRET });
  assert.equal(first.status, 201);
  assert.equal(first.body.saved, 2);
  const again = await call(`/api/runner/${AN_RUNNING}/screens`, { method: "POST", body: { screens: [screen("c.html")] }, secret: env.RUNNER_SECRET });
  assert.equal(again.status, 201);
  const kept = state.analysis_screens.filter((s) => s.analysis_id === AN_RUNNING).map((s) => s.path);
  assert.deepEqual(kept, ["c.html"]);
});

test("a screen that runs code, loads from elsewhere, or sends a form is refused, and nothing is saved", async () => {
  runningAnalysis();
  const refused = [
    "<!doctype html><html><body><script>alert(1)</script></body></html>",
    "<!doctype html><html><body><p onclick=\"x()\">Visit</p></body></html>",
    "<!doctype html><html><body><img src=\"https://example.test/a.png\"></body></html>",
    "<!doctype html><html><body><iframe src=\"x.html\"></iframe></body></html>",
    "<!doctype html><html><body><form action=\"/send\"><input></form></body></html>",
    "<!doctype html><html><head><style>@import url(x.css);</style></head><body>Visit</body></html>",
    "<!doctype html><html><body><a href=\"javascript:alert(1)\">Visit</a></body></html>",
    "<div>A fragment without a page around it, long enough to pass the length check.</div>",
  ];
  for (const html of refused) {
    const res = await call(`/api/runner/${AN_RUNNING}/screens`, { method: "POST", body: { screens: [screen("x.html", { html })] }, secret: env.RUNNER_SECRET });
    assert.equal(res.status, 400, html);
  }
  assert.equal(state.analysis_screens.filter((s) => s.analysis_id === AN_RUNNING).length, 0);
});

test("the screen list is checked: count, paths, names and size", async () => {
  runningAnalysis();
  const send = (screens) => call(`/api/runner/${AN_RUNNING}/screens`, { method: "POST", body: { screens }, secret: env.RUNNER_SECRET });
  assert.equal((await send([])).status, 400);
  assert.equal((await send(Array.from({ length: 81 }, (_, i) => screen(`p${i}.html`)))).status, 400);
  assert.equal((await send(Array.from({ length: 80 }, (_, i) => screen(`p${i}.html`)))).status, 201);
  assert.equal((await send([screen("a.html"), screen("a.html")])).status, 400);
  assert.equal((await send([screen("a.html", { name: "" })])).status, 400);
  const big = "<!doctype html><html><body>" + "x".repeat(40_001) + "</body></html>";
  assert.equal((await send([screen("a.html", { html: big })])).status, 400);
});

test("the people who may see UI findings see the drawn screens; others do not", async () => {
  runningAnalysis();
  await call(`/api/runner/${AN_RUNNING}/screens`, { method: "POST", body: { screens: [screen("a.html")] }, secret: env.RUNNER_SECRET });
  state.analyses.find((a) => a.id === AN_RUNNING).status = "complete";
  const engineer = await call(`/api/analyses/${AN_RUNNING}`, { as: "eng_a" });
  assert.equal(engineer.body.screens.length, 1);
  assert.equal(engineer.body.screens[0].path, "a.html");
  const cio = await call(`/api/analyses/${AN_RUNNING}`, { as: "cio_a" });
  assert.equal(cio.body.screens.length, 1, "the CIO sees UI findings");
  const security = await call(`/api/analyses/${AN_RUNNING}`, { as: "sec_a" });
  assert.deepEqual(security.body.screens, []);
  const auditor = await call(`/api/analyses/${AN_RUNNING}`, { as: "aud_a" });
  assert.deepEqual(auditor.body.screens, []);
});

test("only platform engineers choose the scope, and deeper is the only choice until the deeper assessment is done", async () => {
  const denied = await call(`/api/analyses/${AN_ACME}/scope`, { as: "aud_a", method: "PATCH", body: { scope: "deeper" } });
  assert.equal(denied.status, 403);
  const bad = await call(`/api/analyses/${AN_ACME}/scope`, { as: "eng_a", method: "PATCH", body: { scope: "rebuild" } });
  assert.equal(bad.status, 400);
  const locked = await call(`/api/analyses/${AN_ACME}/scope`, { as: "eng_a", method: "PATCH", body: { scope: "migrate" } });
  assert.equal(locked.status, 409);
  assert.match(locked.body.error, /deeper assessment/);
  const deeper = await call(`/api/analyses/${AN_ACME}/scope`, { as: "eng_a", method: "PATCH", body: { scope: "deeper" } });
  assert.equal(deeper.status, 200);
  const saved = state.analyses.find((a) => a.id === AN_ACME);
  assert.equal(saved.scope, "deeper");
  assert.equal(saved.scope_set_by_email, PEOPLE.eng_a.email);
});

test("the deeper assessment is marked done when a run sends it, and each role sees only its own points", async () => {
  const deeper = {
    sections: [
      { id: "data", title: "Data", points: [{ text: "2 tables in the SQL scripts: visits, orders.", category: "data", basis: "data.tables" }] },
      { id: "workflows", title: "Workflows", points: [{ text: "Screen \"Check-in\": 1 forms.", category: "ui_portal", basis: "ui.screens" }, { text: "Version history.", category: null, basis: null }] },
    ],
    architecture: { layers: [{ layer: "Data", detail: "2 tables", category: "data" }, { layer: "Screens", detail: "1 screens", category: "ui_portal" }] },
    limits: ["Structure only."],
  };
  runningAnalysisWithId(uid(262));
  await call(`/api/runner/${uid(262)}/result`, { method: "POST", secret: env.RUNNER_SECRET, body: { status: "complete", findings: { deeper } } });
  const saved = state.analyses.find((a) => a.id === uid(262));
  assert.equal(saved.deeper_done, true);

  const engineer = await call(`/api/analyses/${uid(262)}`, { as: "eng_a" });
  assert.equal(engineer.body.findings.deeper.sections[0].points.length, 1);
  assert.equal(engineer.body.findings.deeper.architecture.layers.length, 2);

  const auditor = await call(`/api/analyses/${uid(262)}`, { as: "aud_a" });
  const auditorPoints = auditor.body.findings.deeper.sections.flatMap((s) => s.points).map((p) => p.text);
  assert.deepEqual(auditorPoints, ["Version history."], "an auditor sees only the points with no category");
  assert.deepEqual(auditor.body.findings.deeper.architecture.layers, []);

  runningAnalysisWithId(uid(263));
  await call(`/api/runner/${uid(263)}/result`, { method: "POST", secret: env.RUNNER_SECRET, body: { status: "complete", findings: {} } });
  assert.equal(state.analyses.find((a) => a.id === uid(263)).deeper_done, false, "a run without documents is not done");
});

test("choosing a scope, approving file purposes and accepting a plan tell the others, never the person who did it", async () => {
  const scope = await call(`/api/analyses/${AN_ACME}/scope`, { as: "eng_a", method: "PATCH", body: { scope: "deeper" } });
  assert.equal(scope.status, 200);
  const chosen = state.notifications.filter((n) => n.kind === "scope_chosen");
  assert.ok(chosen.length > 0, "someone hears about the scope");
  assert.ok(chosen.every((n) => n.user_id !== PEOPLE.eng_a.id), "not the person who chose it");
  assert.ok(chosen.every((n) => n.tone === "info"));

  const approved = await call(`/api/analyses/${AN_ACME}/files/approve-all`, { as: "eng_a", method: "POST" });
  assert.equal(approved.status, 200);
  const purposes = state.notifications.filter((n) => n.kind === "purposes_approved");
  assert.ok(purposes.length > 0);
  assert.ok(purposes.every((n) => n.user_id !== PEOPLE.eng_a.id));
  assert.ok(purposes.every((n) => n.tone === "success"));

  const accept = await call(`/api/contingencies/${CONTINGENCY_ACME}`, { as: "admin_a", method: "PATCH", body: { status: "accepted" } });
  assert.equal(accept.status, 200);
  const plans = state.notifications.filter((n) => n.kind === "plan_accepted");
  assert.ok(plans.length > 0);
  assert.ok(plans.every((n) => n.user_id !== PEOPLE.admin_a.id));
  assert.ok(plans.every((n) => n.tone === "success"));
});

test("the owner hears when the deeper assessment is ready, and a run without it does not say so", async () => {
  runningAnalysisWithId(uid(264));
  await call(`/api/runner/${uid(264)}/result`, { method: "POST", secret: env.RUNNER_SECRET, body: { status: "complete", findings: { deeper: { sections: [], architecture: { layers: [] }, limits: [] } } } });
  const ready = state.notifications.filter((n) => n.kind === "deeper_ready");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].user_id, PEOPLE.eng_a.id);
  assert.equal(ready[0].tone, "success");

  runningAnalysisWithId(uid(265));
  await call(`/api/runner/${uid(265)}/result`, { method: "POST", secret: env.RUNNER_SECRET, body: { status: "complete", findings: {} } });
  assert.equal(state.notifications.filter((n) => n.kind === "deeper_ready").length, 1, "no new notice without documents");
});

test("a modernize proposal is shown only to roles that may see every category it relies on", async () => {
  const deeper = {
    sections: [], architecture: { layers: [] }, limits: [],
    modernize: [
      { id: "keep", title: "Keep the platform", effort: "low", categories: [], points: ["p"], tradeoffs: ["t"], basis: [] },
      { id: "managed", title: "Move to managed services", effort: "high", categories: ["data"], points: ["p"], tradeoffs: ["t"], basis: ["data.tables"] },
    ],
  };
  runningAnalysisWithId(uid(266));
  await call(`/api/runner/${uid(266)}/result`, { method: "POST", secret: env.RUNNER_SECRET, body: { status: "complete", findings: { deeper } } });
  const engineer = await call(`/api/analyses/${uid(266)}`, { as: "eng_a" });
  assert.deepEqual(engineer.body.findings.deeper.modernize.map((p) => p.id), ["keep", "managed"]);
  const security = await call(`/api/analyses/${uid(266)}`, { as: "sec_a" });
  assert.deepEqual(security.body.findings.deeper.modernize.map((p) => p.id), ["keep"], "security does not see data-based proposals");
});

test("Migrate: the cloud is chosen only after Migrate, the intake is checked, and a change of cloud clears the confirmation", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.deeper_done = true;
  const early = await call(`/api/analyses/${AN_ACME}/cloud`, { as: "eng_a", method: "PATCH", body: { cloud: "aws" } });
  assert.equal(early.status, 409, "cloud waits for Migrate");
  assert.equal((await call(`/api/analyses/${AN_ACME}/scope`, { as: "eng_a", method: "PATCH", body: { scope: "migrate" } })).status, 200);
  assert.equal((await call(`/api/analyses/${AN_ACME}/cloud`, { as: "aud_a", method: "PATCH", body: { cloud: "aws" } })).status, 403);
  assert.equal((await call(`/api/analyses/${AN_ACME}/cloud`, { as: "eng_a", method: "PATCH", body: { cloud: "mars" } })).status, 400);
  assert.equal((await call(`/api/analyses/${AN_ACME}/cloud`, { as: "eng_a", method: "PATCH", body: { cloud: "aws" } })).status, 200);
  assert.equal(state.analyses.find((a) => a.id === AN_ACME).cloud, "aws");

  const intake = {
    region: "us-east-1", network: "new", sign_in: "google",
    compliance: "HIPAA, customer agreement", expected_users: 400, residency: "United States",
  };
  const noIntake = await call(`/api/analyses/${AN_ACME}/intake/confirm`, { as: "eng_a", method: "POST" });
  assert.equal(noIntake.status, 409, "nothing to confirm yet");
  assert.equal((await call(`/api/analyses/${AN_ACME}/intake`, { as: "eng_a", method: "PUT", body: { ...intake, region: "" } })).status, 400);
  const withEmail = await call(`/api/analyses/${AN_ACME}/intake`, { as: "eng_a", method: "PUT", body: { ...intake, residency: "ask jo@example.test" } });
  assert.equal(withEmail.status, 400);
  assert.match(withEmail.body.error, /personal email/);
  assert.equal((await call(`/api/analyses/${AN_ACME}/intake`, { as: "eng_a", method: "PUT", body: { ...intake, expected_users: 0 } })).status, 400);
  assert.equal((await call(`/api/analyses/${AN_ACME}/intake`, { as: "eng_a", method: "PUT", body: intake })).status, 200);

  const confirm = await call(`/api/analyses/${AN_ACME}/intake/confirm`, { as: "eng_a", method: "POST" });
  assert.equal(confirm.status, 200);
  assert.equal(state.analyses.find((a) => a.id === AN_ACME).intake_confirmed_by_email, PEOPLE.eng_a.email);
  assert.ok(state.notifications.some((n) => n.kind === "intake_confirmed" && n.user_id !== PEOPLE.eng_a.id));

  await call(`/api/analyses/${AN_ACME}/cloud`, { as: "eng_a", method: "PATCH", body: { cloud: "azure" } });
  assert.equal(state.analyses.find((a) => a.id === AN_ACME).intake_confirmed_at, null, "a new cloud clears the confirmation");
});

test("Terraform: made only from a confirmed intake, as numbered drafts that are never overwritten, and seen only by infrastructure roles", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.scope = "migrate";
  analysis.deeper_done = true;
  analysis.cloud = "aws";
  analysis.intake = { region: "us-east-1", network: "new", sign_in: "google", compliance: "HIPAA", expected_users: 400, residency: "United States" };
  const notConfirmed = await call(`/api/analyses/${AN_ACME}/terraform`, { as: "eng_a", method: "POST" });
  assert.equal(notConfirmed.status, 409, "the intake must be confirmed first");
  analysis.intake_confirmed_at = NOW;
  analysis.intake_confirmed_by_email = PEOPLE.eng_a.email;

  assert.equal((await call(`/api/analyses/${AN_ACME}/terraform`, { as: "aud_a", method: "POST" })).status, 403);
  const first = await call(`/api/analyses/${AN_ACME}/terraform`, { as: "eng_a", method: "POST" });
  assert.equal(first.status, 201);
  assert.equal(first.body.version, 1);
  const body = state.terraform_versions.find((v) => v.version === 1).content;
  assert.match(body, /DRAFT generated by Cutover/);
  assert.match(body, /provider "aws"/);
  assert.match(body, /region: us-east-1/);
  assert.match(body, /expected users: 400/);

  analysis.cloud = "azure";
  analysis.intake = { ...analysis.intake, region: "eastus" };
  const second = await call(`/api/analyses/${AN_ACME}/terraform`, { as: "eng_a", method: "POST" });
  assert.equal(second.body.version, 2);
  assert.equal(state.terraform_versions.find((v) => v.version === 1).content, body, "the first draft is kept as it was");
  assert.match(state.terraform_versions.find((v) => v.version === 2).content, /provider "azurerm"/);

  const engineer = await call(`/api/analyses/${AN_ACME}/terraform`, { as: "eng_a" });
  assert.equal(engineer.status, 200);
  assert.deepEqual(engineer.body.versions.map((v) => v.version), [2, 1], "newest first");
  assert.equal((await call(`/api/analyses/${AN_ACME}/terraform`, { as: "aud_a" })).status, 403, "auditors do not see infrastructure");
  assert.equal((await call(`/api/analyses/${AN_ACME}/terraform`, { as: "sec_a" })).status, 403, "security does not see infrastructure");
  assert.ok(state.notifications.some((n) => n.kind === "terraform_drafted" && n.user_id !== PEOPLE.eng_a.id));
});

test("Terraform: a region the cloud does not accept is refused, so no draft is made from it", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.scope = "migrate";
  analysis.deeper_done = true;
  analysis.cloud = "google";
  analysis.intake = { region: 'us"central\n1', network: "existing", sign_in: "other", compliance: "None", expected_users: 10, residency: "EU" };
  analysis.intake_confirmed_at = NOW;
  const before = state.terraform_versions.length;
  const res = await call(`/api/analyses/${AN_ACME}/terraform`, { as: "eng_a", method: "POST" });
  assert.equal(res.status, 409);
  assert.equal(state.terraform_versions.length, before, "no draft was written");

  analysis.intake = { ...analysis.intake, region: "us-central1" };
  const ok = await call(`/api/analyses/${AN_ACME}/terraform`, { as: "eng_a", method: "POST" });
  assert.equal(ok.status, 201);
  const content = state.terraform_versions.at(-1).content;
  assert.match(content, /region = "us-central1"/);
  assert.doesNotMatch(content, /"central/);
});

test("intake: the region must be one the chosen cloud accepts", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.scope = "migrate";
  analysis.deeper_done = true;
  analysis.cloud = "azure";
  const intake = { region: "us-east-1", network: "new", sign_in: "google", compliance: "None", expected_users: 50, residency: "EU" };
  const wrongCloud = await call(`/api/analyses/${AN_ACME}/intake`, { as: "eng_a", method: "PUT", body: intake });
  assert.equal(wrongCloud.status, 400, "an AWS region is refused for Azure");
  assert.match(wrongCloud.body.error, /Azure/);
  const typed = await call(`/api/analyses/${AN_ACME}/intake`, { as: "eng_a", method: "PUT", body: { ...intake, region: "asda" } });
  assert.equal(typed.status, 400, "a made-up name is refused");
  const good = await call(`/api/analyses/${AN_ACME}/intake`, { as: "eng_a", method: "PUT", body: { ...intake, region: "westeurope" } });
  assert.equal(good.status, 200);
  assert.equal(state.analyses.find((a) => a.id === AN_ACME).intake.region, "westeurope");
});

test("Modernize estimate: only platform engineers set the user count, after the deeper assessment, and it is validated", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.deeper_done = false;
  const early = await call(`/api/analyses/${AN_ACME}/cost-users`, { as: "eng_a", method: "PUT", body: { users: 100 } });
  assert.equal(early.status, 409, "the deeper assessment must be complete first");
  analysis.deeper_done = true;
  assert.equal((await call(`/api/analyses/${AN_ACME}/cost-users`, { as: "aud_a", method: "PUT", body: { users: 100 } })).status, 403);
  for (const users of [0, 1.5, "many", 10000001]) {
    assert.equal((await call(`/api/analyses/${AN_ACME}/cost-users`, { as: "eng_a", method: "PUT", body: { users } })).status, 400, String(users));
  }
  const saved = await call(`/api/analyses/${AN_ACME}/cost-users`, { as: "eng_a", method: "PUT", body: { users: 10000 } });
  assert.equal(saved.status, 200);
  assert.equal(state.analyses.find((a) => a.id === AN_ACME).cost_users, 10000);
  assert.equal(state.analyses.find((a) => a.id === AN_ACME).cost_users_set_by_email, PEOPLE.eng_a.email);
  assert.ok(state.notifications.some((n) => n.kind === "cost_users_set" && n.user_id !== PEOPLE.eng_a.id));

  const view = await call(`/api/analyses/${AN_ACME}`, { as: "aud_a" });
  assert.equal(view.status, 200);
  assert.equal(view.body.cost_lines.length, 3);
  assert.equal(view.body.cost_lines[0], "Estimated Google Cloud cost for 10,000 users: about $10 to $76 a month for the application containers on Cloud Run (compute and requests only).");
  assert.equal(view.body.cost_lines[1], "Estimated Google Cloud cost for 10,000 users: about $247 to $312 a month for Cloud SQL for PostgreSQL (4 vCPU, 16 GiB memory, 200 GiB storage, about $236) plus the application on Cloud Run.");
});

test("Modernize estimate: the Worker's rates match the engine's cost_rates.json, so the two cannot drift", async () => {
  const { readFileSync } = await import("node:fs");
  const { COST_RATES } = await import("../src/cost-rates.mjs");
  const engine = JSON.parse(readFileSync(new URL("../../../engine/cost_rates.json", import.meta.url), "utf8"));
  assert.deepEqual(COST_RATES, engine);
});

test("Modernize estimate: with no database tables, the managed line says so and gives no database cost", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.findings = { findings: { "data.tables": { id: "data.tables", category: "data", value: { count: 0, names: [] } } } };
  analysis.deeper_done = true;
  analysis.cost_users = 100;
  const view = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(view.body.cost_lines[0].startsWith("Estimated Google Cloud cost for 100 users: about $0 a month"), true, "containers line shows $0");
  assert.equal(view.body.cost_lines[1], "No database cost is estimated, because no database tables were found in the SQL scripts.");
});

test("providers: each one has its own story, and every link in it is https", async () => {
  const { MODEL_PROVIDERS } = await import("../src/model-providers.mjs");
  for (const [id, p] of Object.entries(MODEL_PROVIDERS)) {
    assert.ok(["anthropic", "google", "openai"].includes(p.protocol), `${id} has a known protocol`);
    assert.ok(p.label && p.name, id);
    assert.ok(p.quest.chapters.length >= 3 && p.quest.title && p.quest.prologue && p.quest.epilogue, `${id} has a story`);
    for (const chapter of p.quest.chapters) {
      if (chapter.url) assert.match(chapter.url, /^https:\/\//, `${id}: ${chapter.url}`);
    }
    if (p.protocol === "openai" && !p.custom) assert.match(p.baseUrl, /^https:\/\//, id);
  }
  assert.equal(MODEL_PROVIDERS.custom.custom, true, "custom is the way to add a provider that is not listed");
});

test("providers: a listed provider that speaks the chat-completions shape is tested and saved with its own address and model", async () => {
  signedOff();
  const res = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "mistral", api_key: GOOD_OPENAI_KEY } });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { id: res.body.id, provider: "mistral", label: "Mistral AI", model: "mistral-large-latest", last4: "7777" });
  assert.ok(outbound.some((c) => c.url === "https://api.mistral.ai/v1/chat/completions"), "tested at its own address");
  assert.ok(!outbound.some((c) => c.url.includes(GOOD_OPENAI_KEY)), "the key is never in a URL");
  const again = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "mistral", api_key: GOOD_OPENAI_KEY } });
  assert.equal(again.status, 409, "a listed provider is saved once");
});

test("providers: a model the provider does not know is refused with the model named, and nothing is saved", async () => {
  signedOff();
  const res = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "mistral", api_key: GOOD_OPENAI_KEY, model: "no-such-model" } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /did not find the model "no-such-model"/);
  assert.equal(state.model_keys.length, 0);
});

test("providers: a provider with no default model needs a model name, and a bad name is refused", async () => {
  signedOff();
  const none = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "groq", api_key: GOOD_OPENAI_KEY } });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /Type the model name/);
  const bad = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "groq", api_key: GOOD_OPENAI_KEY, model: "bad name!" } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /letters, numbers/);
});

test("custom provider: an https address with a real host is needed, and the name and model are required", async () => {
  signedOff();
  const base = { provider: "custom", api_key: GOOD_OPENAI_KEY, label: "Team model", model: "team-model-1" };
  const refused = [
    { base_url: "http://llm.example.com/v1" },
    { base_url: "https://localhost/v1" },
    { base_url: "https://10.0.0.5/v1" },
    { base_url: "https://user:pw@llm.example.com/v1" },
    { base_url: "not a web address" },
  ];
  for (const extra of refused) {
    const res = await call(KEYS(), { method: "POST", as: "admin_a", body: { ...base, ...extra } });
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.match(res.body.error, /https:\/\//);
  }
  const noName = await call(KEYS(), { method: "POST", as: "admin_a", body: { ...base, label: "", base_url: "https://llm.example.com/v1" } });
  assert.equal(noName.status, 400);
  assert.equal(state.model_keys.length, 0);
});

test("custom provider: any number can be added, each with its own name, address and model, and the list shows the host", async () => {
  signedOff();
  // A new provider name, a trailing slash and a different model are all fine.
  const first = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "custom", api_key: GOOD_OPENAI_KEY, label: "Team model", base_url: "https://llm.example.com/v1/", model: "team-model-1" } });
  assert.equal(first.status, 201);
  const second = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "custom", api_key: GOOD_OPENAI_KEY, label: "Second model", base_url: "https://other.example.org/api", model: "team-model-2" } });
  assert.equal(second.status, 201, "a second custom provider is allowed");
  const list = await call(KEYS(), { as: "eng_a" });
  const names = list.body.keys.map((k) => [k.label, k.host, k.model]).sort();
  assert.deepEqual(names, [["Second model", "other.example.org", "team-model-2"], ["Team model", "llm.example.com", "team-model-1"]]);
  assert.ok(list.body.providers.some((p) => p.id === "custom" && p.custom === true), "the list offers the custom option");
  assert.ok(!JSON.stringify(list.body).includes(GOOD_OPENAI_KEY), "the key is never listed");
});

test("providers: the runner gets the protocol, model and address, and never the key until it trades its token", async () => {
  signedOff();
  const made = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "custom", api_key: GOOD_OPENAI_KEY, label: "Team model", base_url: "https://llm.example.com/v1", model: "team-model-1" } });
  assert.equal(made.status, 201);
  const keyId = made.body.id;
  const started = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, model_key_id: keyId } });
  const token = github.dispatches.at(-1).inputs.model_token;
  const path = `/api/runner/${started.body.id}/model-key`;
  const released = await call(path, { method: "POST", secret: env.RUNNER_SECRET, body: { token } });
  assert.equal(released.status, 200);
  assert.deepEqual(released.body, { provider: "openai", model: "team-model-1", base_url: "https://llm.example.com/v1", token_field: "max_tokens", api_key: GOOD_OPENAI_KEY });
});

test("providers: a Google model name cannot carry a slash, which would change the address", async () => {
  signedOff();
  const res = await call(KEYS(), { method: "POST", as: "admin_a", body: { provider: "google", api_key: GOOD_GOOGLE_KEY, model: "models/evil:x" } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Google model names/);
});

// ---- Database structure from access_metadata.py: names, types and counts only ----

const STRUCTURE = (overrides = {}) => ({
  format: "cutover-db-metadata/1",
  database: "ManageIt.mdb",
  engine: "Microsoft Access",
  tables: [{ name: "Login", row_count: 12, columns: [{ name: "LoginID", type: "Text", nullable: true }] }],
  ...overrides,
});

test("the structure file validator keeps names, types and counts, and refuses anything else", () => {
  const ok = validateDbMetadata(STRUCTURE());
  assert.equal(ok.error, undefined);
  assert.equal(ok.tables, 1);
  assert.equal(ok.fields, 1);
  assert.equal(validateDbMetadata(STRUCTURE({ tables: [{ name: "T", row_count: null, columns: [] }] })).error, undefined, "a null row count is fine");
  assert.ok(validateDbMetadata(STRUCTURE({ extra: "x" })).error, "an unknown top-level key is refused");
  assert.ok(validateDbMetadata(STRUCTURE({ format: "other/1" })).error, "another format is refused");
  assert.ok(validateDbMetadata(STRUCTURE({ tables: [{ name: "T", columns: [], rows: [["secret"]] }] })).error, "row values are refused");
  assert.ok(validateDbMetadata(STRUCTURE({ tables: [{ name: "T", columns: [{ name: "A", type: "Text", nullable: true, sample: "x" }] }] })).error, "a sample value in a field is refused");
  assert.ok(validateDbMetadata(STRUCTURE({ tables: [{ name: "T", row_count: -1, columns: [] }] })).error, "a negative count is refused");
  assert.ok(validateDbMetadata(STRUCTURE({ tables: [{ name: "T", columns: [{ name: "A", type: "Text", nullable: "yes" }] }] })).error, "nullable must be true or false");
  assert.ok(validateDbMetadata(STRUCTURE({ tables: [{ name: "", columns: [] }] })).error, "a table needs a name");
});

test("a platform engineer saves a structure; members see the counts; the runner reads the file", async () => {
  const saved = await call(`/api/analyses/${AN_ACME}/db-metadata`, { as: "eng_a", method: "PUT", body: STRUCTURE() });
  assert.equal(saved.status, 201);
  assert.deepEqual(saved.body, { saved: true, tables: 1, fields: 1 });
  assert.equal(state.analysis_db_metadata.length, 1);
  assert.equal(state.analysis_db_metadata[0].uploaded_by, PEOPLE.eng_a.email);

  const engineer = await call(`/api/analyses/${AN_ACME}/db-metadata`, { as: "eng_a" });
  assert.equal(engineer.body.present, true);
  assert.equal(engineer.body.tables, 1);
  assert.equal(engineer.body.can_change, true);

  const auditor = await call(`/api/analyses/${AN_ACME}/db-metadata`, { as: "aud_a" });
  assert.equal(auditor.status, 200, "members can see the counts");
  assert.equal(auditor.body.can_change, false);
  assert.equal(auditor.body.tables, 1);

  const read = await call(`/api/runner/${AN_ACME}/db-metadata`, { secret: env.RUNNER_SECRET });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, STRUCTURE(), "the runner receives the file as it was saved");
});

test("only platform engineers can save or remove a structure, and a second save replaces the first", async () => {
  const notEngineer = await call(`/api/analyses/${AN_ACME}/db-metadata`, { as: "aud_a", method: "PUT", body: STRUCTURE() });
  assert.equal(notEngineer.status, 403);
  const stranger = await call(`/api/analyses/${AN_ACME}/db-metadata`, { as: "stranger", method: "PUT", body: STRUCTURE() });
  assert.equal(stranger.status, 404, "someone outside the workspace is told nothing exists");

  await call(`/api/analyses/${AN_ACME}/db-metadata`, { as: "eng_a", method: "PUT", body: STRUCTURE() });
  await call(`/api/analyses/${AN_ACME}/db-metadata`, { as: "eng_a", method: "PUT", body: STRUCTURE({ tables: [] }) });
  assert.equal(state.analysis_db_metadata.length, 1, "the second file replaces the first");
  assert.equal(state.analysis_db_metadata[0].table_count, 0);

  const notRemover = await call(`/api/analyses/${AN_ACME}/db-metadata`, { as: "aud_a", method: "DELETE" });
  assert.equal(notRemover.status, 403);
  const removed = await call(`/api/analyses/${AN_ACME}/db-metadata`, { as: "eng_a", method: "DELETE" });
  assert.deepEqual(removed.body, { removed: true });
  const after = await call(`/api/runner/${AN_ACME}/db-metadata`, { secret: env.RUNNER_SECRET });
  assert.equal(after.status, 404, "once removed, the run finds no structure");
});

test("a structure with row values is refused and nothing is saved", async () => {
  const res = await call(`/api/analyses/${AN_ACME}/db-metadata`, {
    as: "eng_a", method: "PUT", body: STRUCTURE({ tables: [{ name: "Login", columns: [], rows: [["alice@example.test"]] }] }),
  });
  assert.equal(res.status, 400);
  assert.equal(state.analysis_db_metadata.length, 0);
});

test("a structure cannot be changed while its analysis is running, and the runner needs the shared secret", async () => {
  runningAnalysis();
  const busy = await call(`/api/analyses/${AN_RUNNING}/db-metadata`, { as: "eng_a", method: "PUT", body: STRUCTURE() });
  assert.equal(busy.status, 409);
  const wrong = await call(`/api/runner/${AN_RUNNING}/db-metadata`, { secret: "wrong" });
  assert.equal(wrong.status, 401);
});

// ---- Running a finished analysis again ----

test("a platform engineer runs a finished analysis again; the earlier results are cleared and the structure is kept", async () => {
  await call(`/api/analyses/${AN_ACME}/db-metadata`, { as: "eng_a", method: "PUT", body: STRUCTURE() });
  const before = github.dispatches.length;
  const res = await call(`/api/analyses/${AN_ACME}/rerun`, { as: "eng_a", method: "POST" });
  assert.equal(res.status, 202);
  assert.deepEqual(res.body, { id: AN_ACME, status: "queued" });
  const row = state.analyses.find((a) => a.id === AN_ACME);
  assert.equal(row.status, "queued");
  assert.equal(row.findings, null, "the earlier findings are cleared");
  assert.equal(row.deeper_done, false);
  assert.equal(github.dispatches.length, before + 1, "the runner is started again");
  assert.equal(github.dispatches.at(-1).inputs.analysis_id, AN_ACME);
  assert.equal(github.dispatches.at(-1).inputs.repo, row.repo);
  assert.equal(state.analysis_db_metadata.filter((m) => m.analysis_id === AN_ACME).length, 1, "the saved structure is kept");
  assert.equal(state.analysis_screens.filter((s) => s.analysis_id === AN_ACME).length, 0);
});

test("only platform engineers can run again, and a running analysis is not started a second time", async () => {
  const auditor = await call(`/api/analyses/${AN_ACME}/rerun`, { as: "aud_a", method: "POST" });
  assert.equal(auditor.status, 403);
  runningAnalysis();
  const busy = await call(`/api/analyses/${AN_RUNNING}/rerun`, { as: "eng_a", method: "POST" });
  assert.equal(busy.status, 409);
});

test("the target language: chosen by an engineer after the approach, fitted to it, approved by the named owner or a CIO/CTO, and the approval is kept when the language changes", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.deeper_done = true;
  const owner = PEOPLE.stranger.email;
  const early = await call(`/api/analyses/${AN_ACME}/target`, { as: "eng_a", method: "PUT", body: { language: "ts-react", owner_email: owner } });
  assert.equal(early.status, 409, "the target waits for Modernize");
  assert.equal((await call(`/api/analyses/${AN_ACME}/scope`, { as: "eng_a", method: "PATCH", body: { scope: "modernize" } })).status, 200);
  const noApproach = await call(`/api/analyses/${AN_ACME}/target`, { as: "eng_a", method: "PUT", body: { language: "ts-react", owner_email: owner } });
  assert.equal(noApproach.status, 409, "the target waits for the approach");
  await call(`/api/analyses/${AN_ACME}/template`, { as: "eng_a", method: "PUT", body: { template: "web-modern" } });

  assert.equal((await call(`/api/analyses/${AN_ACME}/target`, { as: "aud_a", method: "PUT", body: { language: "ts-react", owner_email: owner } })).status, 403);
  assert.equal((await call(`/api/analyses/${AN_ACME}/target`, { as: "eng_a", method: "PUT", body: { language: "cobol", owner_email: owner } })).status, 400);
  assert.equal((await call(`/api/analyses/${AN_ACME}/target`, { as: "eng_a", method: "PUT", body: { language: "ts-react", owner_email: "not-an-email" } })).status, 400);
  assert.equal((await call(`/api/analyses/${AN_ACME}/target`, { as: "eng_a", method: "PUT", body: { language: "ts-react", owner_email: owner } })).status, 200);
  assert.equal(state.analyses.find((a) => a.id === AN_ACME).target_owner_email, owner);

  const offered = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(offered.body.target_options.length, 5, "the catalogue is returned for the portal");
  assert.equal(offered.body.target_approval, null);

  assert.equal((await call(`/api/analyses/${AN_ACME}/target/approve`, { as: "eng_a", method: "POST" })).status, 403, "an engineer who is not the owner cannot approve");
  const ownerSees = await call(`/api/analyses/${AN_ACME}`, { as: "stranger" });
  assert.equal(ownerSees.status, 404, "the owner must be a member of the workspace to act");
  assert.equal((await call(`/api/analyses/${AN_ACME}/target/approve`, { as: "cio_a", method: "POST" })).status, 200, "a CIO or CTO can approve");
  const approved = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(approved.body.target_approval.by, PEOPLE.cio_a.email);

  await call(`/api/analyses/${AN_ACME}/target`, { as: "eng_a", method: "PUT", body: { language: "py-fastapi", owner_email: owner } });
  const changed = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(changed.body.target_approval, null, "a new language needs its own approval");
  assert.equal(state.analysis_target_approvals.length, 1, "the earlier approval stays on record");

  await call(`/api/analyses/${AN_ACME}/target`, { as: "eng_a", method: "PUT", body: { language: "ts-react", owner_email: owner } });
  assert.equal((await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" })).body.target_approval.by, PEOPLE.cio_a.email, "returning to the approved language keeps its approval");
});

test("the target language: lift-contain offers only keeping the current language", async () => {
  const analysis = state.analyses.find((a) => a.id === AN_ACME);
  analysis.deeper_done = true;
  analysis.scope = "modernize";
  analysis.modern_template = "lift-contain";
  const wrong = await call(`/api/analyses/${AN_ACME}/target`, { as: "eng_a", method: "PUT", body: { language: "java-spring", owner_email: PEOPLE.stranger.email } });
  assert.equal(wrong.status, 400);
  const right = await call(`/api/analyses/${AN_ACME}/target`, { as: "eng_a", method: "PUT", body: { language: "current", owner_email: PEOPLE.stranger.email } });
  assert.equal(right.status, 200);
});

// ---- One assessment at a time in a workspace, and the action log ----

test("a second run in a busy workspace is refused, and the refusal is logged", async () => {
  const first = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME } });
  assert.equal(first.status, 202);
  const second = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, repo: "acme/other" } });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /Another assessment is running in this workspace/);
  assert.equal(github.dispatches.length, 1, "the refused run is not dispatched");
  assert.ok(state.assessment_log.some((l) => l.action === "lock_refused" && l.workspace_id === W_ACME));
  assert.ok(state.assessment_log.some((l) => l.action === "start" && l.analysis_id === first.body.id && l.actor_email === PEOPLE.eng_a.email));
});

test("a rerun is refused while another assessment in the workspace is running", async () => {
  const first = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME } });
  assert.equal(first.status, 202);
  const rerun = await call(`/api/analyses/${AN_ACME}/rerun`, { as: "eng_a", method: "POST" });
  assert.equal(rerun.status, 409);
  assert.match(rerun.body.error, /Another assessment is running/);
});

test("another workspace is not held up by a run in this one", async () => {
  const first = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME } });
  assert.equal(first.status, 202);
  const other = await call("/api/analyses", { as: "eng_b", method: "POST", body: { ...START, workspace_id: W_BETA } });
  assert.equal(other.status, 202);
});

test("finishing a run frees the workspace for the next one", async () => {
  const first = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME } });
  const done = await call(`/api/runner/${first.body.id}/result`, { method: "POST", secret: env.RUNNER_SECRET, body: { status: "complete", findings: {}, commit_sha: "abc123" } });
  assert.equal(done.status, 200);
  const next = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME, repo: "acme/other" } });
  assert.equal(next.status, 202);
  assert.ok(state.assessment_log.some((l) => l.action === "finish" && l.analysis_id === first.body.id && l.commit_sha === "abc123"));
});

test("a run that never reports is stopped after three hours, so it cannot hold the workspace", async () => {
  state.analyses.push({ id: uid(950), workspace_id: W_ACME, owner_id: PEOPLE.eng_a.id, repo: "acme/stuck", app_name: "Stuck", status: "running", created_at: "2020-01-01T00:00:00.000Z", expires_at: FAR_FUTURE, findings: null, error: null, commit_sha: null, finished_at: null, file_bytes: 0 });
  const res = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME } });
  assert.equal(res.status, 202);
  assert.equal(state.analyses.find((a) => a.id === uid(950)).status, "failed");
  assert.ok(state.assessment_log.some((l) => l.action === "stale_stop" && l.analysis_id === uid(950)));
});

test("deleting an analysis is logged with who did it", async () => {
  const res = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a", method: "DELETE" });
  assert.equal(res.status, 200);
  assert.ok(state.assessment_log.some((l) => l.action === "delete" && l.analysis_id === AN_ACME && l.actor_email === PEOPLE.eng_a.email));
});

test("the action log is kept as a separate, append-only table in the database", () => {
  const sql = readFileSync(new URL("../../supabase/add-action-log-and-lock.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("revoke update, delete, truncate, references, trigger on public.assessment_log from service_role;"));
  assert.ok(sql.includes("create unique index if not exists analyses_one_running_per_workspace"));
});

test("an assessment shows as out of date once the branch has a newer commit, and GitHub is asked at most every six hours", async () => {
  const fresh = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(fresh.body.out_of_date, false, "the branch is still at the commit the results read");
  github.head = "def456";
  state.analyses.find((a) => a.id === AN_ACME).head_checked_at = null;
  const moved = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(moved.body.out_of_date, true);
  assert.equal(moved.body.head_sha, "def456");
  const asked = outbound.filter((o) => o.url.includes("/commits")).length;
  await call(`/api/analyses/${AN_ACME}`, { as: "eng_a" });
  assert.equal(outbound.filter((o) => o.url.includes("/commits")).length, asked, "a second look within six hours does not ask GitHub again");
  github.head = undefined;
});

test("a start is refused, and nothing is created, when its log entry cannot be written", async () => {
  failActivityLog = true;
  const res = await call("/api/analyses", { as: "eng_a", method: "POST", body: { ...START, workspace_id: W_ACME } });
  assert.equal(res.status, 503);
  assert.equal(state.analyses.filter((a) => a.workspace_id === W_ACME && a.status === "queued").length, 0);
  assert.equal(github.dispatches.length, 0);
});

test("a delete is refused, and the analysis is kept, when its log entry cannot be written", async () => {
  failActivityLog = true;
  const res = await call(`/api/analyses/${AN_ACME}`, { as: "eng_a", method: "DELETE" });
  assert.equal(res.status, 503);
  assert.ok(state.analyses.some((a) => a.id === AN_ACME));
});
