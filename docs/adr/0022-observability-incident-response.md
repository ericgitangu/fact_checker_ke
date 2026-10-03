# ADR-0022: Observability and incident response

**Status:** Proposed · **Date:** 2026-10-03 · Builds on ADR-0009/0016/0017 cost guardrails

## Problem
ADR-0009/0016 only define billing budgets. Nothing today alerts on the things most likely to actually take the product down or silently break it: QStash/Neon/Upstash quota burn (ADR-0009's free tiers), a non-empty DLQ (kept 3 days per QStash, ADR-0009 r2), an outbox that stops draining (ADR-0017), or Neon failing to suspend (red-team C-4, which would burn the 100 CU-h/month free compute and take the DB offline mid-month). There is also no runbook for the four events most likely to hit a solo founder: quota exhaustion, a legal takedown, an NC4-type public-safety order (ADR-0007 kill switch), and a leaked credential.

## Evidence
- Cloud Logging: "the first 50 GiB of log data per project per month" is free; $0.50/GiB after, no retention charge within the default 30 days **[V: cloud.google.com/logging/pricing via Google's own blog summary, fetched 2026-10-03]**.
- Sentry free Developer plan: "5k errors" per month, "One user" account, 30-day lookback, explicitly "For solo devs working on small projects" **[V: sentry.io/pricing, fetched 2026-10-03]**.
- Cloud Error Reporting is bundled into Cloud Logging/Monitoring pricing, no separate free allotment confirmed **[GAP]**.
- QStash free tier: 1,000 messages/day, DLQ retained 3 days **[V2-PRIMARY, inherited from ADR-0009 r2]**.
- Neon suspends after 5 min idle; any touch inside that window keeps it awake and can exceed the 100 CU-h/month free compute (red-team C-4, [I: assumes 0.25 CU minimum]).
- Red-team amendment #13: "Alerts: DLQ non-empty, outbox oldest row over 15 min, QStash/Neon/Upstash over 70%, error rate."

## Options
1. **Cloud Monitoring + Cloud Logging only (GCP-native).** Viable for infra metrics, but has no good "unhandled exception with stack trace and user context" experience, and Error Reporting's free-tier numeric limit is a **[GAP]**.
2. **Sentry free Developer plan only.** 5k errors/month is tight for a public submission endpoint under abuse (red-team shows 400 unique paraphrases in a single incident), and it's 1 user — fine for a solo founder, but no infra/DB metrics.
3. **Both, each doing what it's good at. Recommended.** Cloud Logging/Monitoring for infra and quota metrics (it's already the platform you're deployed on, so it's zero extra integration); Sentry free tier for application-level error aggregation and stack traces, sized against the 5k/month cap with sampling if abuse traffic risks exceeding it.

## Decision (proposed)
1. **Cloud Logging** (50 GiB/month free) captures Cloud Run request/app logs. Structured JSON logs only (no `console.log`/`print` per senior-dev defaults), with `/maandamano/*` routes redacted per ADR-0021.
2. **Sentry free tier** for `services/api` and `services/pipeline` unhandled exceptions, with sampling (e.g. 100% of 5xx, 10% of handled-but-logged warnings) to stay under 5k errors/month; if abuse traffic threatens the cap, sampling tightens before upgrading — upgrading is a cost decision, not a silent default.
3. **Alerts (GCP Monitoring + Upstash/QStash consoles, cron-polled where no push webhook exists):**
   - QStash daily message count ≥ 70% of 1,000/day (ties to ADR-0011's existing breaker — this is the early warning, the breaker is the hard stop)
   - Neon compute-hour burn ≥ 70% of 100 CU-h/month, checked daily
   - Upstash command count ≥ 70% of 500K/month
   - DLQ depth > 0 for more than one sweep interval
   - Outbox oldest unpublished row > 15 minutes (relay or sweeper is stuck — red-team C-5/C-3)
   - 5xx error rate > a fixed threshold over 5 minutes (Sentry or Cloud Monitoring, whichever fires first)
   - Neon suspension check: a daily job confirms the DB *did* suspend during its lowest-traffic hour; alert if it never does (C-4's actual failure mode is silence, not a spike)
   All alerts page the founder's phone/email — there is no on-call rotation to page.
4. **Runbooks (one page each, in `docs/runbooks/`, not prose buried in an ADR):**
   - **Quota exhaustion** (QStash/Neon/Upstash near or at cap): what degrades first (ADR-0011's "queued for review"), how to manually raise a vendor limit or shed load, and the order of operations to avoid losing in-flight submissions.
   - **Legal takedown** (a court order or ODPC/advocate-directed removal): who can execute it (editor/admin role, ADR-0020), how it's logged (audit log, ADR-0020), and how a correction-vs-removal distinction is preserved for the IFCN record (ADR-0008).
   - **NC4 order / kill switch** (ADR-0007): exact steps to flip the flag, confirm CDN/SW propagation within 60s (ties to red-team AT-0007-A), and who has the authority to flip it back.
   - **Credential leak** (API key, DB connection string, QStash signing key): revoke-and-rotate order per secret, confirmed against GCP Secret Manager + Cloud Run `--set-secrets` (ADR-0009), and a gitleaks-confirmed scan of the commit history before declaring it closed.
5. **No new always-on resource.** All of the above is either included in platform free tiers or polled on a schedule that respects the cost-discipline hard rule (no NAT gateway, no min-instances>0, no dedicated monitoring VM).

## Trade-offs accepted
Two observability surfaces (Cloud Logging + Sentry) instead of one, for better signal-to-noise per surface; accepted because both are free at this scale and the integration cost is low (both are drop-in SDKs, not infra).

## Review trigger
Revisit if Sentry's 5k errors/month is routinely exceeded (tighten sampling or pay), or if Cloud Error Reporting's actual free-tier limit (currently [GAP]) turns out to make it redundant with Sentry.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0022-1 | A synthetic QStash usage of 700+ messages in a day fires the 70% alert before the ADR-0011 breaker engages at 100% | RED |
| AT-0022-2 | An outbox row left unpublished for 16 minutes (relay and sweeper both stalled, simulated in CI) fires the "outbox oldest row" alert | RED |
| AT-0022-3 | A non-empty DLQ for longer than one sweep interval fires an alert distinct from the generic error-rate alert | RED |
| AT-0022-4 | The runbooks directory contains a page for each of: quota exhaustion, legal takedown, NC4/kill switch, credential leak — a CI check fails the build if any is missing or empty | RED |
| AT-0022-5 | A day with zero traffic shows the Neon project transitioning to suspended state at least once, confirmed via the Neon API/console the next morning | RED |

## Implementation notes (2026-10-03)

The four required runbooks (decision §4) now exist under
`docs/runbooks/`: [`quota-exhaustion.md`](../runbooks/quota-exhaustion.md),
[`legal-takedown.md`](../runbooks/legal-takedown.md),
[`nc4-kill-switch.md`](../runbooks/nc4-kill-switch.md), and
[`credential-leak.md`](../runbooks/credential-leak.md) — each a
step-by-step operational page, not prose buried in this ADR, per the
original decision's own instruction. The credential-leak runbook
documents the real, already-occurred Upstash Redis credential exposure
recorded in ADR-0016 (line ~127) and gives it the procedure that ADR
flagged as missing at the time.

**AT-0022-4: GREEN** for the "runbooks directory contains a page for each
of: quota exhaustion, legal takedown, NC4/kill switch, credential leak"
behaviour — verified by `test -f` against all four paths above (none are
empty). The CI-enforcement half of AT-0022-4 ("a CI check fails the build
if any is missing or empty") is **not** added here — that's a workflow/CI
change out of scope for a docs-only pass.

**AT-0022-1/2/3/5** remain **RED** — they require the actual alerting
code/config (Cloud Monitoring policies, a synthetic QStash-usage test, an
outbox-stall simulation in CI) which is a code change, not documentation,
and is explicitly out of scope here (`apps/**`, `services/**`, `infra/**`
are owned by concurrent agents). Not claimed as done.

This ADR's own status is left as `Proposed` — the runbooks close one
specific acceptance test (AT-0022-4), not the ADR's broader alerting
decision, which still needs code to land.
## Implementation notes (2026-10-03) — observability-as-code (infra scope only)

This pass implements the parts of the Decision list that are expressible as Terraform today, in `infra/terraform/envs/prod/monitoring.tf`:

- **DLQ-non-empty and outbox-lag are not GCP/QStash/Upstash API metrics** — there's nothing to poll. The implemented pattern: the app (future work, `services/pipeline`/`services/api`, out of this change's `infra/**`-only ownership) emits one structured JSON log line per sweep/check, always (not just on breach), with a documented shape (`jsonPayload.signal` + a numeric field — see the Terraform file's doc comment for the exact contract). `google_logging_metric.dlq_non_empty` and `.outbox_lag` turn those log lines into Monitoring metrics; `google_monitoring_alert_policy.dlq_non_empty` and `.outbox_lag` alert on them. This is a log-based metric, not a poller — it adds zero new requests to Cloud Run, Neon, or Upstash, so it cannot affect the Neon wake budget (ADR-0016 amendment).
- **QStash/Neon/Upstash quota-percentage alerts and the Neon-suspension-check job are still open** — they need a scheduled checker (a Cloud Run Job on a schedule, or similar) that calls each vendor's usage API, which is application/ops-layer work, not infra-as-code in the narrow sense, and is explicitly out of this pass's scope. Flagged here, not silently dropped: AT-0022-1 and AT-0022-5 remain RED and need that follow-up work.
- **Dashboard:** `google_monitoring_dashboard.services` gives the two Cloud Run services (api, pipeline) a single view — request count by response class, p95 latency, and the two log-based signals above. It is not gated behind `enable_services`; a dashboard is a free, static JSON definition that renders empty tiles until real services/logs exist, which is expected.
- **Budget confirmation:** the $1/$5/$10 billing budget (`google_billing_budget.prod`, `envs/prod/budget.tf`) and the `healthz`-must-not-touch-the-DB rule (ADR-0016's Neon wake budget amendment, enforced at the application layer) are both already documented in ADR-0016 (see its Implementation notes and Red-team amendments sections) — confirmed present, not re-implemented here.
- **Runbooks directory (`docs/runbooks/`, AT-0022-4):** out of this infra pass's ownership — created by the docs pass (section above); AT-0022-4 GREEN.
- **Verification:** `terraform plan` (GCS backend, `enable_services=false`, `GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)`) reports 5 to add (2 log-based metrics, 2 alert policies, 1 dashboard), 0 to change, 0 to destroy. `policy/plan-guard.sh` passes this real plan and still fails `fixtures/violating-plan.json` (5 violations) and passes `fixtures/clean-plan.json` — none of the new resource types needed adding to `BANNED_TYPES` since none of them can be always-on or billable at idle.
