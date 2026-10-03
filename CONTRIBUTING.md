# Contributing to fact_checker_ke

This project is public for adoption, review, and portfolio signal
([ADR-0026](docs/adr/0026-open-source-boundary-licence.md)). Code
contributions are welcome under the process below. Read
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) first.

## Before you open a PR

- **No CLA. DCO sign-off is required instead.** Every commit must carry a
  `Signed-off-by: Your Name <you@example.com>` trailer, added automatically
  with `git commit -s` (or `git commit --amend -s` to fix a commit that's
  missing it). This is the
  [Developer Certificate of Origin](https://developercertificate.org/) — by
  signing off, you certify you wrote the contribution or otherwise have the
  right to submit it under this project's licence. A DCO is sufficient for
  a solo-owned Apache-2.0 project; it costs the contributor nothing to
  satisfy (no separate agreement to sign) and costs the maintainer nothing
  to administer (checked mechanically, not by hand).
- **Conventional Commits.** Commit subjects follow
  `type(scope): summary` — `feat`, `fix`, `docs`, `chore`, `refactor`,
  `test`, `build`, `ci`. Enforced locally by a `commitlint` git hook
  (lefthook) and checked again on the PR title.
- **No AI attribution in commits or PR descriptions.** Do not add
  `Co-Authored-By: Claude` (or any other AI-tool attribution) to a commit
  message or PR body, regardless of what tooling you used to help write
  the change. The `commit-msg` hook rejects a message containing
  `Co-Authored-By` or `Generated with` (ADR-0013 AT-0013-A/B). This is a
  project-level rule, not a judgment on AI-assisted work — use whatever
  tools you want, just don't attribute the commit to them.
- **Branch naming and lifetime** follow
  [ADR-0013](docs/adr/0013-git-workflow.md): `feat|fix|chore|docs|refactor/<scope>-<slug>`,
  cut from the latest `origin/main`, rebased (not merged) onto `main`
  before review, short-lived (roughly 2 days for a solo-maintainer cadence;
  external contributors should expect similar scope per PR).

## Setting up

```bash
pnpm install        # installs deps and runs `lefthook install` via the
                     # root `prepare` script (gitleaks + lint + commitlint
                     # hooks)
cp .env.example .env # per-service; see each service's README for required vars
```

## Running the gates locally

These are the same gates CI will eventually run (GitHub Actions billing is
currently locked on this account per ADR-0013 — see "Known gap" there —
so local gates are the **real** gate today, not a convenience):

```bash
moon run :lint        # lint, affected projects
moon run :typecheck   # TypeScript project references
moon run :test        # unit + integration tests, affected projects
moon ci                # the full gate: lint + typecheck + test + build,
                        # affected projects — run this before opening a PR
```

Integration tests require a real Postgres connection (Neon `dev` branch
locally, or `pgvector/pgvector:pg16` via `docker compose`) and real Redis
semantics — they are never mocked, and they never skip silently when
`CI=true` and the DB URL is absent (ADR-0019 §5). If you don't have a Neon
branch, bring up the local compose stack:

```bash
docker compose --profile app up -d
```

Acceptance tests (AT suites) live under `scripts/at/at-<adr-number>.sh` and
exercise one ADR's acceptance-test table end to end, e.g.:

```bash
scripts/at/at-0013.sh
scripts/at/at-0017.sh
```

Python pipeline checks (`services/pipeline`) additionally run `pytest` and
`mypy` under `moon run pipeline:test` / `moon run pipeline:typecheck`.

## Red-team pass (required before merge)

Per [ADR-0019](docs/adr/0019-test-strategy-redteam.md), every PR needs a
red-team pass — someone (human or an agent with no authoring context)
deliberately attacks the change against the standing checklist
(concurrency, malformed/adversarial input, abuse/rate-limit bypass, cost
blow-up, legal/safety edge cases, config drift) and either the attacks are
resolved with a new failing-then-passing test, or logged with a reason in
the PR body. Paste the actual RED (failing) and GREEN (passing) command
output in the PR — a described result is not evidence (ADR-0019 Definition
of done).

The [PR template](.github/pull_request_template.md) has the exact
sections: ADR/AT IDs touched, what changed, RED evidence, GREEN evidence,
red-team findings, deviations.

## Branch and PR flow

1. Cut a branch from `origin/main`: `git checkout -b feat/<scope>-<slug>
   origin/main`.
2. Make the change; commit with DCO sign-off and a Conventional Commits
   subject.
3. Rebase onto the latest `main` before opening the PR (never merge `main`
   into your branch — ADR-0013 §1).
4. Open the PR against `main`, fill in the template, run `moon ci` and the
   relevant AT script(s) and paste their output.
5. This repo currently requires **0 approving reviews** on `main`'s
   ruleset (ADR-0013 §5 — a solo owner can't approve their own PR) — the
   red-team pass recorded in the PR body **is** the review. An external
   contributor's PR should still expect the maintainer to read it closely
   and may get review comments even without a blocking "requires changes."
6. Squash-merge or rebase-merge only — `main` has no merge commits
   (linear history, ADR-0013 §2).

## What you can't change without an ADR amendment

Decisions with a published ADR (`docs/adr/0001` through `0030`) are not
re-litigated in a feature PR. If your change conflicts with an existing
ADR's decision, open an issue or a new/amending ADR first — see
[docs/adr/README.md](docs/adr/README.md) for the index and
[ADR-0019](docs/adr/0019-test-strategy-redteam.md) for how a decision
gets an acceptance-test ID.

## Code style

See `CLAUDE.md`/project conventions for per-language idioms. In short:
typed errors over exceptions where the language supports it, no
`console.log`/`print` in production code paths, all inputs validated at
the API boundary, no N+1 queries, no secrets in code.
