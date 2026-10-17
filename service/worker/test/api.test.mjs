// Tests for the Worker's request handling. Run with:
//   node --test service/worker/test/api.test.mjs
// These tests mock Supabase and GitHub, so no real account or secret is needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.mjs";

const env = {
  SUPABASE_URL: "https://example.supabase.test",
  SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-test",
  GITHUB_DISPATCH_TOKEN: "gh-test",
  RUNNER_SECRET: "runner-secret-test",
  RUNNER_REPO: "owner/cutover",
};
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.test" };
const OTHER = { id: "33333333-3333-4333-8333-333333333333", email: "other@example.test" };
const ANALYSIS_ID = "22222222-2222-4222-8222-222222222222";
const COMMENT_ID = "44444444-4444-4444-8444-444444444444";
const ACTION_ID = "55555555-5555-4555-8555-555555555555";

// Access list replies. A member is someone with a row in the members table.
const AS_DEVELOPER = ["/rest/v1/members?user_id=", reply(200, [{ user_id: USER.id, email: USER.email, role: "developer" }])];
const AS_ADMIN = ["/rest/v1/members?user_id=", reply(200, [{ user_id: USER.id, email: USER.email, role: "workspace_admin" }])];
const AS_COMPLIANCE = ["/rest/v1/members?user_id=", reply(200, [{ user_id: USER.id, email: USER.email, role: "compliance_reviewer" }])];
const NOT_MEMBER = ["/rest/v1/members?user_id=", reply(200, [])];
const NO_INVITE = ["/rest/v1/invitations?email=", reply(200, [])];

// An analysis started by someone else, so the signed-in member is not its owner.
const OTHERS_ANALYSIS = { id: ANALYSIS_ID, owner_id: OTHER.id, repo: "acme/app", ref: null, status: "complete", commit_sha: "abc", findings: { ok: true }, error: null, created_at: "2026-10-17T00:00:00Z", finished_at: null, expires_at: "2026-11-16T00:00:00Z" };
const MINE_ANALYSIS = { ...OTHERS_ANALYSIS, owner_id: USER.id };

const realFetch = globalThis.fetch;
let calls;

function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [pattern, reply] of routes) {
      if (String(url).includes(pattern)) return reply(init);
    }
    return new Response("unexpected", { status: 599 });
  };
}

function reply(status, body) {
  return () => new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function request(path, { method = "GET", token, body, secret } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (secret) headers["x-runner-secret"] = secret;
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("starting an analysis requires a signed-in user", async () => {
  mockFetch([]);
  const res = await worker.fetch(request("/api/analyses", { method: "POST", body: { repo: "a/b" } }), env);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0, "no outbound calls for anonymous requests");
});

test("an invalid token is rejected", async () => {
  mockFetch([["/auth/v1/user", reply(401, { message: "bad token" })]]);
  const res = await worker.fetch(request("/api/analyses", { method: "POST", token: "bad", body: { repo: "a/b" } }), env);
  assert.equal(res.status, 401);
});

test("signed-in users who were not invited are refused", async () => {
  mockFetch([["/auth/v1/user", reply(200, USER)], NOT_MEMBER, NO_INVITE]);
  const res = await worker.fetch(request("/api/analyses", { token: "ok" }), env);
  assert.equal(res.status, 403);
  assert.equal(calls.filter((c) => c.url.includes("/rest/v1/analyses")).length, 0);
});

test("an uninvited user cannot start an analysis", async () => {
  mockFetch([["/auth/v1/user", reply(200, USER)], NOT_MEMBER, NO_INVITE]);
  const res = await worker.fetch(request("/api/analyses", { method: "POST", token: "ok", body: { repo: "acme/app" } }), env);
  assert.equal(res.status, 403);
  assert.equal(calls.filter((c) => c.url.includes("api.github.com")).length, 0, "runner not started");
});

test("an invitation becomes membership on first sign-in", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    NOT_MEMBER,
    ["/rest/v1/invitations?email=", reply(200, [{ email: USER.email, role: "developer" }])],
    ["/rest/v1/members", reply(201, [{ user_id: USER.id, email: USER.email, role: "developer" }])],
    ["/rest/v1/analyses", reply(200, [])],
  ]);
  const res = await worker.fetch(request("/api/analyses", { token: "ok" }), env);
  assert.equal(res.status, 200);
  const created = calls.find((c) => c.url.endsWith("/rest/v1/members") && c.init.method === "POST");
  assert.ok(created, "membership row created");
  assert.equal(JSON.parse(created.init.body).role, "developer");
  assert.equal(JSON.parse(created.init.body).user_id, USER.id);
  const removed = calls.find((c) => c.url.includes("/rest/v1/invitations") && c.init.method === "DELETE");
  assert.ok(removed, "invitation used up");
});

