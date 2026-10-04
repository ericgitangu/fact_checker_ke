# Activate-on-keys audit: will dropping real keys actually activate the client?

**Revision note (go-live-plumbing PR):** the table below and the two gap
sections after it are the ORIGINAL audit, left intact (per CLAUDE.md's
"edit additively" rule — nothing here was deleted). Two things it
documents as blocking are now CLOSED by that PR; read each row's text as
historical ("no secret container exists") alongside this note:

- **Secret containers + Cloud Run wiring for `ANTHROPIC_API_KEY`,
  `YOUTUBE_API_KEY`, `GOOGLE_FACTCHECK_API_KEY` now exist** —
  `infra/terraform/envs/prod/secrets.tf`'s `secret_anthropic_api_key`,
  `secret_youtube_api_key`, `secret_google_factcheck_api_key` modules +
  matching `pipeline_service.secret_env` entries in `cloud_run.tf`. Two
  more the same PR's brief named are wired the same way:
  `REVERSE_IMAGE_API_KEY` (pipeline) and `REVALIDATE_SECRET` (api). A
  container for `X_API_BEARER_TOKEN` was also created, but deliberately
  left un-wired in `secret_env` — the "X / Twitter API v2" row below is
  still accurate: no code reads any X-related env var yet.
  `TRIAGE_FEED_URLS` is still unwired (that row below is still fully
  accurate, unchanged by this PR — it wasn't in this task's named scope).
- **The "Gap: publish-enactment is not wired into any live route"
  section below is now CLOSED** — see that section's own update note.

Companion to [`go-live.md`](./go-live.md) step 3. ADR-0032 names the
"activate on owner's keys" pattern explicitly: each fetch-engine client
is a real implementation behind a Protocol, selected by a factory that
checks for the activating env var and falls back to a fake/stub when
absent — "fakes/fixtures fallback so the whole engine runs offline until
keys are supplied." This audit verifies, client by client, **by reading
the actual factory code** (not inferred from the ADRs) whether that
promise holds end-to-end: env var → client activates → Secret Manager
container exists → Cloud Run `--set-secrets` wiring exists. A green
row means "drop the key into the documented secret and it activates
unattended." Any other row names the exact gap.

## Audit table

