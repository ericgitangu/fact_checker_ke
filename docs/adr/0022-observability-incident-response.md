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
