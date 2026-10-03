# ADR-0019: Test strategy — ADR-derived TDD and red-team gates

**Status:** Accepted (process set, owner, 2026-10-03) · **Date:** 2026-10-03

## Problem
"Tests pass" has already proven unreliable on this repo:
- integration tests skipped silently
- an agent reported migrating a Neon branch that turned out to be empty
- a type upgrade broke a sibling package only at merge time

Correctness has to be demonstrated through the *real code path*, and every ADR decision needs an executable check.

## Decision (proposed)
1. **Every ADR decision gets an acceptance-test ID.** Each ADR ends with a `## Acceptance tests` table: `AT-<adr>-<n> | behaviour | test location | status`. A PR implementing an ADR must turn its ATs from RED to GREEN.
2. **RED → GREEN → REFACTOR, observed.**
   - Write the failing test first and *run it*.
   - Record the RED failure message in the PR, so a test that can't fail is caught.
   - Then implement, then refactor with tests green.
3. **Test pyramid by contract, not implementation:**
   - **Unit:** pure logic (classifiers, state machine, hashing, validation). Fast, no I/O.
   - **Integration:** real Postgres (Neon `dev` branch locally, `pgvector/pgvector:pg16` in CI) and real Redis semantics. No mocks of our own DB layer.
   - **Contract:** `pnpm gen:contracts` drift gate, plus an API ↔ pipeline event payload round-trip (TS produces, Python parses).
   - **End to end:** compose stack (`--profile app`), then k6 smoke: submit, receive SSE events, check ready.
   - **Container:** hadolint, trivy (CRITICAL gate), and a healthz dry run.
4. **Red-team pass before merge.** A reviewer (human or an agent with no authoring context) attacks the change with *edge-case REDs* and adds each surviving attack as a failing test. The standing checklist:
   - **Concurrency:** duplicate delivery, two relays, a crash between commit and publish, out-of-order hops
   - **Input:** empty, maximum size, unicode/RTL/Swahili diacritics, emoji, a URL with credentials, SSRF targets (`169.254.169.254`, `localhost`, `file:`), huge JSON, wrong content-type
   - **Abuse:** rate-limit bypass via `X-Forwarded-For` spoofing, Idempotency-Key reuse with a different body, replayed QStash signature, oversized SSE fan-out
   - **Cost:** retry storms, an LLM prompt-injection in a submitted quote steering the verdict, a cache-key collision
   - **Legal/safety (ADR-0007/0008):** a named-person "False" without an evidence file, protest data at finer than ward granularity, PII in logs
   - **Config:** missing env in production builds, migrations ahead of or behind the code
5. **Integration tests never skip in CI.** A missing DB URL with `CI=true` is a failure.
6. **Definition of done:**
   - the ADR's acceptance tests are green
   - the red-team findings are resolved or ticketed with a reason
   - the full gate passes (`moon ci`, pytest, mypy, contracts-drift, image scan)
   - empirical evidence (command output) is in the PR

## Trade-offs accepted
Slower PRs. That's the price of evidence-based "done" on a product whose credibility *is* its correctness.

## Review trigger
Revisit if PR cycle time exceeds about a day for small changes. Then trim the red-team checklist to risk-tiered subsets.
