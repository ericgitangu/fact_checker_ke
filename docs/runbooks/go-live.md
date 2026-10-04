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

**A second, deeper finding from this session's audit (read as a gap, not
a reason to skip the freeze step — freeze first regardless):**
`services/api/src/lib/publish-enactment.ts#enactPublishDecision` is the
*only* place in the codebase that actually checks either kill-switch
before writing `isDraft=false` to a `checks` row — and it is currently
**called only from integration tests**, never from a production route.
No route in `services/api/src/routes/*.ts` calls
`services/pipeline`'s `/hops/verify` and then feeds its
`PublishDecisionPayload` into `enactPublishDecision`. Practically, this
means: **today, nothing in the live HTTP path can auto-publish at all,
because the wiring that would act on a verify-hop's publish decision
does not exist yet** — the risk described above is latent until that
wiring lands, not live today. This is tracked as a blocking gap in
`activate-on-keys-audit.md` (§"Gap: publish-enactment is not wired into
any live route") and does not change the order below: freeze the
switches first regardless, because (a) the gap could be closed by
another change between now and go-live without this runbook being
re-read, and (b) flipping the switches is free and reversible, so there
is no reason to rely on an absence-of-wiring as a safety net.

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
halts ingestion"). Set it explicitly in the Cloud Run env (not just via
`--set-secrets`, since this is non-secret config) when you create the
service in step 4, rather than leaving it at the implicit default:
```
--set-env-vars FETCH_ENGINE_ENABLED=false
```
Only remove this once you deliberately decide to un-freeze (step 5).

### 2.3 Decide Tier-C mode's policy_flags row now, if not mode (a)

If step 1.2 chose mode (b) for specific entities/topics, write the
corresponding `tier_c_mode` policy flags **now**, before keys, through
`updatePolicyFlag` (same reasoning as 2.1 — audit-logged, no raw SQL).
Leave it as mode (a) (the implicit default; no row needed) if 1.2 did
not call for a stricter mode.

### 2.4 Confirm the freeze actually blocks (closes the loop before trusting it)

Given §0's finding that `enactPublishDecision` is not yet wired into any
live route, **the freeze above cannot be verified against a real
end-to-end publish today** — there is no live path to exercise. Record
that explicitly rather than claiming it was tested:
- If the wiring lands before go-live: re-run this step and verify with a
  real (test-data) submission that a would-be auto-publish is blocked
  and audit-logged as `check.auto_publish_blocked`.
- If it has not landed by go-live: this is a **blocking gap**, not a
  green light — see §6 "Rollback" and the audit doc's gap list. Do not
  proceed past step 1-2 into step 3 (adding real keys) while this gap is
  open, because the absence of a publish path is not the same as a
  verified-safe publish path; closing the gap is itself part of
  "wiring the keys so they just work" per this task's own framing.

---

## 3. Wire keys (after step 2 is verified)

Full per-client table in [`activate-on-keys-audit.md`](./activate-on-keys-audit.md).
Summary of the exact sequence per key — **never echo a secret value in a
shell history, log, or this runbook**:

```bash
# 1. Create (or confirm) the Secret Manager container — Terraform owns
#    containers only, never values (ADR-0016). New containers for
#    ANTHROPIC_API_KEY / YOUTUBE_API_KEY / GOOGLE_FACTCHECK_API_KEY do
#    NOT exist in infra/terraform/envs/prod/secrets.tf today — see the
#    audit doc's gap list. Add the module blocks there first (a doc
#    change this task may make — see §"Readiness gaps" below), then:
terraform -chdir=infra/terraform/envs/prod plan -out=plan.out
bash infra/terraform/policy/plan-guard.sh plan.out   # must pass before apply
terraform -chdir=infra/terraform/envs/prod apply plan.out

# 2. Add the secret VALUE, no-echo, from stdin (established pattern,
#    ADR-0016 "First real deploy" section):
printf '%s' "$ANTHROPIC_API_KEY" | gcloud secrets versions add fact-checker-ke-anthropic-api-key \
  --data-file=- --project=master-crossing-435409-r1
printf '%s' "$YOUTUBE_API_KEY" | gcloud secrets versions add fact-checker-ke-youtube-api-key \
  --data-file=- --project=master-crossing-435409-r1
# Optional, paid: Google FactCheck Tools API key (used today by
# make_factcheck_client as the retrieval source, ADR-0004 step 4 — not
# itself part of the ADR-0032 fetch engine but shares this step):
printf '%s' "$GOOGLE_FACTCHECK_API_KEY" | gcloud secrets versions add fact-checker-ke-factcheck-api-key \
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

Today, `infra/terraform/envs/prod/cloud_run.tf`'s `secret_env` maps only
wire `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
into the `api_service` and `pipeline_service` modules. **None of
`ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, `GOOGLE_FACTCHECK_API_KEY`, or
`TRIAGE_FEED_URLS` are wired today.** Before the owner's keys will
"just work," `cloud_run.tf`'s `pipeline_service` module call needs
additional `secret_env` entries (for the three secrets) and
`TRIAGE_FEED_URLS` needs either a plain env var (it's a list of URLs,
not a secret) or its own secret container if the owner prefers not to
commit it in a `.tfvars` file. This is flagged as a readiness gap below
(§"Readiness gaps blocking go-live") — the recommended fix (adding
`secret_env` entries, following the exact pattern the three existing
entries already use) is a small, additive, no-cost Terraform change this
task is in-scope to make if the owner wants it landed now (see
"Readiness gaps" for the actual decision taken this session).

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
   Confirm the `FETCH_ENGINE_ENABLED=false` env var from step 2.2 is
   still present on the deployed revision (it is not a secret, so it is
   plain `--set-env-vars`, not `--set-secrets`; verify it is not
   accidentally dropped by a Terraform var default):
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
6. **Confirm `services/api`'s CORS allow-list** (AT-0015-2, still
   unverified per the vercel-deploy runbook's deviation #7) actually
   includes both Vercel origins before calling this done.
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

1. **Blocking: `enactPublishDecision` (the kill-switch enforcement
   function) is not called from any production route.** The function
   and both kill-switch checks are correct and tested in isolation, but
   there is no live code path from a pipeline `/hops/verify` response to
   this function. Until this is wired, auto-publish cannot happen for
   real — which is *currently* safe by accident, not by the kill-switch
   actually being exercised. Closing this gap and then verifying the
   freeze (step 2.4) is a prerequisite for this runbook's safety
   guarantees to mean anything operationally.
2. **Blocking (for the affected secrets only): no Secret Manager
   containers or Cloud Run `secret_env` wiring exist yet for
   `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, or `GOOGLE_FACTCHECK_API_KEY`.**
   Only the four pre-existing DB/Redis secrets are wired
   (`infra/terraform/envs/prod/secrets.tf`, `cloud_run.tf`). Dropping a
   real Anthropic/YouTube key into `gcloud secrets versions add` today
   has nowhere to land without first adding the Terraform
   module blocks + `secret_env` map entries described in step 3.1.
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

See `activate-on-keys-audit.md` for the complete table and which of
these this session chose to fix vs. document-only (per the task's
"prefer documenting gaps over changing infra" instruction, no Terraform
file was changed by this session — see that doc's final section for the
one exception considered and why it was not taken).