| Client | Reads (exact env var) | Factory / call site | Secret Manager container exists? | Cloud Run `secret_env` wired? | Activates on key alone? | Gap |
|---|---|---|---|---|---|---|
| **YouTube Data API v3** (fetch engine, primary) | `YOUTUBE_API_KEY` (`YOUTUBE_API_KEY_ENV` constant, `services/pipeline/app/clients/youtube_fetch_source.py:30`) | `fetch_source_factory.py#make_fetch_sources`: `if os.environ.get(YOUTUBE_API_KEY_ENV): sources.append(YouTubeFetchSource())` — real client is constructed only when the var is set; otherwise `FakeFetchSource(platform="youtube")` | **No.** `infra/terraform/envs/prod/secrets.tf` defines only `database-url`, `database-url-direct`, `upstash-redis-rest-url`, `upstash-redis-rest-token`. | **No.** `cloud_run.tf`'s `pipeline_service.secret_env` map has no `YOUTUBE_API_KEY` entry. | **No — blocked on infra, not code.** The Python code is correct and will activate the instant the env var is non-empty in the running process; it will never see it in prod until the Terraform secret + `secret_env` entry exist. | Add `module "secret_youtube_api_key"` (mirrors the existing four modules exactly) + a `YOUTUBE_API_KEY = { secret = module.secret_youtube_api_key.secret_id }` entry in `pipeline_service.secret_env`. |
| **Triage feed (PesaCheck/Africa Check RSS/CKAN)** | `TRIAGE_FEED_URLS` (`TRIAGE_FEED_URLS_ENV` constant, `services/pipeline/app/clients/triage_feed_source.py:31`) — a comma/list-style value, **not a secret** (public feed URLs) | `fetch_source_factory.py#make_fetch_sources`, confirmed read end-to-end: `if os.environ.get(TRIAGE_FEED_URLS_ENV): sources.append(TriageFeedSource()) else: sources.append(FakeFetchSource(platform="triage_feed"))` — same real/fake split as YouTube. | N/A — not a secret. | **No.** No plain env var either — `cloud_run.tf`'s `pipeline_service` has no `TRIAGE_FEED_URLS` in its (currently secrets-only) env config. | **No — blocked on infra.** This is free and requires no owner key at all, only a config value (the feed URLs themselves), yet nothing wires it into the deployed service today. | Add a plain `env` entry (not `secret_env` — this is non-sensitive config) to the `pipeline_service` module/Cloud Run service spec. Lowest-effort, zero-cost, zero-risk gap to close. |
| **Anthropic LLM (Haiku + Sonnet)** | `ANTHROPIC_API_KEY`, plus optional `ANTHROPIC_HAIKU_MODEL` / `ANTHROPIC_SONNET_MODEL` overrides (`services/pipeline/app/clients/llm_anthropic.py:73,140`) | `make_llm_client`: constructs `AnthropicClient`, which lazily does `os.environ.get("ANTHROPIC_API_KEY")` only when `_ensure_client()`/a real call is first made — raises `LlmCompletionError` if unset at call time, never at import time. There is **no fake-client fallback inside this factory** for a missing key — confirm at implementation whether callers elsewhere default to a `FakeLlmClient` in dev/test only, or whether a prod call with no key simply errors per-call (the latter is what the code shows; verify which environment relies on which). | **No.** Same gap as YouTube — absent from `secrets.tf`. | **No.** Absent from `cloud_run.tf`. | **No — blocked on infra.** This is the highest-priority gap: every claim-detection and draft-verdict call depends on this key, for both engines. | Add `module "secret_anthropic_api_key"` + `secret_env` entry on `pipeline_service` only — confirmed via `grep -rn "ANTHROPIC_API_KEY" services/api/src` returning zero matches, so `services/api` never reads this var; it is pipeline-only today. |
| **Google Fact Check Tools API** (retrieval, ADR-0004 step 4 — adjacent to but not part of ADR-0032) | `GOOGLE_FACTCHECK_API_KEY` (`services/pipeline/app/clients/factcheck_api.py:74,149`) | `make_factcheck_client`: real `GoogleFactCheckClient` only when the var is set, else `FakeFactCheckClient` | **No.** | **No.** | **No — blocked on infra.** Same shape as YouTube. | Add `module "secret_factcheck_api_key"` + `secret_env` entry on `pipeline_service`. |
| **X / Twitter API v2** | n/a — **no env var exists because no real client exists** | `fetch_source_factory.py`'s own docstring: "X and TikTok... stay protocol+fake stubs ONLY in this slice — no real client exists to activate, by design, not by missing code." Confirmed: no `XFetchSource`/similar file exists under `services/pipeline/app/clients/`. | N/A | N/A | **No — code gap, not a key/config gap.** Dropping any X credential today activates nothing; there is no code to read it. | A real, budgeted X client (ADR-0032 §4's per-read monthly budget, "sample, don't firehose") must be written before this row can move past this gap. Out of scope for a docs/infra-audit task — flagging for the implementing team, not fixing here. |
| **STT (GCP STT v2 `chirp_2` provisional per ADR-0005, or any other provider)** | n/a — **no env var exists** | `services/pipeline/app/protocols/transcriber.py`'s own docstring: "Only a fake implementation exists in this skeleton (no real STT vendor call, no API keys)." `services/pipeline/app/fakes/fake_transcriber.py` is the only `Transcriber` implementation found. No `make_transcriber()`-style factory exists (unlike every other client above). | N/A | N/A | **No — code gap, not a key/config gap.** Same class of gap as X. | A real `Transcriber` implementation (GCP STT v2 client, selected by env var the way every other client here is) must be written. ADR-0005's Round-B eval (≥10 Sheng/code-switched, ≥10 noisy clips) is also still outstanding (AT-0005-1/-2 both RED) — the provider choice itself is only provisional pending that data. Out of scope for this docs/infra-audit task. |

## Gap: publish-enactment is not wired into any live route

**CLOSED as of the go-live-plumbing PR — re-verified empirically, not
assumed.** `grep -rln "enactPublishDecision" services/api/src --include="*.ts" | grep -v __tests__`
now returns `app.ts`, `lib/submission-orchestrator.ts`, and
`lib/publish-enactment.ts` itself. `submission-orchestrator.ts` calls
`services/pipeline`'s `/hops/analyze` then `/hops/verify` over real HTTP
and feeds the verify hop's publish decision into `enactPublishDecision`,
which is wired into the live `POST /internal/hops/orchestrate` route.
`services/api/src/__tests__/submission-orchestration-e2e.integration.test.ts`
proves this end-to-end (real relay, real route, a real spawned pipeline
process, fakes-only). **This means the risk this section originally
described is live, not latent** — go-live.md's step 2 freeze is doing
real work, confirmed by `services/api/src/__tests__/
safe-launch-seed.integration.test.ts` (a fresh-migrated DB reads both
kill-switches frozen) and by this same e2e suite, which now explicitly
unfreezes both switches in its own setup specifically because
`db/migrations/0014_safe_launch_shadow_mode_seed.sql` changed the shared
integration DB's default. The original finding is preserved below
unedited, for history:

Not a per-client activation gap, but the single most important finding
of this audit, repeated here for visibility (full detail in
`go-live.md` §0 and §2.4):

- `services/api/src/lib/publish-enactment.ts#enactPublishDecision` is
  the only function that checks `isAutonomousPublishFrozen` /
  `isFetchEngineFrozen` before actually flipping a `checks` row's
  `isDraft` to `false`.
- `grep -rln "enactPublishDecision" services/api/src --include="*.ts" | grep -v __tests__`
  returns **only the file that defines it** — no route calls it.
