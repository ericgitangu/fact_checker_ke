# ADR-0013: Git workflow and branch hygiene

**Status:** Accepted (process set, owner, 2026-10-03) · **Date:** 2026-10-03

## Problem
Work happens in parallel: several agents in worktrees plus the founder. Integrating wave 1 surfaced three classes of defect that only appear at merge time:
- a hard-coded dependency graph in the API Dockerfile broke when `packages/db` landed
- a zod v4 type change broke Drizzle `pgEnum`s
- integration tests skipped silently while "passing"

We need rules that make every change *additive from a known base* and catch integration breaks before they reach `main`.

## Decision (proposed)
1. **Trunk-based development with short-lived branches.** `main` is always releasable. Work branches are cut from the **latest `origin/main`** and named `feat|fix|chore|docs|refactor/<scope>-<slug>`. A branch should live for at most about 2 days. Rebase onto `main` before merging, never merge `main` into a branch.
2. **Linear history.** Squash-merge or rebase-merge only, so `main` has no merge commits. Each commit on `main` builds and passes tests (bisectable).
3. **Conventional Commits**, enforced locally by commitlint in a `commit-msg` hook and on the PR title. No AI attribution in commit messages (owner rule).
4. **Local gates (lefthook):**
   - `pre-commit`: gitleaks on staged files, formatter and linter on staged files, contract codegen drift check when `packages/core/src/**` changes
   - `pre-push`: `moon ci` (affected projects only) plus the integration tests for affected services
5. **Remote gates (GitHub ruleset on `main`):**
   - require a PR
   - require linear history
   - block force-push and deletion
   - require status checks (CI, contracts-drift, docker-images) **once Actions billing is restored**
   - **Required approvals: 0.** A solo owner cannot approve their own PR, so review happens through the red-team step (ADR-0019) recorded in the PR body.
6. **Parallel-agent protocol:**
   - Each agent works in a worktree on a *named* branch cut from the current integration tip.
   - The integrator rebases or cherry-picks agent commits onto the tip **in dependency order** and re-runs the full gate after each integration.
   - Agents never edit files outside their declared ownership.
   - Shared contracts (`packages/core`, `packages/db` schema) are changed *before* fan-out, by the integrator, so agents build on them rather than racing.
7. **Integration tests never skip silently.** When `CI=true` and the database URL is absent, the run fails. Skipping is allowed only locally, with a printed reason.
8. **Repo hygiene:**
   - generated files are either committed with a drift gate (contracts) or ignored, never both
   - `.env*` is never tracked except `.env.example`
   - `CODEOWNERS`, a PR template with an ADR link, a test plan and red-team findings
   - Dependabot or Renovate for weekly grouped updates

## Trade-offs accepted
- Rebasing rewrites branch history. That's fine for unshared branches; agents' detached worktrees are integrated by cherry-pick.
- Zero required approvals weakens review. It's mitigated by the red-team step and CI gates, and revisited when a second maintainer joins.

## Known gap (2026-10-03)
GitHub Actions on the account is **locked by a billing issue**, so remote checks do not run. Until it's resolved, local gates plus `act` are the enforcement. Required status checks are switched on when CI runs again.

## Review trigger
Revisit when a second human contributor joins, or once Actions is restored.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #15 (README/hygiene wave, medium severity).

- **Turn on GitHub push protection before the repo goes public.** The repo is heading toward an OSS release (ADR-0001 Phase 0, D-U-N-S/entity clocks already started) with remote CI gates currently off and required approvals at 0 (section 5 above). Once Actions billing is restored and the repo is public, a fork PR on `pull_request_target` or a loosely-scoped WIF condition could mint deploy credentials (red-team C-12; see ADR-0016 amendments for the WIF-condition fix). Push protection (secret-scanning on push) must be enabled ahead of going public, independent of the Actions billing blocker.