test("every member sees every analysis in the workspace, without owner ids", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/analyses?select=", reply(200, [{ ...OTHERS_ANALYSIS, owner_id: OTHER.id }])],
  ]);
  const res = await worker.fetch(request("/api/analyses", { token: "ok" }), env);
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.equal(rows.length, 1, "someone else's analysis is included");
  assert.equal(rows[0].owner_id, undefined, "owner id is not exposed");
  assert.equal(rows[0].is_mine, false);
  const list = calls.find((c) => c.url.includes("/rest/v1/analyses?select="));
  assert.equal(list.init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY, "read uses the service role after the member check");
});

test("repo names are validated before anything is created", async () => {
  mockFetch([["/auth/v1/user", reply(200, USER)], AS_DEVELOPER]);
  const res = await worker.fetch(request("/api/analyses", { method: "POST", token: "ok", body: { repo: "../etc" } }), env);
  assert.equal(res.status, 400);
  assert.equal(calls.filter((c) => c.url.includes("/rest/v1/analyses")).length, 0);
});

test("a valid request creates a row as the user and starts the runner", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/analyses", reply(201, [{ id: ANALYSIS_ID, status: "queued" }])],
    ["api.github.com", reply(204)],
  ]);
  const res = await worker.fetch(request("/api/analyses", { method: "POST", token: "ok", body: { repo: "acme/app", ref: "main" } }), env);
  assert.equal(res.status, 202);
  const insert = calls.find((c) => c.url.includes("/rest/v1/analyses"));
  assert.equal(insert.init.headers.authorization, "Bearer ok", "insert uses the user's token so row-level security applies");
  assert.equal(JSON.parse(insert.init.body).owner_id, USER.id);
  const dispatch = calls.find((c) => c.url.includes("api.github.com"));
  assert.match(dispatch.url, /repos\/owner\/cutover\/actions\/workflows\/analyze\.yml\/dispatches$/);
  assert.equal(JSON.parse(dispatch.init.body).inputs.analysis_id, ANALYSIS_ID);
});

test("compliance reviewers cannot start analyses", async () => {
  mockFetch([["/auth/v1/user", reply(200, USER)], AS_COMPLIANCE]);
  const res = await worker.fetch(request("/api/analyses", { method: "POST", token: "ok", body: { repo: "acme/app" } }), env);
  assert.equal(res.status, 403);
  assert.equal(calls.filter((c) => c.url.includes("api.github.com")).length, 0);
});

test("a failed runner start marks the analysis failed instead of leaving it queued", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/analyses?id=", reply(204)],
    ["/rest/v1/analyses", reply(201, [{ id: ANALYSIS_ID, status: "queued" }])],
    ["api.github.com", reply(500)],
  ]);
  const res = await worker.fetch(request("/api/analyses", { method: "POST", token: "ok", body: { repo: "acme/app" } }), env);
  assert.equal(res.status, 502);
  const patch = calls.find((c) => c.init.method === "PATCH");
  assert.equal(JSON.parse(patch.init.body).status, "failed");
});

