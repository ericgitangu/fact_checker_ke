# Vercel deploy runbook — apps/web and apps/site

Implements ADR-0015 (deployment topology) and ADR-0016's rail step H
(`vercel build --prod` → `deploy --prebuilt --prod --skip-domain` → smoke →
`vercel promote`). Scripts: `scripts/deploy/vercel-web.sh`,
`scripts/deploy/vercel-site.sh`, both sourcing `scripts/deploy/vercel-common.sh`.

## Projects

| Project | Vercel project name | Root Directory | Framework | Production URL (stable alias) |
|---|---|---|---|---|
| `apps/web` | `fact-checker-ke-web` | `apps/web` | Next.js 16 (Turbopack) | `https://fact-checker-ke-web-eric-gitangus-projects.vercel.app` |
| `apps/site` | `fact-checker-ke-site` | `apps/site` | Vite (static SPA) | `https://fact-checker-ke-site-eric-gitangus-projects.vercel.app` |

Both projects live under the `eric-gitangus-projects` Vercel team/scope
(the only scope with any pre-existing projects; `deveric` scope was empty).
No custom domain is configured on either project — the "production URL" is
Vercel's own stable per-project alias (`<project>-<team>.vercel.app`), which
is what `VITE_WEB_URL` points at and what `vercel promote` assigns.

Project IDs (team `team_TkjO2Is9t5UnpYysmXVvhgw1`):
- `fact-checker-ke-web`: `prj_8hkODuM7uspJUSUAEGIjSW8EDp2i`
- `fact-checker-ke-site`: `prj_0laCM4Pe3Jq1M93ds3clTSzBCPVT`

Both projects have **Deployment Protection (Vercel Authentication / SSO) ON**
by default for this team — even production URLs 302 to `vercel.com/sso-api`
for anonymous `curl`. Use `vercel curl <path> --deployment <url>` (not plain
`curl`) for any automated check; it auto-generates a protection-bypass token.
A human in a browser signed into the team sees the page directly.

## Env matrix (Production scope)

| Project | Var | Value | Why |
|---|---|---|---|
| `fact-checker-ke-site` | `VITE_API_URL` | `https://api.fact-checker-ke.pending.invalid` | Placeholder — `services/api` has no Cloud Run URL yet. Vite's production build (`apps/site/vite.config.ts`) only validates this is a syntactically-absolute `http(s)` URL; it does not resolve DNS, so the build passes. At runtime the waitlist form's `fetch` will hit a non-existent host and the user sees the `network_error` state (DNS failure), not the `misconfigured` state — the `misconfigured` state only fires when the var is *unset or malformed*, which is a correction to the original task framing (see Deviations below). |
| `fact-checker-ke-site` | `VITE_WEB_URL` | `https://fact-checker-ke-web-eric-gitangus-projects.vercel.app` | apps/web's stable production alias, used to build the `/methodology` link in `apps/site/src/App.tsx`. |
| `fact-checker-ke-web` | `API_BASE_URL` | `https://api.fact-checker-ke.pending.invalid` | Same placeholder. **Not** `NEXT_PUBLIC_API_URL`: `apps/web/app/api/submissions/route.ts` and `apps/web/app/checks/[id]/page.tsx` read `process.env.API_BASE_URL` server-side only (grepped before setting anything — see Deviations). It's a plain (non-`NEXT_PUBLIC_`) var by design, since it's only read in server-side route handlers/pages, never in client bundles. |

## The flip procedure (when services/api's real Cloud Run URL exists)

1. `vercel env rm VITE_API_URL production --project fact-checker-ke-site --scope eric-gitangus-projects --yes`
   `vercel env add VITE_API_URL production --value "<real Cloud Run URL>" --no-sensitive --project fact-checker-ke-site --scope eric-gitangus-projects`
