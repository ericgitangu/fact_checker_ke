# ADR-0015: Deployment topology — Cloud Run backend, Vercel frontends and BFF

**Status:** Accepted (topology set, owner, 2026-10-03) · **Date:** 2026-10-03 · Refines ADR-0009 (hosting was left open)

## Decision summary
| Surface | Host | Why |
|---|---|---|
| `services/api` (Fastify) | **GCP Cloud Run**, `africa-south1` **[region tier: ADR-0009 open item]**, min=0, CPU boost | Scales to zero, keeps container parity with local, holds SSE streams up to 60 min **[V]** |
| `services/pipeline` (FastAPI) | **GCP Cloud Run**, min=0, ~~private~~ _(superseded — see "Red-team amendments": public ingress plus signature verification)_ (invoked only by QStash with a verified signature) | Python ML deps, long LLM calls, no public exposure |
| DB migrations | **Cloud Run Job** run per release **[V]** | Pay per execution, nothing idle |
| `apps/web` (Next.js PWA + BFF route handlers) | **Vercel**, deployed with CLI `vercel build` then `deploy --prebuilt` **[V]** | Edge CDN, ISR, and the PWA. Prebuilt deploys save Vercel build minutes **[V]** |
| `apps/site` (marketing SPA) | **Vercel** (static), separate project with its own root directory **[V]** | Static hosting, effectively free |
| Mobile (Expo) | Talks to **Cloud Run API directly** through the typed client in `packages/core` | See the BFF decision below |

## The BFF decision
- **Web** uses the Next.js BFF for SSR and ISR of published checks, session cookies (later auth) and same-origin form posts. It calls the Cloud Run API server-side.
- **Mobile does *not* go through the Vercel BFF.**
  - Vercel Hobby caps usage at 1M function invocations and **4h of Active CPU a month** **[V]**. Routing every mobile call and SSE stream through Vercel functions would spend that on pure proxying.
  - Native apps don't need SSR or cookies.
  - **DRY is kept at the contract layer:** web BFF and mobile share `packages/core` (zod schemas plus the typed API client), so there is still one source for request and response shapes.
- **SSE goes browser/app → Cloud Run API directly** (CORS-allowed origins), not through Vercel, so a stream is never held open twice.

## Commercial-use constraint (verified)
Vercel Hobby is *"restricted to non-commercial personal use only"*. Ads, payment processing and subscriptions count as commercial use. Donations don't **[V: vercel.com/docs/limits/fair-use-guidelines, updated 2026-09-14]**.
- **Phase 0-1** (no ads, no payments): Hobby is compliant.
- **Before ADR-0012 monetization ships:** move to Pro ($20/month). This is a hard gate in the release checklist. ~~(ads or payments only)~~ _(superseded — see "Red-team amendments": the trigger also covers sponsors, grants and operating as an incorporated entity)_
- Hobby can only roll back one step **[V]**, so promotion is deliberate (ADR-0016).

## Trade-offs accepted
- Two clouds to operate.
- CORS configuration for direct API access.
- Mobile and web take slightly different paths, which is mitigated by the shared contracts and client.

## Review trigger
Revisit on monetization launch (Pro), if Vercel Active CPU passes 70% of the Hobby limit, or if auth needs a unified session layer for mobile.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0015-1 | No mobile or SSE request path passes through a Vercel function (assert with request logs in an e2e smoke) | RED |
| AT-0015-2 | The API CORS allow-list contains exactly the configured web and site origins. An unknown origin gets no `Access-Control-Allow-Origin` | RED |
| AT-0015-3 | The pipeline service rejects an unsigned or invalidly signed request with 401 | RED |
| AT-0015-4 | A release checklist item covers any sponsor or grant disclosure, or incorporated-entity use, and switches the Vercel plan to Pro. | RED |

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #15 (medium severity).

- **"Private" corrected to "public ingress plus signature verification."** ADR-0016 says pipeline ingress is "internal plus a public URL"; QStash is an external caller, so the pipeline service must be publicly reachable, with QStash's signature check as the control (not network-level privacy). The table row above is corrected inline.
- **Pro-tier trigger broadened.** Showing sponsors or grants on `apps/site`, or incorporating the company, counts as commercial use under Vercel's fair-use terms even before ads or payments exist (red-team C-15). The release checklist gate (AT-0015-4) now covers this.

## Implementation notes (2026-10-03)

Both Vercel projects created and deployed to production via CLI prebuilt
deploys (owner-authorised autopilot; full detail in
`docs/runbooks/vercel-deploy.md`).

