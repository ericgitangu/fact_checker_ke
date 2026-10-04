# Runbook: go-live sequence (first real deploy with real platform/LLM/STT keys)

**Status: prepare-only. No step in this runbook has been executed by the
agent that wrote it.** It documents the exact, ordered sequence to run
when the owner is ready to drop real dev-account keys (YouTube, X,
Anthropic, STT) and let the two-engine pipeline (ADR-0032) start
fetching, verifying and auto-publishing for real. It exists so going
live is a deliberate, auditable act, not an accidental side effect of
adding a key.

Companion doc: [`activate-on-keys-audit.md`](./activate-on-keys-audit.md)
— the per-client env-var → secret → Cloud Run wiring audit referenced in
step 3 below.

**Builds on:** ADR-0015 (deployment topology), ADR-0016 (deploy rail/IaC),
ADR-0009 (runtime topology, two-engine amendment), ADR-0032 (fetch
engine), ADR-0031 + its two-engine-pivot amendment (auto-publish is the
default), ADR-0033 (standing caveat/indemnity, advocate gate), ADR-0005
(STT), ADR-0011 (cost controls).

---

## 0. The one fact that makes step-ordering non-negotiable

**Auto-publish is the default operating mode, and the kill-switches
default to NOT frozen.** This was a deliberate owner-approved decision
(ADR-0031 two-engine-pivot amendment: *"Auto-publish is the DEFAULT
operating mode"*), not a bug — but it means:

- `services/pipeline/app/stages/publish_policy.py`'s `PublishPolicyFlags()`
  zero-value default is `global_auto_publish_enabled: bool = True`.
- `services/api/src/lib/publish-kill-switch.ts`'s
  `isAutonomousPublishFrozen` returns `false` (not frozen → publishing
  live) when no `policy_flags` row exists for
  `autonomous_publish_kill_switch`.
- `services/api/src/lib/fetch-kill-switch.ts`'s `isFetchEngineFrozen`
  likewise defaults to `false` (not frozen) for `fetch_engine_kill_switch`.
- `services/pipeline/app/main.py` reads `FETCH_ENGINE_ENABLED` and
  **defaults to `"true"`** when the env var is unset.

So: **the moment real YouTube/Anthropic keys exist AND the backend is
deployed AND fetch is enabled, the system will, by design, start
autonomously fetching, verifying and auto-publishing named-person
assessments** — with no additional action required. That is the exact
risk this runbook's step 2 exists to neutralise *before* step 3 adds any
key.

**UPDATE (go-live plumbing pass, see the companion PR): the gap
described in this subsection when it was first written is now CLOSED —
re-verified empirically this session, not assumed.**
`services/api/src/lib/publish-enactment.ts#enactPublishDecision` is
called from `services/api/src/lib/submission-orchestrator.ts`, which is
itself wired into the live `POST /internal/hops/orchestrate` route
(`app.ts`) — confirmed via
`grep -rln "enactPublishDecision" services/api/src --include="*.ts" | grep -v __tests__`
returning `app.ts`, `lib/submission-orchestrator.ts`, and
`lib/publish-enactment.ts` itself (previously this returned only the
defining file). The orchestrator calls `services/pipeline`'s
`/hops/analyze` then `/hops/verify` directly over HTTP and feeds the
verify hop's publish decision into `enactPublishDecision`, which checks
both kill-switches before writing `isDraft=false`
(`services/api/src/__tests__/submission-orchestration-e2e.integration.test.ts`
exercises this end-to-end through the real relay + a real spawned
pipeline process, fakes-only). **Practical effect: the live HTTP path
CAN auto-publish for real today** — the risk described above in this
section is live, not latent. This makes step 2's freeze operationally
meaningful (not just a precaution against a future wiring change), and
§2.4 below is now itself verified rather than deferred: this session's
db/migrations/0014_safe_launch_shadow_mode_seed.sql + a dedicated
integration test (`services/api/src/__tests__/
safe-launch-seed.integration.test.ts`) prove, against a freshly migrated
throwaway database, that both kill-switches read frozen on a DB that has
never had a policy_flags row written — closing exactly the loop this
section used to say couldn't be closed yet.

---

## 1. Pre-flight gates (before touching any switch, key, or terraform var)

1.1. **Advocate sign-off (ADR-0033).** ADR-0033 is a **STARTER DRAFT, NOT
LEGAL ADVICE**, gated: *"Nothing in this ADR may be published to users
until the retained advocate reviews and signs off."* AT-0033-2 requires
the entire caveat/T&Cs/Privacy-Policy set to stay hidden while the
advocate-signoff flag is unset. Confirm (do not assume):
   - The flag this gate reads is `ADVOCATE_SIGNOFF_COMPLETE` (per this
     task's framing) — **grep for it before relying on the name**:
     ```bash
     rg -n "ADVOCATE_SIGNOFF_COMPLETE|advocate_signoff" services/api/src services/pipeline/app packages/
     ```
     At the time of this audit, no occurrence of a flag with this exact
     name was found anywhere in `services/api`, `services/pipeline`, or
     `packages/` — only `advocateSignoffRef` (a per-write *reference
     string* required specifically for Tier-C relaxation in
     `policy-audit.ts`'s `updatePolicyFlag`, see §3 below) and the
     `[ADVOCATE: ...]` markers inside ADR-0033's own prose. **There is no
     implemented global "advocate signed off on the whole legal
     framework" switch yet** — AT-0033-2 is RED. Until it exists, treat
     advocate sign-off as a **human gate enforced by process, not by
     code**: do not deploy the caveat/T&Cs/Privacy-Policy surfaces, and
     do not flip auto-publish live for Tier C beyond mode (a), until the
     advocate has actually reviewed ADR-0033 end-to-end and every
     `[ADVOCATE: ...]` marker is resolved in writing (email/doc, not a
     flag). Record the resolution (who signed off, when, on what
     version of ADR-0033) in the ADR itself as an amendment before
     relying on it operationally.
   - If/when a real `ADVOCATE_SIGNOFF_COMPLETE`-style flag is implemented
     before go-live, re-run the grep above and update this step to
     reference it by its real name and storage location (policy_flags
     row vs. env var).

1.2. **Decide Tier-C mode.** Per ADR-0031's amendment, Tier C (named
living person, hard-negative imputation) is a configurable spectrum:
   - **(a) caveated open-question + async audit — the default**, and the
     one this runbook assumes unless the owner explicitly decides
     otherwise here.
   - **(b) fast-track human tap** — stricter; select this per
     source/topic/entity/window if the exposure warrants it (e.g. a
     named high-risk politician, an election-silence window).
   - **(c) plain caveat** — a *relaxation* below the mode-(a) default.
     `tier_c_mode_relaxes_below_default()` in
     `services/pipeline/app/stages/publish_policy.py` returns `True` for
     mode (c), and `updatePolicyFlag`'s `relaxesTierC` gate
     (`services/api/src/lib/policy-audit.ts`) **refuses** this write
     without an `advocateSignoffRef`. Do not attempt to select mode (c)
     at go-live; it requires its own advocate-signed decision later
     (ADR-0031 hard constraint 2).
   - **Owner decision for this go-live, to be filled in before executing
     step 2:** `TIER_C_MODE = ____` (default: `a`, if left blank).

1.3. **Decide which platforms/engines to enable.** Per the
activate-on-keys audit, the only two real fetch sources that exist in
code today are YouTube (`YOUTUBE_API_KEY`) and the triage feed
(`TRIAGE_FEED_URLS`, PesaCheck/Africa Check RSS/CKAN). X and TikTok are
fake-stub-only (no real client exists to activate, by design —
`fetch_source_factory.py`'s own docstring). Decide, and record here:
   - **YouTube fetch:** enable at go-live? `YES` / `NO` — requires
     `YOUTUBE_API_KEY` (step 3).
   - **Triage feed (PesaCheck/Africa Check):** enable at go-live?
     `YES` / `NO` — requires `TRIAGE_FEED_URLS` (a config value, not a
     secret — see audit doc; free, no API key).
   - **X:** cannot be enabled — no real client exists yet (code gap, not
     a config decision). Revisit only after a budgeted X client ships.
   - **TikTok:** cannot be enabled (embed-only by ADR-0032 design, no
     autonomous discovery path exists or is planned without a
     partnership).
   - **Submission engine (user-submitted claims):** this is the
     pre-existing engine, independent of the fetch-engine decision above
     — confirm whether it should also stay paused under the same freeze
     in step 2, or only the autonomous fetch/publish paths. **Recommendation:
     freeze both** (the global `autonomous_publish_kill_switch` covers
     every ingest source per AT-0031-10 — "honoured for EVERY ingest
     source (not just fetch)", `publish-enactment.ts` line ~111-125) so
     the first real keys don't also auto-publish a user-submitted
     named-person draft before review.

---

## 2. SAFETY FIRST — freeze before keys, freeze before deploy

**Do this before step 3.** The point is to make it structurally
impossible for the first real key + the first real deploy to combine
into an unreviewed auto-published named-person assessment.

### 2.1 Flip the global autonomous-publish kill switch to FROZEN

This is the `autonomous_publish_kill_switch` row in `policy_flags`
(`services/api/src/lib/publish-kill-switch.ts`), covering **every**
ingest source (submission and fetch alike — AT-0031-10). `enabled: true`
means the switch is thrown, i.e. **frozen** (naming mirrors the
pre-existing `maandamano_kill_switch` convention — see
`docs/runbooks/nc4-kill-switch.md`).

**No admin HTTP route exists for this yet** (confirmed: no route in
`services/api/src/routes/*.ts` calls
`setAutonomousPublishKillSwitch`/`setFetchEngineKillSwitch` outside
integration tests — unlike `maandamano`'s
`POST /v1/admin/maandamano/kill-switch`, which does exist). This is
itself a gap (see `activate-on-keys-audit.md`), but it must not block
the freeze — the row is a plain, directly writable Postgres table.
Flip it with a short script using the same code path the tests use
(so the audit-log row is written correctly, same transaction, per
`policy-audit.ts`), rather than a raw `UPDATE` that would skip the
audit trail:

```bash
# Run from services/api, against the real DATABASE_URL (Neon prod
# branch) — a one-off ts-node/tsx invocation, NOT a new permanent script
# unless the team decides to keep it as scripts/ops/kill-switch.ts.
cd services/api
DATABASE_URL="$PROD_DATABASE_URL" npx tsx -e '
  import { drizzle } from "drizzle-orm/node-postgres";
  import { Pool } from "pg";
  import { schema } from "@fact-checker-ke/db";
  import { setAutonomousPublishKillSwitch } from "./src/lib/publish-kill-switch.js";
  import { setFetchEngineKillSwitch } from "./src/lib/fetch-kill-switch.js";

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  const ADMIN_USER_ID = process.env.ADMIN_USER_ID!; // must be a real users.id row (FK: policy_flags.updated_by)

  const a = await setAutonomousPublishKillSwitch(db, { actorId: ADMIN_USER_ID, enabled: true });
  const b = await setFetchEngineKillSwitch(db, { actorId: ADMIN_USER_ID, enabled: true });
  console.log({ autonomousPublishFrozen: a, fetchEngineFrozen: b });
  await pool.end();
'
```

`ADMIN_USER_ID` must be a real `users.id` (the `policy_flags.updated_by`
column is `NOT NULL` with a foreign key to `users` — `packages/db/src/schema.ts`
line ~813). Use the founder/admin account's id.

**Verify, don't assume:**
```bash
DATABASE_URL="$PROD_DATABASE_URL" psql "$PROD_DATABASE_URL" -c \
  "select key, value, updated_by, updated_at from policy_flags where key in ('autonomous_publish_kill_switch','fetch_engine_kill_switch');"
# -> both rows, value = true
```

### 2.2 Also set `FETCH_ENGINE_ENABLED=false` at the env level (belt-and-suspenders)

`services/pipeline/app/main.py` line ~219 reads `FETCH_ENGINE_ENABLED`
and defaults to `"true"`. The DB flag above (`fetch_engine_kill_switch`)
is the fast, no-redeploy lever; the env var is the slow, requires-
redeploy lever — **both independently halt ingestion** (per
`fetch-kill-switch.ts`'s own docstring: "either one being 'disabled'
halts ingestion").

**Now wired by Terraform, not a manual flag at deploy time:**
`infra/terraform/envs/prod/cloud_run.tf`'s `pipeline_service` module
sets `plain_env = { FETCH_ENGINE_ENABLED = "false" }` unconditionally —
every `terraform apply` of this service (including the very first one in
step 4) deploys with ingestion halted by construction. No manual
`--set-env-vars` flag is needed at `gcloud run deploy` time any more;
flipping this requires a deliberate `.tf` edit (step 5.1), which is the
point. Confirm it's actually on the deployed revision after step 4 with
the `gcloud run services describe ... | grep FETCH_ENGINE_ENABLED` check
in step 4.4 below — Terraform setting it correctly in the plan is not
the same as the deployed revision having it.

### 2.3 Decide Tier-C mode's policy_flags row now, if not mode (a)

If step 1.2 chose mode (b) for specific entities/topics, write the
corresponding `tier_c_mode` policy flags **now**, before keys, through
`updatePolicyFlag` (same reasoning as 2.1 — audit-logged, no raw SQL).
Leave it as mode (a) (the implicit default; no row needed) if 1.2 did
not call for a stricter mode.

### 2.4 Confirm the freeze actually blocks (closes the loop before trusting it)

**Now verified — not deferred.** §0's update above confirms
`enactPublishDecision` is wired into the live
`POST /internal/hops/orchestrate` route, so this loop is real, and this
session closed it two ways, both against the REAL code (no
reimplementation):

1. **Migration-level proof.** `db/migrations/0014_safe_launch_shadow_mode_seed.sql`
   seeds both `policy_flags` rows frozen on a DB that has never had them
   written. `services/api/src/__tests__/safe-launch-seed.integration.test.ts`
   provisions a throwaway sibling Postgres database, runs every real
   migration file against it via drizzle's own migrator, and asserts
   `isAutonomousPublishFrozen`/`isFetchEngineFrozen` both read `true` —
   proving a FRESH prod DB starts frozen, not auto-publish-live.
2. **End-to-end proof.** `services/api/src/__tests__/
   submission-orchestration-e2e.integration.test.ts` drives a real
   `submission.received` event through the real outbox relay, the real
   `/internal/hops/orchestrate` route, and a real spawned
   `services/pipeline` process (fakes-only, no vendor keys) into
   `enactPublishDecision`. Before this session's go-live-plumbing pass,
   this suite exercised the *unfrozen* (auto-publish) path only; it now
   explicitly unfreezes both switches in its own `beforeAll` (since
   migration 0014 changed the shared integration DB's default) and
   proves the happy path still reaches `check.published` when
   deliberately unfrozen. The companion assertion — that the SAME route
   blocks when frozen — was not added as a fourth test in this pass (out
   of the stated scope: this task touched `services/api` config/CORS +
   `packages/db`/migrations only, not new route-level test coverage) and
   remains a good next step for whoever wires the admin kill-switch HTTP
   routes mentioned below.

**Still open, not closed by this pass:** no admin HTTP route exists yet
to flip either kill-switch outside a direct DB/tsx script (the gap named
in step 2.1 above) — flipping still goes through the one-off `tsx`
snippet there, not a `POST /v1/admin/.../kill-switch` route like
`maandamano`'s.

---

## 3. Wire keys (after step 2 is verified)

Full per-client table in [`activate-on-keys-audit.md`](./activate-on-keys-audit.md)
(now updated — see that doc's own revision note at the top). Summary of
the exact sequence per key — **never echo a secret value in a shell
history, log, or this runbook**:

```bash
# 1. Secret Manager containers already exist in
#    infra/terraform/envs/prod/secrets.tf as of the go-live-plumbing PR
#    (module blocks secret_anthropic_api_key, secret_youtube_api_key,
#    secret_google_factcheck_api_key, secret_reverse_image_api_key,
#    secret_revalidate_secret, secret_x_api_bearer_token -- the last one
#    is a container only, nothing reads it yet, see §"Readiness gaps").
#    Apply that plan first if it hasn't already landed in this
#    environment (containers only -- no values, no cost, safe before any
#    key exists):
terraform -chdir=infra/terraform/envs/prod plan -out=plan.out
bash infra/terraform/policy/plan-guard.sh plan.out   # must pass before apply
terraform -chdir=infra/terraform/envs/prod apply plan.out

# 2. Add the secret VALUE, no-echo, from stdin (established pattern,
#    ADR-0016 "First real deploy" section) -- exact secret ids, matching
#    secrets.tf:
printf '%s' "$ANTHROPIC_API_KEY" | gcloud secrets versions add fact-checker-ke-anthropic-api-key \
  --data-file=- --project=master-crossing-435409-r1
printf '%s' "$YOUTUBE_API_KEY" | gcloud secrets versions add fact-checker-ke-youtube-api-key \
  --data-file=- --project=master-crossing-435409-r1
# Optional, paid: Google FactCheck Tools API key (used today by
# make_factcheck_client as the retrieval source, ADR-0004 step 4 — not
# itself part of the ADR-0032 fetch engine but shares this step):
printf '%s' "$GOOGLE_FACTCHECK_API_KEY" | gcloud secrets versions add fact-checker-ke-factcheck-api-key \
  --data-file=- --project=master-crossing-435409-r1
# Reverse-image search (ADR-0006 signal, services/pipeline/app/clients/
# reverse_image_search.py):
printf '%s' "$REVERSE_IMAGE_API_KEY" | gcloud secrets versions add fact-checker-ke-reverse-image-api-key \
  --data-file=- --project=master-crossing-435409-r1
# apps/web ISR revalidation webhook shared secret (services/api/src/
# config.ts's revalidateSecret, services/api/src/lib/
# maandamano-revalidate.ts). Optional: the kill-switch flip still
# succeeds and is still audit-logged without it, just without CDN
# propagation -- see config.ts's doc comment.
printf '%s' "$REVALIDATE_SECRET" | gcloud secrets versions add fact-checker-ke-revalidate-secret \
  --data-file=- --project=master-crossing-435409-r1
```

- **YouTube Data API key (primary fetch source, ADR-0032 §"Per-platform
  feasibility").** Free within the 10,000 units/day quota. Env var:
  `YOUTUBE_API_KEY` (constant `YOUTUBE_API_KEY_ENV` in
  `services/pipeline/app/clients/youtube_fetch_source.py`).
- **X (optional, PAID — cost note).** No real client exists in code yet
  (`fetch_source_factory.py`: "X and TikTok... stay protocol+fake stubs
  ONLY in this slice"). **Do not wire an X key at this go-live** — there
  is nothing for it to activate. Revisit when a budgeted X client ships
  (ADR-0032 §4's per-read monthly budget is a prerequisite for that
  client, not just the key).
- **Anthropic LLM key.** `ANTHROPIC_API_KEY`
  (`services/pipeline/app/clients/llm_anthropic.py`). Paid from the
  first call — ADR-0005/0011 "budget for paid [LLM/STT] from day one,
  don't assume a free tier." Also set `ANTHROPIC_HAIKU_MODEL` /
  `ANTHROPIC_SONNET_MODEL` only if overriding the defaults
  (`claude-haiku-4-5` / `claude-sonnet-5-5`) — otherwise leave unset.
- **STT key.** **There is no real STT client to wire a key into.**
  `services/pipeline/app/protocols/transcriber.py`'s own docstring:
  "Only a fake implementation exists in this skeleton (no real STT
  vendor call, no API keys)." ADR-0005's provisional winner is GCP STT
  v2 `chirp_2` (7.8% WER, Round A), but no `make_transcriber()`-style
  factory, no GCP STT client, and no Round-B (Sheng/noisy) eval exists
  yet. **This is a code gap, not a config gap — adding a key here does
  nothing until the client is implemented.** Do not attempt to wire an
  STT secret at this go-live; track it as a blocking item for whenever
  live-stream/audio fetch-engine coverage is prioritized (ADR-0005
  amendment: STT only runs on the compliant subset — owner-authorized/
  partner/open-licensed/live-capture — so this gap only blocks *that*
  subset of coverage, not YouTube/triage-feed text-based fetch).

### 3.1 Cloud Run `--set-secrets` wiring (per ADR-0016)

**Now wired, as of the go-live-plumbing PR.**
`infra/terraform/envs/prod/cloud_run.tf`'s `secret_env` maps:

- `pipeline_service`: `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN` (pre-existing) + `ANTHROPIC_API_KEY`,
  `YOUTUBE_API_KEY`, `GOOGLE_FACTCHECK_API_KEY`, `REVERSE_IMAGE_API_KEY`
  (new).
- `api_service`: `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN` (pre-existing) + `REVALIDATE_SECRET` (new).

Each real client still activates on its own env var alone, falling back
to its fake/stub when the secret has no version yet — this wiring only
makes the Cloud Run *container* have the env var available; it does not
by itself add a value or make any vendor call.

**Still not wired, by design (confirmed no code reads it yet):**
`TRIAGE_FEED_URLS` — a plain env var (a list of feed URLs, not a secret)
with no Terraform entry at all. Free, zero-key, highest-signal source
per ADR-0032; left as a documented gap rather than fixed in this pass
because it wasn't in this task's named scope (see
`activate-on-keys-audit.md`'s gap table) — add a `plain_env.TRIAGE_FEED_URLS`
entry to `pipeline_service` alongside `FETCH_ENGINE_ENABLED` the next
time this file is touched.

**Also not wired, deliberately:** `X_API_BEARER_TOKEN`. The Secret
Manager *container* `fact-checker-ke-x-api-bearer-token` exists
(secrets.tf), but no `secret_env` entry references it on either service,
because no code anywhere reads an X-related env var — confirmed via
`fetch_source_factory.py`'s own docstring and a repo-wide grep (no
`XFetchSource`-equivalent file exists). Wiring a Cloud Run env var that
nothing reads would be dead plumbing; wire it in the same change that
ships a real, budgeted X client (ADR-0032 §4).

---

## 4. Enable + deploy backend

1. **Flip the Terraform services gate** (`enable_services`, default
   `false` — `infra/terraform/envs/prod/variables.tf`): once images are
   pushed by digest (next sub-step), apply with
   `-var enable_services=true`. This is the single flag that turns the
   `api_service`/`pipeline_service`/`migrate_job` module blocks from
   zero-count to real Cloud Run resources (`cloud_run.tf`'s
   `count = var.enable_services ? 1 : 0`).
2. **`terraform plan` + the plan-guard, every time, before any apply:**
   ```bash
   terraform -chdir=infra/terraform/envs/prod plan \
     -var enable_services=true \
     -var api_image="$API_IMAGE_DIGEST" \
     -var pipeline_image="$PIPELINE_IMAGE_DIGEST" \
     -var migrate_image="$MIGRATE_IMAGE_DIGEST" \
     -out=plan.out
   terraform -chdir=infra/terraform/envs/prod show -json plan.out > plan.json
   bash infra/terraform/policy/plan-guard.sh plan.json
   # MUST exit 0. Per the cost rules, re-grep the plan yourself too:
   grep -iE "NatGateway|natGateways|allocateEip|min_instance_count\s*=\s*[1-9]|cpu_idle\s*=\s*false" plan.json && echo "STOP — always-on resource detected" || echo "clean"
   ```
3. **Apply** only after both checks pass:
   ```bash
   terraform -chdir=infra/terraform/envs/prod apply plan.out
   ```
4. **Run via the release rail**, not ad hoc commands (`scripts/release/release.sh`
   implements exactly this ordered sequence — moon ci → build+push by
   digest → terraform plan/guard → migration lint → migrate job → deploy
   `--no-traffic` tag=candidate → smoke → shift traffic → Vercel
   build/deploy/promote):
   ```bash
   ENABLE_SERVICES=true bash scripts/release/release.sh
   ```
   Confirm the `FETCH_ENGINE_ENABLED=false` env var from step 2.2 (now a
   `plain_env` entry Terraform sets unconditionally on `pipeline_service`
   — see 2.2's update) is still present on the deployed revision:
   ```bash
   gcloud run services describe fact-checker-ke-pipeline --region=africa-south1 \
     --format='value(spec.template.spec.containers[0].env)' | grep FETCH_ENGINE_ENABLED
   ```
5. **Point apps/web + apps/site BFF env at the live API URL** (the
   deferred step flagged in ADR-0015's implementation notes and
   `docs/runbooks/vercel-deploy.md`'s "flip procedure"):
   ```bash
   gcloud run services describe fact-checker-ke-api --region=africa-south1 --format='value(status.url)'
   # then, per vercel-deploy.md's flip procedure:
   vercel env rm VITE_API_URL production --project fact-checker-ke-site --scope eric-gitangus-projects --yes
   vercel env add VITE_API_URL production --value "<real Cloud Run URL>" --no-sensitive --project fact-checker-ke-site --scope eric-gitangus-projects
   vercel env rm API_BASE_URL production --project fact-checker-ke-web --scope eric-gitangus-projects --yes
   vercel env add API_BASE_URL production --value "<real Cloud Run URL>" --project fact-checker-ke-web --scope eric-gitangus-projects
   scripts/deploy/vercel-web.sh
   scripts/deploy/vercel-site.sh
   ```
6. **Confirm `services/api`'s CORS allow-list** (AT-0015-2). **Now
   wired, as of the go-live-plumbing PR:**
   `infra/terraform/envs/prod/cloud_run.tf`'s `api_service` module sets
   `plain_env = { CORS_ORIGINS = "https://fact-checker-ke-web.vercel.app" }`
   — the ONLY origin, since `apps/site` was retired to a redirect-only
   stub in the single-frontend consolidation (no second origin exists to
   add). Before this PR, `CORS_ORIGINS` was unset anywhere in Terraform
   at all (`services/api/src/config.ts` fell back to its localhost-only
   dev default in every real deploy) — this was the actual gap, not a
   stale `apps/site` entry to remove. Verify the deployed value:
   ```bash
   gcloud run services describe fact-checker-ke-api --region=africa-south1 \
     --format='value(spec.template.spec.containers[0].env)' | grep CORS_ORIGINS
   ```
   If the owner's Vercel project is actually aliased under the longer
   per-project domain (`fact-checker-ke-web-eric-gitangus-projects.vercel.app`
   — see ADR-0015's implementation notes on the two aliases), add it as a
   second comma-separated origin before relying on this in production.
7. **Confirm scale-to-zero held** (ADR-0016 AT-0016-7, deferred):
   ```bash
   gcloud run services describe fact-checker-ke-api --region=africa-south1 --format='value(status.traffic)'
   # + a 24h idle soak showing Neon suspended (console.neon.tech)
   ```

**At the end of step 4, the system is deployed, keyed, but still FROZEN**
(step 2's kill switches and `FETCH_ENGINE_ENABLED=false` are both still
in effect). Nothing auto-publishes yet. This is intentional — do not
skip to "it's live" language until step 5 is deliberately executed.

---

## 5. Deliberate un-freeze (tier by tier, watching telemetry)

Do this as a separate, later, deliberate action — not as part of the
same session as step 4, unless the owner explicitly wants same-session
go-live.

1. **Flip `FETCH_ENGINE_ENABLED=true`** on the pipeline Cloud Run service
   (a redeploy/env update) — this only enables *ingestion*, not
   publishing, independent of the kill-switch.
2. **Flip `fetch_engine_kill_switch` to `enabled: false`** (same tsx
   snippet as step 2.1, with `enabled: false`) — allows fetch-sourced
   publishing specifically.
3. **Flip `autonomous_publish_kill_switch` to `enabled: false`** last —
   this is the broadest switch (every ingest source). Flipping it while
   `fetch_engine_kill_switch` is still frozen lets the **submission**
   engine publish while fetch stays paused, if that staged order is
   preferred.
4. **Watch, in order, before widening further:**
   - Async-audit samples (ADR-0031's shrinking-sample-rate auditor) —
     confirm the editor queue is actually receiving sampled published
     items, not silently empty.
   - The per-engine cost breaker (ADR-0011 amendment) — confirm the
     fetch engine's independent budget line is being decremented, not
     stuck at zero (which would mean the breaker isn't wired, not that
     nothing is spending).
   - ADR-0011 cost telemetry (`{stage, model, input_tokens,
     cached_tokens, output_tokens, usd}` rows) — confirm real rows are
     landing with non-placeholder values.
   - GCP + Anthropic billing budget alerts (already provisioned,
     `google_billing_budget.prod` — confirm the notification channel
     email is correct and test-fires if possible).
5. **Raise auto-publish tier/mode only after the above show real,
   sane data for at least one full observation window** (a day,
   minimum) — this is the ADR-0031 "quality ramp," which is explicitly
   an *output* of measured calibration, not a calendar-based schedule.

---

## 6. Rollback

- **Instant halt (no deploy):** flip `autonomous_publish_kill_switch` to
  `enabled: true` (same script as step 2.1). Per AT-0031-10 this is
  "within one propagation cycle" since both the DB write and every read
  are uncached. **Caveat from §0:** today this only blocks the enactment
  path once it exists; until `enactPublishDecision` is wired into a live
  route, this switch has no live effect to roll back from. Do not treat
  "the switch is set" as "nothing will publish" without having verified
  the wiring per step 2.4.
- **Halt only fetch, leave submission engine live:** flip
  `fetch_engine_kill_switch` to `enabled: true` instead (AT-0032-6).
- **Halt ingestion specifically (slower, requires redeploy):** set
  `FETCH_ENGINE_ENABLED=false` and redeploy the pipeline service.
- **Revert a bad deploy (not a publish-policy issue):** Cloud Run —
  `gcloud run services update-traffic fact-checker-ke-api
  --region=africa-south1 --to-revisions=<previous-revision>=100` (no
  rebuild, per ADR-0016's atomic-rollback design). Vercel — `vercel
  rollback --scope eric-gitangus-projects --project fact-checker-ke-web`
  (single-step only on Hobby, per `vercel-deploy.md`).
- **If a defamation complaint or takedown notice arrives:** this is not
  just a rollback — follow `docs/runbooks/legal-takedown.md` and
  `docs/runbooks/nc4-kill-switch.md` in addition to flipping the switch
  above, and treat ADR-0033's "Review triggers" (any
  defamation/ODPC/takedown correspondence → immediate terms/caveat
  review) as mandatory, not optional.

---

## Readiness gaps blocking go-live (summary — full detail in the audit doc)

**Status as of the go-live-plumbing PR (secret wiring + CORS + shadow-mode
seed): gaps #1 and #2 below, the two that were previously blocking, are
CLOSED.** What remains is #3-#6, none of which block a shadow-mode go-live
(real keys + a deploy, kill-switches frozen, nothing auto-publishes until
the deliberate step-5 un-freeze).

1. ~~**Blocking: `enactPublishDecision` not called from any production
   route.**~~ **CLOSED.** `services/api/src/lib/submission-orchestrator.ts`
   now calls it, wired into the live `POST /internal/hops/orchestrate`
   route — see §0's update and §2.4 above for the empirical proof (an
   integration test exercising the real route + a real spawned pipeline
   process).
2. ~~**Blocking: no Secret Manager containers or Cloud Run `secret_env`
   wiring for `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`,
   `GOOGLE_FACTCHECK_API_KEY`.**~~ **CLOSED**, plus two more this task's
   brief named (`REVERSE_IMAGE_API_KEY`, `REVALIDATE_SECRET`) — see §3.1.
   `terraform validate` passes against the new config (full `plan`/`apply`
   not run — this PR makes no real infra change, see its description).
   **`TRIAGE_FEED_URLS` remains unwired** (free, zero-key, not in this
   task's named scope) — see §3.1's note.
   **`X_API_BEARER_TOKEN`'s secret container was created (task scope) but
   deliberately left un-wired in `secret_env`** — no code reads it; see
   §3.1 and `secrets.tf`'s own comment on that module.
3. **Not blocking, but coverage-limiting: no real STT client exists**
   (`Transcriber` protocol has only a fake implementation). This narrows
   fetch-engine coverage to text-derivable claims (titles, descriptions,
   triage-feed text) until a real client ships — acceptable per ADR-0005's
   compliance-subset scoping, but worth the owner knowing explicitly
   before expecting audio-based claims to surface.
4. **Not blocking, process-only: no `ADVOCATE_SIGNOFF_COMPLETE`-style
   flag exists in code.** Treat advocate sign-off as a human/process gate
   (do not deploy ADR-0033's user-facing text, do not loosen Tier-C
   beyond mode (a)) until it is implemented and actually set, rather than
   assuming a flag exists to check.
5. **Not blocking, but worth closing soon: no admin HTTP route exists to
   flip either kill-switch** (unlike `maandamano`'s
   `POST /v1/admin/maandamano/kill-switch`) — flipping still goes through
   the one-off `tsx` script in step 2.1. Low-risk (the DB row is writable
   either way), but an HTTP route would be audit-loggable from the admin
   UI instead of requiring shell access to `$PROD_DATABASE_URL`.
6. **New, introduced BY this PR, tracked explicitly (not silent): a
   second system-actor convention.** `db/migrations/
   0014_safe_launch_shadow_mode_seed.sql` seeds a non-authenticatable
   `users` row (`system-seed@fact-checker-ke.internal`,
   id `00000000-0000-0000-0000-0000000000f0`) purely so the seeded
   `policy_flags` rows have a valid `updated_by` FK target. This mirrors
   `organizations`' fixed-UUID seed convention (0002) but is a new
   pattern for `users` specifically — worth a short ADR note or at least
   a one-line mention in `docs/architecture/overview.md` if a third such
   seed actor is ever added, so the convention doesn't silently
   multiply ad hoc.

See `activate-on-keys-audit.md` for the complete table (now updated with
the same status) and this PR's description for the exact secret names
created, the migration proof, and the Docker build/terraform-validate
results.
