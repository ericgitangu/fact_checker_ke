# Security, compliance, and operational posture

A reading guide (not a new decision) that ties together the open-source
boundary, observability, and cost-model ADRs for anyone evaluating this
repository from the outside — a contributor, a security researcher, or a
reviewer doing diligence. Companion to
[overview.md](overview.md) (system architecture) and the root
[README](../../README.md).

## Open-source boundary

[ADR-0026](../adr/0026-open-source-boundary-licence.md) draws the line
between what is public and what stays private:

| Public (this repo, Apache-2.0) | Private (never committed) |
|---|---|
| `apps/*`, `services/*` code | Credibility-registry scoring weights, source-trust tables |
| `packages/core` contracts/types | Abuse/rate-limit threshold *values* |
| Terraform plan-guard checks (`infra/`) | Production system-prompt variants (claim extraction, verdict drafting) |
| Test harnesses, AT scripts | — |

The project name, logo, and verdict-badge styling are reserved separately
from the code licence — see [TRADEMARKS.md](../../TRADEMARKS.md). Private
disclosure for vulnerabilities is [SECURITY.md](../../SECURITY.md);
contribution process (DCO, no CLA, Conventional Commits, no AI
attribution) is [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Observability and incident response

[ADR-0022](../adr/0022-observability-incident-response.md) layers two
free-tier observability surfaces rather than one:

- **Cloud Logging** (GCP-native, 50 GiB/month free) — infra and quota
  metrics, since the stack already runs on Cloud Run.
- **Sentry free Developer plan** (5k errors/month, 1 user) — application
  error aggregation and stack traces for `services/api` and
  `services/pipeline`.

Alerts fire at 70% of each free-tier ceiling (QStash, Neon, Upstash) as an
early warning ahead of ADR-0011's hard breaker at 100%, plus DLQ-non-empty
and outbox-lag alerts tied to the event-driven core
([ADR-0017](../adr/0017-event-driven-core.md)). The four operational
runbooks this feeds are in [`docs/runbooks/`](../runbooks/):

- [quota-exhaustion.md](../runbooks/quota-exhaustion.md)
- [legal-takedown.md](../runbooks/legal-takedown.md)
- [nc4-kill-switch.md](../runbooks/nc4-kill-switch.md)
- [credential-leak.md](../runbooks/credential-leak.md)

There is no on-call rotation — all alerts page the founder directly, which
is both a cost-discipline choice (no dedicated monitoring infrastructure)
and an honest reflection of current team size.

## Cost model

[ADR-0029](../adr/0029-cost-model-runway.md) is the single place the
scattered per-ADR costs (Vercel, Apple, Play, STT, LLM tokens, free
tiers) are reconciled into one fixed-floor-plus-variable-cost model. The
headline finding: **QStash's 1,000 messages/day free tier binds daily
check throughput before Cloud Run, Neon, or Upstash do** — by roughly two
orders of magnitude. Any capacity-planning or viral-spike conversation
should start from that constraint, not from compute.

## Creator-funnel firewall

[ADR-0030](../adr/0030-creator-funnel-conflict-of-interest.md) is the
process control that keeps the founder's own monetized YouTube/TikTok
channel from becoming a conflict of interest: the funnel can only
reference already-published, human-approved checks, editorial
prioritization never reads funnel analytics, and every funnel post that
cites a check is logged in an append-only audit table. See
[docs/architecture/creator-funnel-firewall.md](creator-funnel-firewall.md)
for the full process writeup.

## Testing and red-team practice

[ADR-0019](../adr/0019-test-strategy-redteam.md) is the project's testing
constitution: RED → GREEN → REFACTOR with the RED failure captured as
evidence, a standing red-team checklist attacking every change before
merge, and an explicit ban on integration tests skipping silently in CI.
See [docs/architecture/testing-strategy.md](testing-strategy.md) for the
consolidated reference version (practical "how to run this" companion to
the ADR's "why this" decision record).