- **Projects (team `eric-gitangus-projects`, `team_TkjO2Is9t5UnpYysmXVvhgw1`):**
  - `fact-checker-ke-web` (`prj_8hkODuM7uspJUSUAEGIjSW8EDp2i`), Root Directory `apps/web` → `https://fact-checker-ke-web-eric-gitangus-projects.vercel.app`
  - `fact-checker-ke-site` (`prj_0laCM4Pe3Jq1M93ds3clTSzBCPVT`), Root Directory `apps/site` → `https://fact-checker-ke-site-eric-gitangus-projects.vercel.app`
  - No custom domain configured on either; these are Vercel's own stable per-project aliases.
- **Flags verified** (ADR-0016's `[to verify at implementation]`): `vercel deploy --prebuilt --prod --skip-domain`, then `vercel promote <url> --yes`. Both exist and behave as named in CLI v59.5.0 — **with one correction**: with no custom domain configured, `--skip-domain` does not defer the project's own stable `<project>-<team>.vercel.app` alias, only additional/custom domains. The deployment-specific hash URL is the genuinely-unlinked one to smoke before promoting; the scripts smoke that URL (`.deployment.url` from `vercel deploy --format json`), not the stable alias. Full detail and the root cause of a related monorepo file-tracing failure (fixed via `vercel project update --root-directory` + running commands from the repo root, plus a `buildCommand` in each app's `vercel.json` that builds `packages/core` first) are in the runbook.
- **AT-0015-1 (partial — config-level evidence, not yet the full e2e trace capture):** Neither project's deployed configuration routes any mobile or SSE path through Vercel. `apps/web`'s only server-side routes are `app/api/submissions/route.ts` (same-origin BFF POST proxy, not SSE) and `app/checks/[id]/page.tsx` (SSR fetch, not SSE); `apps/site` has no server-side routes at all (static SPA). Still RED pending the actual e2e smoke with request-log assertions the acceptance test calls for.
- **Deferred:** `API_BASE_URL` / `VITE_API_URL` are set to a documented placeholder (`https://api.fact-checker-ke.pending.invalid`) since `services/api` has no Cloud Run URL yet (out of scope for this work — owned by a concurrent agent). The flip procedure (update env → rebuild → promote) is recorded in the runbook as the exact step to run once that URL exists. `services/api`'s CORS allow-list (AT-0015-2) was not touched or verified here.

## Consolidation amendment (2026-10-04): one app project + a redirect stub

The two-frontend rows in the Decision summary are amended: the marketing SPA
`apps/site` is folded into `apps/web` (see ADR-0010 amendment), so the
deployment topology is now **one frontend Vercel project plus a redirect
stub**, not two peer frontends.

| Surface | Host | Status |
|---|---|---|
| `apps/web` (Next.js PWA + landing + BFF) | **Vercel** (`fact-checker-ke-web`) | The single frontend. Now also serves the marketing landing `/`, `/submit`, the waitlist BFF `/api/waitlist`, and `/sitemap.xml` + `/robots.txt` (Next Metadata routes). Deploy rail unchanged (ADR-0016). |
| `apps/site` | **Vercel** (`fact-checker-ke-site`) | **Retired to a redirect-only stub.** |

**The redirect (non-destructive).** `apps/site` keeps its Vercel project and
its git history — retiring the project itself is the owner's call. Its
`vercel.json` now carries a single 308 rule that forwards every path to the
web app, preserving path/query/hash:

```json
"redirects": [
  { "source": "/:path*",
    "destination": "https://fact-checker-ke-web.vercel.app/:path*",
    "permanent": true }
]
```

The build output is reduced to a tiny `index.html` meta-refresh + a client
`window.location.replace` fallback (`src/redirect.ts`), so a direct document
load still forwards even if the hosting redirect were ever absent. The
marketing React source, its tests, and the duplicated `public/` OG/icon
assets were removed (the OG/icons now live in `apps/web/public`); the Vercel
project, its env and its domain aliases are untouched.

**Deploy script.** `scripts/deploy/vercel-site.sh` still runs the full
pull → build → deploy → smoke → promote rail, but the smoke now asserts a
**308** on `/` whose `Location` points at the web app (it previously asserted
a 200 and grepped the JS bundle for the waitlist markup — neither exists in a
redirect stub). `scripts/deploy/vercel-web.sh` is unchanged.

**Canonical origin.** The redirect target and `apps/web`'s `metadataBase` /
sitemap / robots all use `https://fact-checker-ke-web.vercel.app`. NB: the
"Implementation notes" above record the longer per-project alias
`fact-checker-ke-web-eric-gitangus-projects.vercel.app`; the shorter
`fact-checker-ke-web.vercel.app` is the canonical alias used here. If only the
long alias is configured on the project, add the short one (or repoint these
constants) before cutover — flagged as the one deploy-time check for this
change.

**AT-0015-2 (CORS) note.** The web waitlist now posts same-origin to its own
BFF, which calls `services/api` server-side (no browser CORS), consistent with
`app/api/submissions`. `services/api`'s CORS allow-list can drop the retired
`apps/site` origin once this ships; that is a `services/` change, out of scope
for this frontend consolidation and left to the API owner.
