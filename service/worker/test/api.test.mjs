// Tests for the Worker's request handling. Run with:
//   node --test service/worker/test/
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
const USER = { id: "11111111-1111-4111-8111-111111111111" };
const ANALYSIS_ID = "22222222-2222-4222-8222-222222222222";

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

test("repo names are validated before anything is created", async () => {
  mockFetch([["/auth/v1/user", reply(200, USER)]]);
  const res = await worker.fetch(request("/api/analyses", { method: "POST", token: "ok", body: { repo: "../etc" } }), env);
  assert.equal(res.status, 400);
  assert.equal(calls.filter((c) => c.url.includes("/rest/v1/")).length, 0);
});

test("a valid request creates a row as the user and starts the runner", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
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

test("a failed runner start marks the analysis failed instead of leaving it queued", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
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

test("a user cannot read an analysis that is not theirs (not found, not leaked)", async () => {
  mockFetch([
    ["/auth/v1/user", reply(200, USER)],
    ["/rest/v1/analyses?id=", reply(200, [])],
  ]);
  const res = await worker.fetch(request(`/api/analyses/${ANALYSIS_ID}`, { token: "ok" }), env);
  assert.equal(res.status, 404);
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
