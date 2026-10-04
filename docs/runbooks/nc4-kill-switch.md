# Runbook: NC4 order / maandamano kill-switch activation

Implements [ADR-0022](../adr/0022-observability-incident-response.md)'s
runbook requirement (AT-0022-4) and the mechanism specified in
[ADR-0007](../adr/0007-maandamano-tracker.md). Covers an NC4 blocking/
removal order under the 2025 CMCA amendments, or an escalation of
violence around a tracked protest, that requires freezing the maandamano
tracker without a deploy.

## Background — why this exists and why it's kept even after the ruling

The 2025 CMCA amendments gave the NC4 power to order websites/apps blocked
or removed with no judicial oversight (ADR-0007 evidence). A High Court
ruling (~2 Jul 2026, Nyaundi J) reportedly struck down the blocking
provision (s.6(1)) and the cyber-harassment provision (s.27(1))
**[V2-SECONDARY — judgment text not independently retrieved; re-verify
before treating this as settled if it becomes operationally relevant]**.
**The kill switch is kept regardless** — the ruling could be reinstated on
appeal, and other takedown routes (a direct court order, an ODPC
directive) remain available. Treat this runbook as live, not
aspirational.

## Who can execute this

Only the **`admin`** role (ADR-0020 §4) can flip the kill switch. At
current team size this is the founder.

## Step 1 — confirm the trigger

- **NC4 order**: a direct order or credible notice citing the CMCA
  blocking/removal power, or any formal government directive to freeze
  protest-related content. If there's any ambiguity about legitimacy,
  treat it like the legal-takedown runbook's triage step — forward to the
  advocate — but flip the kill switch first if there is a plausible safety
  reason to do so (see next bullet) rather than waiting on legal
  confirmation, since the switch is reversible and low-cost to flip.
- **Escalation of violence**: a tracked protest area's situation changes
  materially for the worse (e.g. live confirmed use-of-force against
  protesters) such that continuing to serve granular advisory data could
  put people at risk before the editorial team can responsibly re-curate
  it. This is a judgment call under time pressure — err toward freezing.

## Step 2 — flip the flag

The kill switch is the `maandamano_kill_switch` row in the existing
`policy_flags` table (ADR-0031 scaffold) — a runtime flag, not a deploy.
Flipping it must do all of the following — flipping only the DB flag
and stopping there reproduces red-team C-7 ("kill switch is leaky"):

1. **Flip the flag** — admin bearer token required:

   ```bash
   curl -X POST "$API_URL/v1/admin/maandamano/kill-switch" \
     -H "Authorization: Bearer $ADMIN_SESSION_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"enabled": true}'
   # -> { "key": "maandamano_kill_switch", "enabled": true, "revalidated": true }
   ```

   This goes through `updatePolicyFlag`
   (`services/api/src/lib/maandamano.ts#setMaandamanoKillSwitch`), which
   writes the `policy_flags` row AND an `audit_log` row in the SAME
   transaction — `action: 'policy.kill_switch_flipped'`, `target_type:
   'policy_flag'`, `target_id: 'maandamano_kill_switch'`, `metadata.value`
   the new boolean. A rolled-back flip leaves zero rows in either table.
   Route: `services/api/src/routes/maandamano.ts`, admin-only via
   `requireRole(auth, ["admin"])`.

