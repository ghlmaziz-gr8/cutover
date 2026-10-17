# Cutover hosted service (Phase 1)

The hosted version of the discovery engine. A signed-in user gives a GitHub
repository. The API starts a GitHub Actions run, the run analyzes the code and
sends back findings only, and the findings are kept for 30 days.

```
browser (service/app)  ->  Cloudflare Worker (service/worker)  ->  GitHub Actions (.github/workflows/analyze.yml)
        |                         |                                         |
   Supabase Auth (Google)    Supabase Postgres (RLS)  <-- findings --  engine/post_result.py
```

## What is stored

- The repository name, the ref, the commit SHA, the status, and the findings JSON.
- Not stored: source code, file contents, or any patient data. The clone lives
  in a temporary folder on the runner and is deleted when the job ends.
- Each row belongs to one user. Row-level security stops users from reading or
  changing other users' rows. The retention job deletes rows after 30 days.

## One-time setup

### 1. Supabase

1. Create a project (Supabase free plan is fine for evaluation; see the open
   questions in the roadmap before any real use).
2. In the SQL editor, run `service/supabase/schema.sql`.
3. Authentication > Providers > Google: enable it and enter the Google OAuth
   client ID and secret.
4. Authentication > URL configuration: add the app's sign-in URL to the
   redirect allow-list.
5. Note the project URL and the `anon` key (public) and the `service_role` key
   (secret, server only).

### 2. Google OAuth

Create an OAuth client in Google Cloud. Set the authorized redirect URI to the
callback URL that Supabase shows in the Google provider settings.

### 3. GitHub

- Create a fine-grained token that can read the target repositories
  (Contents: read). Store it as the repository secret `TARGET_READ_TOKEN` in
  the Cutover repo.
- Create a second token that can dispatch workflows in the Cutover repo
  (Actions: read and write). Store it only as the Cloudflare secret
  `GITHUB_DISPATCH_TOKEN` (below).
- Add these repository secrets to the Cutover repo:
  - `TARGET_READ_TOKEN`
  - `CUTOVER_API_URL` (the deployed Worker URL, no trailing slash)
  - `RUNNER_SECRET` (a long random string; the same value goes to Cloudflare)

Generate the runner secret with `openssl rand -hex 32`.

### 4. Cloudflare

Edit `service/worker/wrangler.toml`: set `SUPABASE_URL` and `RUNNER_REPO`
(for example `your-org/cutover`). Then, from `service/worker`:

```sh
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put GITHUB_DISPATCH_TOKEN
npx wrangler secret put RUNNER_SECRET
npx wrangler deploy
```

Secrets are entered at the prompt and are never written to files.

### 5. The web app

Edit `service/app/config.js` with the Supabase project URL, the anon key, and
the Worker URL in `API_BASE` (the Worker's public URL). Serve the `service/app`
folder as a static site (for example Cloudflare Pages). The anon key is public
by design; row-level security is what protects the data.

## Tests

```sh
node --test service/worker/test/api.test.mjs    # Worker: auth, validation, callbacks, retention
python3 -m py_compile engine/post_result.py      # runner callback script
```

The Worker tests mock Supabase and GitHub, so they need no accounts.
The database policies were checked against a local Postgres 16 with stub
`auth` objects: cross-user inserts and reads are blocked and traversal-style
repository names are rejected. A real Supabase project should repeat this check
before launch.

## Rules that must stay true

- The engine (`engine/`) does not call Cloudflare, Supabase, or Google. Only
  `post_result.py` talks to the API, and it only sends the findings.
- Repository names are checked in three places (the Worker, the workflow, and
  the database constraint). Keep the patterns in step.
- No secret is written to a file in this repository. `.gitignore` blocks the
  usual secret file names as a backstop.
