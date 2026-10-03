# ADR-0026: Open-source boundary and licence

**Status:** Accepted (Apache-2.0; registry/thresholds/prompts private, owner, 2026-10-03) · **Date:** 2026-10-03

## Problem
The owner wants `github.com/ericgitangu/fact_checker_ke` public for stars and portfolio signal, while running a Kenyan fact-checking product that is a defamation and abuse target (ADR-0008, ADR-0019). A public repo with no licence boundary, no fork-PR isolation and no disclosure channel turns the codebase itself into an attack surface (red-team C-12, E7) the day it goes public, and an unclear licence either scares off the stars the owner wants or lets a competitor white-label the product with no attribution.

## Evidence
- GitHub secret scanning push protection is available free on all public repositories, and is on by default for *new* public repos created by personal accounts; existing public repos must enable it manually in Settings → Code security and analysis **[V: github.blog/changelog/2023-05-09-secret-scannings-push-protection-is-available-on-public-repositories-for-free/, docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection]**.
- `pull_request_target` runs with the base repo's secrets and permissions against a fork's code checked out — a well-documented supply-chain vector when combined with `actions/checkout` of the PR head **[I: GitHub's own Actions security hardening guidance; this repo does not yet use that trigger, so the rule is preventative]**.
- ADR-0013 already states "Actions billing is locked"; the WIF/OIDC condition it will need once Actions returns is a **[GAP]** today — this ADR sets the requirement, ADR-0016/0013 implement it.

## Options
1. **Permissive (Apache-2.0 or MIT).** Maximises stars, forks and resume value. Gives a copycat a free licence to clone the editorial brand without reciprocation; Apache-2.0 at least carries a patent grant and an explicit NOTICE mechanism that MIT lacks.
2. **Strong copyleft (AGPL-3.0).** Forces any hosted fork (including a SaaS competitor) to publish its modifications. Protects against silent commercial forks, but is a known deterrent to casual contributors and star-driven portfolio goals, and complicates any future dual-licensing or investor due diligence.
3. **Dual/open-core.** Core pipeline, contracts and infra under a permissive licence; a private `packages/registry` (credibility weights, abuse thresholds) and private prompt variants never published. Recommended: it gets the stars (public, permissive, easy to fork and read) while keeping the two assets that are actually valuable to a competitor or an attacker out of the repo.

## Decision (proposed): Option 3
- **Licence: Apache-2.0** for the published monorepo. Chosen over MIT for the patent grant (relevant given LLM/ML claims) and over AGPL because the owner's stated goal is adoption and stars, not preventing a hosted fork — revisit if a commercial clone appears (then AGPL or a source-available licence becomes the fallback, logged as a future option, not a retraction).
- **Stays private, never committed:** credibility-registry scoring weights and source-trust tables (ADR-0004), abuse/rate-limit thresholds (ADR-0011 §6, ADR-0018 C-9 limits), and the production system-prompt variants (claim-extraction and verdict-drafting prompts) — publishing exact thresholds and prompts hands an attacker a tuning guide for evasion (prompt injection, C-11 Sheng/opinion gaming). These live in a separate private repo or in GCP Secret Manager / Postgres config, referenced by interface only (`CredibilityRegistry`, `AbuseThresholds` types ship public; values do not).
- **Stays public:** the plan-guard Terraform checks (ADR-0016), pipeline architecture, contracts (`packages/core`), and test harnesses — these have no exploit value and are the actual portfolio showcase.
- **Trademark/badge policy:** "fact_checker_ke" name and logo are **not** licensed by Apache-2.0 (which is code-only); add a short `TRADEMARKS.md` reserving the name/badge, and require any fork to rename before using the brand on a check page or badge (closes C-14's "verified by fact_checker_ke" gaming vector at the licence layer).
- **GitHub settings before going public:** enable secret scanning + push protection in Settings → Code security (manual, since this repo predates the personal-account default) **[V, cited above]**; branch protection per ADR-0013; no `pull_request_target` anywhere in `.github/workflows`; when Actions billing is restored, the WIF provider's attribute condition must pin `assertion.repository_owner == 'ericgitangu'` and `assertion.ref == 'refs/heads/main'` so a fork PR's default `GITHUB_TOKEN` (read-only, no OIDC federation to GCP) can never mint a deploy credential — this is the same fix red-team amendment D-4/AT-0016-8 requires on the infra side; this ADR is the policy source, ADR-0016 is the implementation.
- **`SECURITY.md`:** private disclosure via a listed email (not a public issue), 90-day coordinated disclosure target, explicit scope note that the credibility registry and prompt internals are out of scope (private, not in this repo).
- **`CONTRIBUTING.md` + DCO, no CLA.** A DCO sign-off (`Signed-off-by` trailer, enforced by a lightweight Action/hook) is sufficient for a solo-owned Apache-2.0 project and costs nothing to administer; a CLA adds legal overhead with no counterparty benefit until there's a funded entity accepting outside contributions at scale.

## Trade-offs accepted
Apache-2.0 permits a well-resourced competitor to fork the public code and compete; the private registry/prompt split is the actual moat, not the licence. DCO-only (no CLA) means contributor IP representations are weaker than a CLA would give; acceptable at current scale.

## Irreversible
Once third parties depend on Apache-2.0-licensed releases, relicensing to AGPL cannot retroactively bind their existing copies (only new releases). Decide the licence before the first public release, not after stars accrue.

## Review trigger
Revisit if a commercial fork appears, if a funded entity needs CLA-grade IP assignment, or when GitHub Actions billing is restored (triggers the WIF condition work).

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0026-1 | Repo root contains `LICENSE` (Apache-2.0), `TRADEMARKS.md`, `SECURITY.md`, `CONTRIBUTING.md` with a DCO clause | RED |
| AT-0026-2 | `rg -i 'credibility.*weight|abuse.*threshold' --type-not=md packages/ services/` returns no hardcoded production values, only type/interface references | RED |
| AT-0026-3 | No workflow file under `.github/workflows/**` uses `pull_request_target`; any workflow checking out a fork head runs with zero secrets | RED |
| AT-0026-4 | GitHub repo settings (via `gh api repos/:owner/:repo`) report `secret_scanning.status == "enabled"` and `secret_scanning_push_protection.status == "enabled"` | RED |
| AT-0026-5 | Once Actions billing is restored, the WIF provider's attribute condition string in Terraform contains both `repository_owner` and `refs/heads/main` | RED |

## Implementation notes (2026-10-03)

Root-level OSS boundary artifacts landed on `docs/adr-0013-0019-platform`:
`LICENSE` (Apache-2.0, SPDX identifier line, copyright holder "Eric
Gitangu"), `TRADEMARKS.md` (name/logo/verdict-badge reservation, separate
from the code licence per decision §"Trademark/badge policy"),
`SECURITY.md` (private disclosure via GitHub security advisory, 90-day
coordinated-disclosure target, explicit private/out-of-scope list for the
credibility registry, abuse thresholds, and prompt variants),
`CONTRIBUTING.md` (DCO sign-off, no CLA, Conventional Commits, the
no-AI-attribution commit rule, `moon ci`/AT-script instructions, the
ADR-0013 branch/PR flow), and `CODE_OF_CONDUCT.md` (Contributor Covenant
v2.1, enforcement contact routed through `SECURITY.md`).

**AT-0026-1: GREEN** — `test -f LICENSE SECURITY.md CONTRIBUTING.md
CODE_OF_CONDUCT.md TRADEMARKS.md` all pass;
`rg -c 'Apache License' LICENSE` returns a non-zero count; `LICENSE`
carries an `SPDX-License-Identifier: Apache-2.0` line.

**AT-0026-2/3/4/5** remain **RED** — they require a code/CI/GitHub-settings
change (scanning `packages/`/`services/` for hardcoded values, auditing
`.github/workflows/**`, reading back live GitHub repo settings via `gh
api`, and a Terraform WIF condition string) that is out of scope for this
docs-only pass; owned by whichever agent next touches CI/infra/GitHub
settings. Not claimed here.
