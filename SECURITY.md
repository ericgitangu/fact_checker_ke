# Security policy

fact_checker_ke is a Kenyan fact-checking product (see
[ADR-0026](docs/adr/0026-open-source-boundary-licence.md) for the
open-source boundary). It is a defamation and abuse target by design, so
security reports are taken seriously even though the team is one person.

## Reporting a vulnerability

**Report privately — do not open a public GitHub issue, discussion, or PR
for a security vulnerability.**

Email: **security@fact-checker-ke.pending.invalid** — placeholder until a
real domain/mailbox exists; until then, open a private GitHub security
advisory instead, via this repository's **Security** tab →
**Report a vulnerability**
(`https://github.com/ericgitangu/fact_checker_ke/security/advisories/new`),
GitHub's private-by-default channel — the preferred route regardless once
the mailbox above is live.

Include, if known:
- Affected component (`apps/web`, `apps/site`, `services/api`,
  `services/pipeline`, `infra/`, or the repo/CI itself)
- Steps to reproduce, or a minimal proof of concept
- Impact you believe this has (data exposure, auth bypass, injection,
  supply-chain, etc.)

**No public proof-of-concept.** Do not publish exploit code, demo videos,
or a write-up before coordinated disclosure completes (see window below).
Do not test against production data belonging to real submitters or
editors; use a local/dev environment.

## Response window

- **Acknowledgement:** within 5 business days.
- **Initial assessment** (severity, affected versions, fix timeline):
  within 10 business days of acknowledgement.
- **Coordinated disclosure target:** 90 days from acknowledgement, or
  sooner once a fix ships. If a fix needs longer (e.g. it depends on a
  third-party vendor patch), that is communicated to the reporter with a
  reason, not silently extended.
- Credit is given in the fix's release notes if the reporter wants it;
  anonymous reporting is also fine.

## Scope

**In scope:**
- `apps/*`, `services/*`, `packages/*`, `infra/*` as published in this
  repository
- The deploy rail and CI/CD configuration (`.github/workflows/**`,
  `scripts/deploy/**`) — see ADR-0026's fork-PR / `pull_request_target` /
  WIF-condition hardening requirements
- Authentication, rate-limiting, and the editor/admin RBAC path
  (ADR-0020)

**Out of scope (private, not in this repository):**
- The credibility-registry scoring weights and source-trust tables
  (ADR-0004)
- Abuse/rate-limit threshold *values* (ADR-0011 §6, ADR-0018 C-9) — the
  `CredibilityRegistry`/`AbuseThresholds` **types** are public, the
  production **values** are not, and are out of scope by design, not an
  oversight
- The production system-prompt variants for claim extraction and verdict
  drafting
- Third-party platforms this project integrates with (X, Threads, YouTube,
  TikTok, Vercel, GCP, Neon, Upstash) — report those directly to the
  vendor

## Known operational realities (not vulnerabilities, stated for context)

- GitHub Actions billing is currently locked on this account
  (ADR-0013), so remote CI status checks are not yet enforced; local
  gates (gitleaks, lint, `moon ci`) run pre-commit/pre-push instead.
  This does not change the disclosure process above.
- The project is solo-maintained. There is no 24/7 on-call; see
  [docs/runbooks/credential-leak.md](docs/runbooks/credential-leak.md)
  for the actual response procedure once a credential or secret leak is
  confirmed.