test("runner callbacks need the shared secret", async () => {
  mockFetch([]);
  const res = await worker.fetch(request(`/api/runner/${ANALYSIS_ID}/result`, {
    method: "POST", secret: "wrong", body: { status: "complete", findings: {} },
  }), env);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("runner callbacks save findings with the service key", async () => {
  mockFetch([["/rest/v1/analyses", reply(204)]]);
  const res = await worker.fetch(request(`/api/runner/${ANALYSIS_ID}/result`, {
    method: "POST", secret: env.RUNNER_SECRET, body: { status: "complete", commit_sha: "abc123", findings: { ok: true } },
  }), env);
  assert.equal(res.status, 200);
  const patch = calls[0];
  assert.equal(patch.init.headers.authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  assert.equal(JSON.parse(patch.init.body).status, "complete");
});

test("runner callbacks reject unknown statuses", async () => {
  mockFetch([]);
  const res = await worker.fetch(request(`/api/runner/${ANALYSIS_ID}/result`, {
    method: "POST", secret: env.RUNNER_SECRET, body: { status: "running" },
  }), env);
  assert.equal(res.status, 400);
});

test("a member can open an analysis started by someone else, with its comments and action items", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/analyses?id=", reply(200, [OTHERS_ANALYSIS])],
    ["/rest/v1/analysis_comments?", reply(200, [{ id: COMMENT_ID, author_email: OTHER.email, body: "Check the HL7 export", created_at: "2026-10-17T01:00:00Z" }])],
    ["/rest/v1/action_items?", reply(200, [{ id: ACTION_ID, title: "Confirm scope", status: "open" }])],
  ]);
  const res = await worker.fetch(request(`/api/analyses/${ANALYSIS_ID}`, { token: "ok" }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.repo, "acme/app");
  assert.equal(body.comments.length, 1);
  assert.equal(body.action_items.length, 1);
  assert.equal(body.can_delete, false, "a developer cannot delete someone else's analysis");
  assert.equal(body.owner_id, undefined);
});

test("a missing analysis is not found", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/analyses?id=", reply(200, [])],
  ]);
  const res = await worker.fetch(request(`/api/analyses/${ANALYSIS_ID}`, { token: "ok" }), env);
  assert.equal(res.status, 404);
});

test("only the starter or an admin can delete an analysis", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/analyses?id=", reply(200, [OTHERS_ANALYSIS])],
  ]);
  const res = await worker.fetch(request(`/api/analyses/${ANALYSIS_ID}`, { method: "DELETE", token: "ok" }), env);
  assert.equal(res.status, 403);
  assert.equal(calls.filter((c) => c.init.method === "DELETE").length, 0);
});

test("the person who started an analysis can delete it", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/analyses?id=", reply(200, [MINE_ANALYSIS])],
    ["/rest/v1/analyses?id=eq", reply(204)],
  ]);
  const res = await worker.fetch(request(`/api/analyses/${ANALYSIS_ID}`, { method: "DELETE", token: "ok" }), env);
  assert.equal(res.status, 200);
});

test("an admin can delete any analysis", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_ADMIN,
    ["/rest/v1/analyses?id=", reply(200, [OTHERS_ANALYSIS])],
    ["/rest/v1/analyses?id=eq", reply(204)],
  ]);
  const res = await worker.fetch(request(`/api/analyses/${ANALYSIS_ID}`, { method: "DELETE", token: "ok" }), env);
  assert.equal(res.status, 200);
});

test("members can comment, and an empty comment is refused", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/analyses?id=", reply(200, [OTHERS_ANALYSIS])],
    ["/rest/v1/analysis_comments", reply(201, [{ id: COMMENT_ID }])],
  ]);
  const empty = await worker.fetch(request(`/api/analyses/${ANALYSIS_ID}/comments`, { method: "POST", token: "ok", body: { body: "   " } }), env);
  assert.equal(empty.status, 400);
  const ok = await worker.fetch(request(`/api/analyses/${ANALYSIS_ID}/comments`, { method: "POST", token: "ok", body: { body: "Please confirm the scope." } }), env);
  assert.equal(ok.status, 201);
  const save = calls.find((c) => c.url.includes("/rest/v1/analysis_comments") && c.init.method === "POST");
  assert.equal(JSON.parse(save.init.body).author_email, USER.email);
  assert.equal(JSON.parse(save.init.body).body, "Please confirm the scope.");
});

test("you can delete your own comment, but not someone else's", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/analysis_comments?id=", reply(200, [{ id: COMMENT_ID, author_id: OTHER.id }])],
  ]);
  const res = await worker.fetch(request(`/api/comments/${COMMENT_ID}`, { method: "DELETE", token: "ok" }), env);
  assert.equal(res.status, 403);
});

test("members can add an action item, and compliance reviewers cannot", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/analyses?id=", reply(200, [OTHERS_ANALYSIS])],
    ["/rest/v1/action_items", reply(201, [{ id: ACTION_ID }])],
  ]);
  const ok = await worker.fetch(request(`/api/analyses/${ANALYSIS_ID}/actions`, { method: "POST", token: "ok", body: { title: "Confirm scope with the owner" } }), env);
  assert.equal(ok.status, 201);

  mockFetch([["/auth/v1/user", reply(200, USER)], AS_COMPLIANCE]);
  const refused = await worker.fetch(request(`/api/analyses/${ANALYSIS_ID}/actions`, { method: "POST", token: "ok", body: { title: "Nope" } }), env);
  assert.equal(refused.status, 403);
});