2. `vercel env rm API_BASE_URL production --project fact-checker-ke-web --scope eric-gitangus-projects --yes`
   `vercel env add API_BASE_URL production --value "<real Cloud Run URL>" --project fact-checker-ke-web --scope eric-gitangus-projects` (sensitive is fine/default here — it's server-only)
3. Rebuild + redeploy **both** (the site value is baked into the static bundle at build time; the web value is read at request time but a fresh deploy picks up `vercel pull`'s refreshed `.env.production.local` deterministically):
   `scripts/deploy/vercel-web.sh`
   `scripts/deploy/vercel-site.sh`
4. Each script stages (`--skip-domain`), smokes, and only promotes on a clean smoke. If either API's CORS allow-list (ADR-0015 AT-0015-2) doesn't yet include these two origins, the site's waitlist smoke step (bundle-content check only, not a live POST) will still pass — add a follow-up manual check that a real waitlist submission succeeds end-to-end before calling this flip "done."

## Running a deploy

```bash
# apps/web
scripts/deploy/vercel-web.sh

# apps/site
scripts/deploy/vercel-site.sh
```

Both scripts:
1. `cd` to the repo root (`git rev-parse --show-toplevel`) — **required**, see "Monorepo gotcha" below.
2. `vercel link --yes --project <name> --scope <scope>` (idempotent; re-linking doesn't create a new project since it uses `--project`).
3. `vercel pull --yes --environment production` (project settings + Production env vars into `.vercel/`).
4. `vercel build --prod`.
5. `vercel deploy --prebuilt --prod --skip-domain` (stages a production-target deployment but — see note below — does **not** actually withhold the project's own stable alias with this CLI version/config; see "`--skip-domain` behavior" below).
6. Smoke the staged deployment via `vercel curl` (never plain `curl` — see Deployment Protection above).
7. On any non-200 (or, for site, missing `waitlist` string in the JS bundle), **exit 1 and skip promote** — production traffic is left exactly as it was.
8. On a clean smoke, `vercel promote <url> --yes`.

Env knobs:
- `VERCEL_TOKEN` — CI auth; omitted locally to use the operator's own `vercel login` session.
- `VERCEL_SCOPE` — defaults to `eric-gitangus-projects`.
- `SMOKE_ONLY_URL` — skip build+deploy and just smoke+promote an already-staged URL (used for the drill below and for retrying a promote after investigating a smoke failure without rebuilding).

### Monorepo gotcha: run from repo root, not from inside `apps/web`/`apps/site`

**Empirically confirmed 2026-10-03.** Running `vercel build`/`vercel deploy
--prebuilt` from *inside* `apps/web` (with the project's Root Directory left
at its linked default of `.`) builds successfully, but the prebuilt deploy
then fails at upload time with:

```
Please ensure project dependencies have been installed:
File does not exist: "node_modules/.pnpm/client-only@0.0.1/node_modules/client-only/index.js"
```

Root cause: Next's output-file-tracing records dependency paths relative to
the pnpm workspace root (where `node_modules/.pnpm` actually lives, since
pnpm hoists its virtual store once per workspace, not per package), but the
Vercel CLI's deploy-time file resolution uses the **project's own Root
Directory setting** as the base for those same relative paths. With Root
Directory `.` (i.e., "this directory I linked from IS the project root"),
it looks for `apps/web/node_modules/.pnpm/...`, which doesn't exist.

Fix applied: `vercel project update <name> --root-directory apps/web`
(`apps/site`, respectively) to tell Vercel the project root is a
*subdirectory* of wherever `vercel` is invoked from, then run
`vercel link`/`pull`/`build`/`deploy` **from the repo root**. This matches
the documented monorepo pattern ("Set `rootDirectory` ... when your app
isn't at the repo root") — the subtlety is that a plain `vercel link` run
*from inside* the app directory does not set this up; it must be configured
explicitly and the commands run one level up. `apps/web/vercel.json` and
`apps/site/vercel.json` do **not** carry a `rootDirectory` key themselves
(that field is for a vercel.json placed at the invocation root, not inside
the app dir); the setting lives on the Vercel project instead, set once via
`vercel project update`.

### `vercel.json` build command: the dependency the task runner (moon) would normally provide

`packages/core` (`@fact-checker-ke/core`) is consumed as a `workspace:*`
dependency and resolves via its `package.json` `exports` → `./dist/index.js`
(apps/web's `next.config.ts` comment about "consumed as TypeScript source"
refers to `transpilePackages`, not to skipping the package's own build —
the package entry point still requires `dist/` to exist). `moon.yml`'s
`dependsOn: ['core']` makes `moon run :build` build it first automatically,
but a bare `vercel build` only knows the single app's own `package.json`
`build` script. `apps/web/vercel.json` and `apps/site/vercel.json` therefore
set:

```json
"buildCommand": "pnpm --filter @fact-checker-ke/core run build && pnpm run build",
"installCommand": "pnpm install --frozen-lockfile"
```

`pnpm --filter` resolves the workspace root via `pnpm-workspace.yaml`
regardless of cwd depth, so this is safe to run from the repo root (where
Vercel commands are now invoked per the gotcha above).

### `--skip-domain` behavior (verified against CLI v59.5.0)

ADR-0016 flagged "the exact flag to stage a prod build without the domain"
as `[to verify at implementation]`. Verified: `vercel deploy --prebuilt
--prod --skip-domain` is the correct flag (confirmed via `vercel deploy
--help`), and `vercel promote <url> --yes` is the correct follow-up
(confirmed via `vercel promote --help`). **However**, with no custom domain
configured on either project, `--skip-domain` did not prevent the
deployment from immediately receiving the project's own stable
`<project>-<team>.vercel.app` alias — that alias is apparently not treated
as a "domain" subject to `--skip-domain`, only additional/custom domains
are deferred. In practice this means: for a project with no custom domain,
there is no fully "dark" staged URL distinct from what becomes production —
the deployment-specific hash URL (e.g.
`fact-checker-ke-ktyhms5t9-eric-gitangus-projects.vercel.app`) is the one
genuinely-unlinked URL to smoke against before `promote`; the stable alias
updates at promote time regardless of whether you passed `--skip-domain`.
The scripts smoke the deployment-specific hash URL returned by `vercel
deploy --format json`'s `.deployment.url`, consistent with this.

### Deployment Protection / SSO

Both projects have the team's default Deployment Protection enabled, so
anonymous `curl` to any URL — preview or production — returns a 302 to
`vercel.com/sso-api?...`. All smoke checks use `vercel curl <path>
--deployment <url>`, which auto-generates and uses a protection-bypass
token. Do not disable Deployment Protection to make plain `curl` work
(that's a security-settings change, out of scope and generally undesirable).

## Rollback

```bash
vercel rollback --scope eric-gitangus-projects --project fact-checker-ke-web
vercel rollback --scope eric-gitangus-projects --project fact-checker-ke-site
```

**Hobby plan limitation (ADR-0015):** only a single-step rollback is
available — i.e., only to the immediately-previous production deployment,
not an arbitrary point in history. Treat every promotion as deliberate;
there is no "roll back three releases" on Hobby.

## Hobby → Pro gate (ADR-0015 AT-0015-4)

Current state (2026-10-03) is pre-commercial: no ads, no payments, no
sponsors/grants disclosed, not yet an incorporated entity using the site
commercially. **Hobby is compliant today.** The release checklist must flip
both projects to Pro ($20/mo each, or one Pro team covering both) *before*
any of the following ship, per ADR-0015's red-team-amended trigger:
- ADR-0012 monetization (ads or payments)
- Sponsor or grant disclosure on `apps/site`
- Operating as an incorporated entity

This is a release-blocking gate, not a suggestion — re-verify Vercel's fair-use terms at that time rather than relying on this note.

## Deviations / tech debt surfaced during this deploy

1. **`API_BASE_URL`, not `NEXT_PUBLIC_API_URL`.** The task brief assumed the
   latter; grepping `apps/web` first (`rg -n "process\.env\.\w+"`) showed
   the actual code reads `process.env.API_BASE_URL` in
   `app/api/submissions/route.ts` and `app/checks/[id]/page.tsx`, both
   server-side only. Setting `NEXT_PUBLIC_API_URL` instead would have done
   nothing — the env var name must match what the code reads. Corrected
   per the task's own instruction to verify by grep.
2. **Monorepo build/deploy ordering required new `vercel.json` files** (see
   above) — not optional, the naive per-app `vercel build` fails without
   building `packages/core` first. This is deploy-configuration work within
   the owned files, not an app-code fix.
3. **Root Directory had to be set via `vercel project update
   --root-directory`**, and all `vercel` invocations had to move to the
   repo root — a deviation from the literal instruction to "run vercel
   commands FROM each app dir." The per-app-dir invocation is what produces
   the `client-only` file-tracing failure documented above; this was
   verified empirically, not assumed.
4. **Root `.gitignore`** was missing a `.vercel`/`.env*` entry (per-app
   `.gitignore`s in `apps/web` and `apps/site` already had it, or the
   Vercel CLI added it there automatically on first link). Per scope,
   `apps/site/.gitignore` and the root `.gitignore` are not owned files;
   the Vercel CLI itself appended `.vercel` and `.env*` (two lines, nothing
   removed) to both as a side effect of `vercel link` / `vercel link --repo`.
   This is flagged here rather than silently left in the diff. If this is
   unwanted, revert those two hunks — doing so does not affect
   `apps/web/.gitignore`, which already had the entry before this work
   started.
5. **`vercel link --repo` (alpha)** does not support non-interactive
   multi-project selection — it detected 3 candidate projects and could
   not pick among them without a TTY. Abandoned in favor of per-project
   `vercel link --yes --project <name>` run from the repo root (see Root
   Directory fix above), which is fully non-interactive.
6. **AT-0015-1 (partial, config-level evidence only):** no mobile or SSE
   request path is routed through either Vercel project. `apps/web`'s only
   server-side API route is `app/api/submissions/route.ts` (a same-origin
   BFF POST proxy for the web submission form, not SSE, not mobile) and
   `app/checks/[id]/page.tsx` (SSR page fetch, also not SSE). Neither
   project's `vercel.json` defines any rewrite/proxy toward an SSE endpoint.
   This is evidence from the deployed config, not a runtime trace capture
   (that would need the full e2e smoke AT-0015-1 calls for — still RED).
7. **`services/api`'s CORS allow-list (AT-0015-2)** was not touched or
   verified here — out of scope (owned by a concurrent agent per the task
   brief) and the API doesn't exist at a real URL yet regardless.