2. **The flip already triggers the ISR/data-cache purge** — the route
   handler calls `triggerMaandamanoRevalidation`
   (`services/api/src/lib/maandamano-revalidate.ts`), which POSTs apps/web's
   webhook:

   ```bash
   curl -X POST "$WEB_URL/api/revalidate?tag=maandamano&secret=$REVALIDATE_SECRET"
   # -> { "revalidated": true, "tag": "maandamano" }
   ```

   (`apps/web/app/api/revalidate/route.ts`, secret-gated by
   `REVALIDATE_SECRET`, calls `revalidateTag("maandamano", { expire: 0 })`
   — Next 16's documented form for "the caller needs the data gone
   immediately" from a webhook/Route Handler, as opposed to `updateTag`
   which only works inside a Server Action.) The response's
   `revalidated` field (step 1's curl) tells you whether this succeeded —
   `false` means `WEB_BASE_URL`/`REVALIDATE_SECRET` are unset or the
   webhook call failed; the FLAG FLIP AND ITS ENFORCEMENT STILL HOLD
   either way (see step 3's first bullet), but check apps/web's env vars
   if you see `false` here.
3. **Server-side enforcement does not depend on steps 1-2's cache
   layers at all**: `GET /v1/maandamano` reads the flag fresh from
   Postgres on every request (`getMaandamanoAdvisories`,
   `services/api/src/lib/maandamano.ts`) — while frozen it returns
   `{ frozen: true, demonstrations: [] }` and NEVER queries the
   `demonstrations` table. The ISR/data-cache purge in step 2 only
   affects HOW FAST apps/web's rendered `/maandamano` page reflects
   that — the API itself has zero propagation delay.
4. **Confirm the PWA service worker's network-first policy for tracker
   routes** (`apps/web/app/sw.ts`, unconditional `NetworkOnly` on
   `/maandamano*` — not gated on the flag, always on) — verify on at
   least one real device/browser that a previously-cached session isn't
   serving an offline snapshot. Do not assume from the code path alone.

## Step 3 — verify within the 60-second target

Per AT-0007-A, tracker routes must return a frozen notice from **all
three** layers (API, apps/web's render, service worker) within 60
seconds of the flag flip — in practice the API is instant (step 2.3
above) and apps/web should be too once the webhook succeeds:

```bash
# API response (should reflect frozen state immediately, every time —
# this one has NO cache to propagate through)
curl -s "$API_URL/v1/maandamano" | jq '.frozen, (.demonstrations | length)'
# -> true
#    0

# apps/web's rendered page (reflects the API's state once the Data
# Cache entry for this fetch is purged — instantly if step 2.2's
# `revalidated: true`, within the normal revalidate window at worst)
curl -s "$WEB_URL/maandamano" | grep -o 'frozen-banner' || echo "NOT YET FROZEN — investigate"

# Service worker: open the tracker page in a browser with devtools,
# confirm the SW's network request for tracker routes shows
# network-first (not cache-first) in the Network panel — this is
# ALWAYS on (apps/web/app/sw.ts), independent of the flag.
```

If the API response (first check) isn't frozen immediately, that's a
defect in the flag flip itself — escalate as a bug against
`lib/maandamano.ts`, don't retry. If only the SECOND check lags past 60
seconds, that's the revalidation webhook (step 2.2) — check its
`revalidated` field from step 1 and apps/web's `REVALIDATE_SECRET` env
var before assuming it's just slow.

## Step 4 — what users see

The frozen notice should state plainly that the tracker is paused and
why, in general terms (legal order / safety escalation) — without
revealing operationally sensitive detail that could itself create risk.
This is an editorial call, not purely a technical one; involve editorial
judgment on the exact copy if there's time to do so, but don't delay the
technical freeze waiting for perfect copy.

## Step 5 — flipping back

Only the `admin` role can un-freeze, and only once the triggering
condition is resolved:
- NC4 order: lifted, successfully appealed against, or superseded by a
  court ruling confirmed through the advocate — not assumed from a news
  report alone.
- Safety escalation: editorial judgment that advisory-level (ward-
  granularity, delayed) data can resume safely.

Flipping back is the same `POST /v1/admin/maandamano/kill-switch` call
with `{"enabled": false}` — it repeats steps 2-3 (cache/SW propagation)
in reverse. A stale "frozen" notice continuing to serve after un-freeze
is the same class of defect as a stale live page continuing to serve
after freeze.

## Related

- [ADR-0007](../adr/0007-maandamano-tracker.md) — kill-switch mechanism,
  AT-0007-A
- [ADR-0018](../adr/0018-realtime-and-caching.md) — SSE/caching layer the
  SW interacts with
- [ADR-0020](../adr/0020-identity-auth-roles.md) — admin role, audit log
