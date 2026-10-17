// Cutover SaaS API (Cloudflare Worker).
//
// Routes (all under /api):
//   POST   /api/analyses                 start an analysis for a GitHub repo (signed in)
//   GET    /api/analyses                 list your analyses (signed in)
//   GET    /api/analyses/:id             read one analysis, with findings (signed in)
//   DELETE /api/analyses/:id             delete one analysis (signed in)
//   POST   /api/runner/:id/result        runner callback with findings (shared secret)
//
// A scheduled job deletes analyses past their expires_at (retention).
//
// Required secrets (set with `wrangler secret put`, never in code):
//   SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GITHUB_DISPATCH_TOKEN, RUNNER_SECRET
// Required vars (wrangler.toml): SUPABASE_URL, RUNNER_REPO

// GitHub owner: letters, digits, hyphens. Repo name: no leading dot, so "." and ".." are rejected.
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const REF_PATTERN = /^(?!.*\.\.)[A-Za-z0-9_./-]{1,200}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 5_000_000; // findings can be large, but not unbounded

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

// Calls PostgREST with the service role. Only used for runner callbacks and retention.
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

async function startAnalysis(request, env) {
  const user = await currentUser(env, request);
  if (!user) return json({ error: "Sign in first." }, 401);

  const parsed = await readJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const { repo, ref } = parsed.value || {};
  if (typeof repo !== "string" || !REPO_PATTERN.test(repo)) {
    return json({ error: "repo must look like owner/name." }, 400);
  }
  if (ref !== undefined && ref !== null && (typeof ref !== "string" || !REF_PATTERN.test(ref))) {
    return json({ error: "ref must be a branch, tag, or commit name." }, 400);
  }

  // Create the row as the user, so RLS enforces owner_id = auth.uid().
  const created = await userRest(env, request.headers.get("authorization").slice(7), "analyses", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ owner_id: user.id, repo, ref: ref || null }),
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

async function listAnalyses(request, env) {
  const user = await currentUser(env, request);
  if (!user) return json({ error: "Sign in first." }, 401);
  const token = request.headers.get("authorization").slice(7);
  const res = await userRest(env, token,
    "analyses?select=id,repo,ref,status,commit_sha,created_at,finished_at,expires_at&order=created_at.desc&limit=100");
  if (!res.ok) return json({ error: "Could not load analyses." }, 502);
  return json(await res.json());
}

async function getAnalysis(request, env, id) {
  const user = await currentUser(env, request);
  if (!user) return json({ error: "Sign in first." }, 401);
  const token = request.headers.get("authorization").slice(7);
  const res = await userRest(env, token, `analyses?id=eq.${id}&select=*`);
  if (!res.ok) return json({ error: "Could not load the analysis." }, 502);
  const [row] = await res.json();
  if (!row) return json({ error: "Not found." }, 404);
  return json(row);
}

async function deleteAnalysis(request, env, id) {
  const user = await currentUser(env, request);
  if (!user) return json({ error: "Sign in first." }, 401);
  const token = request.headers.get("authorization").slice(7);
  const res = await userRest(env, token, `analyses?id=eq.${id}`, {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
  if (!res.ok) return json({ error: "Could not delete the analysis." }, 502);
  const removed = await res.json();
  if (!removed.length) return json({ error: "Not found." }, 404);
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

async function purgeExpired(env) {
  const now = new Date().toISOString();
  const res = await serviceRest(env, `analyses?expires_at=lt.${encodeURIComponent(now)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error(`Retention purge failed with status ${res.status}`);
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

    if (path === "/api/analyses" && method === "POST") return startAnalysis(request, env);
    if (path === "/api/analyses" && method === "GET") return listAnalyses(request, env);

    const one = path.match(/^\/api\/analyses\/([^/]+)$/);
    if (one && UUID_PATTERN.test(one[1]) && method === "GET") return getAnalysis(request, env, one[1]);
    if (one && UUID_PATTERN.test(one[1]) && method === "DELETE") return deleteAnalysis(request, env, one[1]);

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
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
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