test("an action item can be marked done and reopened, with who did it recorded", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_DEVELOPER,
    ["/rest/v1/action_items?id=", reply(204)],
  ]);
  const res = await worker.fetch(request(`/api/actions/${ACTION_ID}`, { method: "PATCH", token: "ok", body: { status: "done" } }), env);
  assert.equal(res.status, 200);
  const patch = calls.find((c) => c.init.method === "PATCH");
  assert.equal(JSON.parse(patch.init.body).status, "done");
  assert.equal(JSON.parse(patch.init.body).done_by_email, USER.email);

  const bad = await worker.fetch(request(`/api/actions/${ACTION_ID}`, { method: "PATCH", token: "ok", body: { status: "archived" } }), env);
  assert.equal(bad.status, 400);
});

test("unknown routes return 404", async () => {
  mockFetch([]);
  const res = await worker.fetch(request("/api/nope"), env);
  assert.equal(res.status, 404);
});

test("retention purge deletes expired rows with the service key", async () => {
  mockFetch([["/rest/v1/analyses", reply(204)]]);
  const waits = [];
  await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "DELETE");
  assert.match(calls[0].url, /expires_at=lt\./);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
});

test("only workspace admins can see the invitation list", async () => {
  mockFetch([["/auth/v1/user", reply(200, USER)], AS_DEVELOPER]);
  const res = await worker.fetch(request("/api/admin/invitations", { token: "ok" }), env);
  assert.equal(res.status, 403);
});

test("a workspace admin can invite someone with a role", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_ADMIN,
    ["/rest/v1/invitations", reply(201)],
  ]);
  const res = await worker.fetch(request("/api/admin/invitations", {
    method: "POST", token: "ok", body: { email: "Nurse.Lead@Example.org", role: "compliance_reviewer" },
  }), env);
  assert.equal(res.status, 201);
  const save = calls.find((c) => c.url.includes("/rest/v1/invitations"));
  assert.equal(JSON.parse(save.init.body).email, "nurse.lead@example.org", "emails are stored in lower case");
  assert.equal(JSON.parse(save.init.body).role, "compliance_reviewer");
  assert.equal(JSON.parse(save.init.body).invited_by, USER.id);
});

test("invitations need a valid email and a known role", async () => {
  mockFetch([["/auth/v1/user", reply(200, USER)], AS_ADMIN]);
  const badEmail = await worker.fetch(request("/api/admin/invitations", {
    method: "POST", token: "ok", body: { email: "not-an-email", role: "developer" },
  }), env);
  assert.equal(badEmail.status, 400);
  const badRole = await worker.fetch(request("/api/admin/invitations", {
    method: "POST", token: "ok", body: { email: "a@example.org", role: "superuser" },
  }), env);
  assert.equal(badRole.status, 400);
  assert.equal(calls.filter((c) => c.url.includes("/rest/v1/invitations")).length, 0, "nothing saved");
});

test("a workspace admin can remove a pending invitation", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    AS_ADMIN,
    ["/rest/v1/invitations", reply(204)],
  ]);
  const res = await worker.fetch(request(`/api/admin/invitations/${encodeURIComponent("Nurse.Lead@Example.org")}`, {
    method: "DELETE", token: "ok",
  }), env);
  assert.equal(res.status, 200);
  const del = calls.find((c) => c.url.includes("/rest/v1/invitations"));
  assert.match(del.url, /email=eq\.nurse\.lead%40example\.org/);
});

test("the app's local address gets cross-origin permission", async () => {
  mockFetch([]);
  const res = await worker.fetch(new Request("https://api.test/api/analyses", {
    method: "OPTIONS", headers: { origin: "http://localhost:8000" },
  }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:8000");
  assert.match(res.headers.get("access-control-allow-headers"), /authorization/);
});

test("other websites get no cross-origin permission", async () => {
  mockFetch([]);
  const res = await worker.fetch(new Request("https://api.test/api/analyses", {
    method: "OPTIONS", headers: { origin: "https://evil.example" },
  }), env);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("responses to the app's address carry the cross-origin header", async () => {
  mockFetch([["/auth/v1/user", reply(401, { message: "bad" })]]);
  const res = await worker.fetch(new Request("https://api.test/api/analyses", {
    method: "POST", headers: { origin: "http://localhost:8000", authorization: "Bearer x", "content-type": "application/json" }, body: JSON.stringify({ repo: "a/b" }),
  }), env);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:8000");
});
