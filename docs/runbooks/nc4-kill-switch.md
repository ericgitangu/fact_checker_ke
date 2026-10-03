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

The kill switch is a **runtime flag in the DB/edge config, not a deploy**
(ADR-0007 decision). Flipping it must do all three of the following —
flipping only the DB flag and stopping there reproduces red-team C-7
("kill switch is leaky"):

1. **Flip the flag** via the admin action (writes an `audit_log` row per
   ADR-0020 §5 — `action: 'kill_switch_activated'`, `target_type:
   'maandamano_tracker'`).
2. **Purge the ISR tag** for tracker routes so Vercel's CDN stops serving
   stale (pre-freeze) pages:
   ```bash
   # Revalidate/purge the tracker tag — exact invocation depends on the
   # revalidation helper wired in apps/web; confirm the tag name matches
   # what apps/web/app/maandamano/** actually registers before relying on
   # this command in a real incident.
   curl -X POST "$WEB_URL/api/revalidate?tag=maandamano&secret=$REVALIDATE_SECRET"
   ```
3. **Confirm the PWA service worker flips to network-first** on tracker
   routes, so a device that already cached the tracker doesn't keep
   serving a frozen snapshot offline-first. This should happen
   automatically once the flag is live (the SW checks the flag on
   revalidation), but verify it on at least one real device/browser — do
   not assume from the code path alone.

## Step 3 — verify within the 60-second target

Per AT-0007-A, tracker routes must return a frozen notice from **all
three** layers (CDN, API, service worker) within 60 seconds of the flag
flip:

```bash
# CDN/edge response
curl -sI "$WEB_URL/maandamano" | grep -i 'x-vercel-cache\|age:'

# API response (should reflect frozen state, not stale cached data)
curl -s "$API_URL/v1/maandamano" | jq '.frozen'

# Service worker: open the tracker page in a browser with devtools,
# confirm the SW's network request for tracker routes shows
# network-first (not cache-first) in the Network panel.
```

If any layer still serves pre-freeze content past 60 seconds, that layer's
cache/propagation is the actual incident — escalate it as a defect against
AT-0007-A, don't just wait longer.

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

Flipping back repeats steps 2-3 (cache/SW propagation) in reverse — a
stale "frozen" notice continuing to serve after un-freeze is the same
class of defect as a stale live page continuing to serve after freeze.

## Related

- [ADR-0007](../adr/0007-maandamano-tracker.md) — kill-switch mechanism,
  AT-0007-A
- [ADR-0018](../adr/0018-realtime-and-caching.md) — SSE/caching layer the
  SW interacts with
- [ADR-0020](../adr/0020-identity-auth-roles.md) — admin role, audit log
