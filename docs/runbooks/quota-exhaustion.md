# Runbook: quota exhaustion (QStash / Neon / Upstash)

Implements [ADR-0022](../adr/0022-observability-incident-response.md)'s
alert set and runbook requirement (AT-0022-4). Covers the three free-tier
ceilings that bind before compute does (see
[ADR-0029](../adr/0029-cost-model-runway.md)'s "which binds first" table):
QStash (1,000 msgs/day — the tightest by roughly two orders of magnitude),
Upstash Redis (500K commands/month), and Neon (100 CU-h/month).

## Trigger

A 70%-of-quota alert fires (ADR-0022 decision 3):
- QStash daily message count ≥ 700/day
- Neon compute-hour burn ≥ 70 CU-h, checked daily
- Upstash command count ≥ 350K/month

This is the **early warning**. ADR-0011's cost/abuse breaker is the hard
stop at 100%. Treat a 70% alert as "act today," not "act this week" — the
gap between 70% and the breaker can close in hours during a viral event
(red-team C-3).

## What degrades first (by design)

Per ADR-0011, the pipeline is built to degrade gracefully rather than
fail hard:
1. New submissions keep being accepted and written to the outbox (Neon
   write path is cheap and not the binding constraint).
2. QStash dispatch of the `analyze`/`verify` hops is what throttles —
   submissions pile up "queued for review" rather than being dropped.
3. The editor-facing queue shows the backlog; nothing silently disappears.

## Step 1 — confirm which quota is actually binding

```bash
# QStash: check today's message count against the 1,000/day cap
curl -s -H "Authorization: Bearer $QSTASH_TOKEN" \
  https://qstash.upstash.io/v2/stats | jq .

# Upstash Redis: command count this month (console or REST)
curl -s -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  "$UPSTASH_REDIS_REST_URL/info" | jq .

# Neon: compute-hour burn this month
neonctl projects get <project-id> --output json | jq '.project.compute_last_active_at'
```

Don't assume the alert's named quota is the only one near its ceiling —
check all three; a viral spike typically stresses QStash and Upstash
together (more submissions → more pub/sub fan-out and rate-limit checks).

## Step 2 — shed load without losing in-flight submissions

**Do not** delete or truncate the outbox or any queued row — every
unpublished row represents a real user submission that must eventually
process or be explicitly, visibly marked as rejected (never silently
dropped).

In order of preference (least destructive first):

1. **Tighten the per-IP/per-device submission rate limit** (Upstash-backed,
   ADR-0018) temporarily, via the config flag — this reduces new inbound
   load without touching anything already queued.
2. **Pause the outbox sweeper's retry backfill** (not the inline relay) if
   DLQ/retry traffic is itself a meaningful share of QStash volume —
   retries count against the same 1,000/day cap (ADR-0009 r2).
3. **Raise the vendor limit manually** if this is sustained, not a spike:
   - QStash: Upstash console → project → upgrade tier (pay-as-you-go
     above free tier) — this is a cost decision, not a silent default; get
     explicit sign-off before flipping it, per the cost-discipline hard
     rule (no always-on spend without a stated reason).
   - Neon: confirm the sweeper interval isn't pinging more often than
     hourly (ADR-0009/0017 C-4) before assuming burn is submission-driven;
     an accidentally-frequent healthcheck is a common silent cause.
   - Upstash Redis: check whether SSE pub/sub fan-out (one publish per
     connected viewer per event, ADR-0018) is the actual driver before
     upgrading — a hot check page with many concurrent viewers can spend
     this budget faster than submission volume would suggest.
4. **As a last resort**, flip the submission endpoint to
   "queued, delayed processing" mode (if implemented) so the UI tells
   submitters their check will take longer, rather than either silently
   dropping requests or quietly burning past the free tier into
   uncontrolled spend.

## Step 3 — after the spike

- Confirm the outbox has fully drained (`oldest unpublished row` back
  under the 15-minute alert threshold).
- Record the incident: peak rate, which quota bound, what was done, and
  whether a vendor tier change was made (if so, that's a cost-model input
  — update [ADR-0029](../adr/0029-cost-model-runway.md)'s fixed floor).
- If a rate limit was tightened in step 2, revert it once traffic is
  back to baseline — a permanently tightened limit is itself a silent
  product regression.

## Related

- [ADR-0009](../adr/0009-runtime-topology.md) — free-tier figures
- [ADR-0011](../adr/0011-ai-cost-controls.md) — the hard breaker at 100%
- [ADR-0017](../adr/0017-event-driven-core.md) — outbox/sweeper mechanics
- [ADR-0029](../adr/0029-cost-model-runway.md) — cost model, which quota
  binds first and why