- `services/pipeline/app/stages/publish.py#finalize_publish` (the
  Python-side `decide_publish_policy` call site) is real and wired into
  `verify.py#run_verify_hop`, but its output (`PublishDecisionPayload`)
  has no consumer on the TS side today — no route forwards a verify-hop
  response into `enactPublishDecision`.
- **Practical effect:** today, the kill-switches are correctly
  implemented and independently testable, but there is no live code
  path that would need them — auto-publish cannot happen for real yet,
  for reasons unrelated to the kill-switch defaults. This is a
  *different* risk shape than "the kill switch is leaky" (the ADR-0007
  red-team C-7 pattern this codebase is otherwise careful about) — it's
  closer to "the kill switch has nothing to kill, yet." Closing this is
  almost certainly required before go-live produces any real published
  output at all, regardless of the kill-switch posture, and should be
  verified (not assumed) before trusting go-live.md's safety sequence
  operationally.

## Why no Terraform file was changed by this task

**Superseded by the go-live-plumbing PR** — that follow-up task's brief
explicitly asked for exactly the secret containers + `secret_env`/CORS
wiring this section declined to add, so they were added there (see the
revision note at the top of this doc). The reasoning below is kept
unedited as the record of why THIS session, under a narrower brief, made
the opposite call — read it as "why not yet, at the time," not as a
standing objection.

The task brief allowed touching `infra/terraform` only for "a concrete,
safe, no-cost readiness gap (e.g. a documented variable default)," with
an explicit preference for documenting gaps over changing infra, and a
hard constraint of no real keys/resources and no deploy/apply. The gaps
found above (new secret containers for `ANTHROPIC_API_KEY` /
`YOUTUBE_API_KEY` / `GOOGLE_FACTCHECK_API_KEY`, new `secret_env`/`env`
entries on `pipeline_service`) are each individually small and additive,
matching the "documented variable default" spirit — but:

1. Adding a `secret_manager_secret` container for a secret whose value
   doesn't exist yet is safe (no cost, no resource created until
   `enable_services=true` and a value is added), **but it is still a
   real infra change this task was told to prefer documenting over
   making**, and the task's own constraints emphasise "prefer
   documenting gaps over changing infra."
2. These changes interact with `enable_services`'s gating in a way that
   deserves the owner's own review at the moment they're actually ready
   to add keys (the exact secret names, whether the Anthropic key is
   shared between `api_service` and `pipeline_service` or
   pipeline-only, and whether `TRIAGE_FEED_URLS` should be a Terraform
   variable with a real default list or left to `gcloud run services
   update --set-env-vars` at deploy time) — decisions better made in the
   same sitting as step 3 of `go-live.md`, not pre-emptively here.

**Decision: no Terraform file was changed.** Every gap above is
documented, with the exact module/file/line it needs and the existing
pattern to copy (the four pre-existing `module "secret_*"` blocks in
`secrets.tf` plus their `secret_env` entries in `cloud_run.tf`), so that
when the owner is ready, closing them is copy-and-extend work against a
named example, not a fresh design. If the owner wants these landed now
rather than at go-live time, that's a one-line ask away — this audit
intentionally stops short of making that call unilaterally.

## Summary: what blocks "drop keys and it just works"

**Updated status column added by the go-live-plumbing PR — the `Gap`/
`Blocks`/`Severity` columns are the original, unedited audit.**

| # | Gap | Blocks | Severity | Status |
|---|---|---|---|---|
| 1 | No Secret Manager container + `secret_env` wiring for `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, `GOOGLE_FACTCHECK_API_KEY` | Every fetch/verify LLM call, YouTube ingestion, FactCheck-Tools retrieval | Blocking | **CLOSED** — plus `REVERSE_IMAGE_API_KEY`/`REVALIDATE_SECRET`, see revision note at top |
| 2 | No wiring (not even a plain env var) for `TRIAGE_FEED_URLS` | Triage-feed ingestion (free, highest-signal source per ADR-0032) | Blocking (but trivial to close) | **Still open** — not in this PR's named scope |
| 3 | `enactPublishDecision` not called from any production route | All real auto-publish, regardless of kill-switch state | Blocking | **CLOSED** — see the gap section above |
| 4 | No real X client exists | X as a fetch source | Not blocking go-live (X was never required for this go-live) | Still open (a Secret Manager container was created ahead of time per this PR's brief; not wired, see §3.1 of go-live.md) |
| 5 | No real STT (`Transcriber`) implementation exists | Audio-derived claims from the compliant STT subset | Not blocking go-live for text-derivable claims; blocks audio coverage specifically | Still open, unchanged |
| 6 | No `ADVOCATE_SIGNOFF_COMPLETE`-style flag in code | Automated enforcement of ADR-0033's publish gate — currently a process-only control | Not a code blocker, but a real process gate that must be honoured manually | Still open, unchanged |
