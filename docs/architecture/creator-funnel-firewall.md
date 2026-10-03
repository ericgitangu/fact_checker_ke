# Creator-funnel conflict-of-interest firewall (process reference)

Practical, process-level companion to
[ADR-0030](../adr/0030-creator-funnel-conflict-of-interest.md), which has
the full evidence and decision record. This page is the day-to-day
checklist for anyone (currently: the founder) operating the
YouTube/TikTok creator funnel that references fact_checker_ke checks.

## Why this exists

A monetized founder channel that earns from trending rumours creates a
direct incentive about *which* claims get checked and how fast — breaking
[ADR-0012](../adr/0012-monetization.md) §5's rule ("monetization can never
affect which claims get checked or how they are rated") the moment the
funnel exists, unless process gives that rule enforcement instead of
leaving it as an aspiration. This page is the enforcement.

## The three rules

### 1. Source restriction — published-only

The funnel may only reference, narrate, or build content around checks
that already carry a **published, human-approved verdict**. A draft, an
in-review claim, or a "trending but unchecked" item can never appear in
funnel content framed as a fact-check — no exceptions for speed.

**Before publishing any funnel post:** confirm the check's
`published_at` timestamp exists and predates the planned post time. If
it doesn't exist yet, the post waits.

### 2. Editorial independence from funnel metrics

The editor queue, claim-priority ordering, and dedup/reuse logic
(ADR-0004, ADR-0011 §6) never read funnel view counts, funnel revenue, or
"what's trending on the founder's channel" as an input signal.

- **Today** (solo founder): this is self-discipline — a process rule, not
  a code-enforced one. If you catch yourself prioritizing a claim's review
  order because "it would make a good video," that's the violation this
  rule exists to name, even though nothing technical stops it yet.
- **Once a second editor joins**: this upgrades to a structural rule —
  the queue-prioritization code path takes no parameter sourced from
  funnel analytics, enforced by review/lint, not just by trust. Any
  future change adding such a parameter requires a published ADR
  amendment, never a silent code change.

### 3. Audit trail

Every piece of funnel content that references a specific check logs a
row:

```
{ check_id, published_at, funnel_post_url, posted_at, ai_disclosed: bool }
```

in a lightweight append-only table. This turns "the funnel only ever
posted about already-published checks" into a checkable claim (AT-0030-1)
rather than an unverifiable assertion.

## AI-content disclosure checklist (per post)

Before publishing a funnel video, ask:

- [ ] Does this use an AI voice clone reading the published verdict text
      aloud? → **Disclose** (YouTube description-panel text / TikTok AI
      label). Default to disclosing — the funnel's whole premise is
      narrating real claims about real people, which is squarely inside
      both platforms' "AI voice of a real person" disclosure trigger.
- [ ] Does this use a synthetic face / reenactment? → **Disclose.**
- [ ] Is AI assistance limited to script/caption/outline generation, no
      synthetic voice or face? → No disclosure required (both platforms
      exempt AI-assisted *production*, only realistic synthetic
      *content* triggers the label).
- [ ] Record the outcome in the audit table's `ai_disclosed` field either
      way — a `false` is itself an auditable claim, confirmed by spot-check
      before each posting batch (AT-0030-3).

## Revenue disclosure

Funnel ad/creator-fund/sponsorship revenue, however small, is listed on
the same funding-transparency page that ADR-0008 §3 and ADR-0012 already
require for sponsorships and grants. A reader checking "who funds this"
sees the funnel income in the same place — it is never a separate,
harder-to-find disclosure.

## What the funnel never says

Checks rate claims, never accounts or people
([ADR-0030](../adr/0030-creator-funnel-conflict-of-interest.md) §"per-
account gaming interaction", ties to ADR-0008 C-14). The funnel can never
present a published check as `"fact_checker_ke verified @handle"` —
only `"fact_checker_ke checked this specific claim, dated <date>."` This
is also enforced at the trademark/badge layer — see
[TRADEMARKS.md](../../TRADEMARKS.md).

## Acceptance tests

See [ADR-0030](../adr/0030-creator-funnel-conflict-of-interest.md#acceptance-tests)
(AT-0030-1 through AT-0030-5) for the full, currently-RED acceptance-test
table this process is built to eventually satisfy mechanically, not just
by discipline.
