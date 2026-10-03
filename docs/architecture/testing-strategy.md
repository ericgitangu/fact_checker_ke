# Testing strategy (reference)

Practical, "how to run this" companion to
[ADR-0019](../adr/0019-test-strategy-redteam.md), which has the full
problem statement and decision record. This page consolidates the
RED → GREEN → REFACTOR discipline and the red-team practice into one
place a contributor can follow without re-reading the ADR each time.

## Why "tests pass" alone isn't trusted here

ADR-0019 exists because this exact repo already produced three classes of
false confidence: integration tests skipped silently, an agent reporting
a Neon branch migration that turned out to be empty, and a type upgrade
that broke a sibling package only at merge time. The fix isn't more
tests — it's **evidence** that a test can actually fail, captured before
it's made to pass.

## RED → GREEN → REFACTOR, observed

1. **Write the failing test first, and run it.** Not "write a test that
   should fail" — actually execute it and capture the failure.
2. **Record the RED failure message** in the PR. A test that can't
   possibly fail (e.g. asserts `true === true`) is caught at this step,
   not discovered later as dead coverage.
3. **Implement**, then **refactor with tests green**. Paste the GREEN
   command output too — described results aren't evidence.

## Test pyramid, by contract not implementation

| Layer | What it tests | Rule |
|---|---|---|
| **Unit** | Pure logic — classifiers, state machines, hashing, validation | Fast, no I/O |
| **Integration** | Real Postgres (Neon `dev` branch locally, `pgvector/pgvector:pg16` in CI), real Redis semantics | Never mock our own DB layer |
| **Contract** | `pnpm gen:contracts` drift gate; API ↔ pipeline event payload round-trip (TS produces, Python parses) | Catches the exact "type upgrade broke a sibling package" failure mode ADR-0019 cites |
| **End to end** | Compose stack (`--profile app`) + k6 smoke: submit → SSE events → ready | Exercises the real code path, not a replica |
| **Container** | hadolint, trivy (CRITICAL gate), healthz dry run | Catches image-level regressions before deploy |

## Red-team pass (required before merge)

A reviewer — human, or an agent with no authoring context — attacks the
change with edge-case REDs and adds each surviving attack as a failing
test. The standing checklist:

- **Concurrency**: duplicate delivery, two relays, a crash between commit
  and publish, out-of-order hops
- **Input**: empty, maximum size, unicode/RTL/Swahili diacritics, emoji, a
  URL with embedded credentials, SSRF targets (`169.254.169.254`,
  `localhost`, `file:`), oversized JSON, wrong content-type
- **Abuse**: rate-limit bypass via `X-Forwarded-For` spoofing,
  Idempotency-Key reuse with a different body, replayed QStash signature,
  oversized SSE fan-out
- **Cost**: retry storms, an LLM prompt-injection in a submitted quote
  steering the verdict, a cache-key collision
- **Legal/safety** (ADR-0007/0008): a named-person "False" without an
  evidence file, protest data at finer than ward granularity, PII in logs
- **Config**: missing env in production builds, migrations ahead of or
  behind the code

## Running the suites

```bash
moon run :lint
moon run :typecheck
moon run :test          # unit + integration, affected projects
moon ci                 # full gate: lint + typecheck + test + build
```

Acceptance-test (AT) scripts exercise one ADR's acceptance-test table end
to end against the real code path:

```bash
scripts/at/at-0013.sh
scripts/at/at-0014.sh
scripts/at/at-0016.sh
scripts/at/at-0017.sh
scripts/at/at-0018.sh
scripts/at/at-0023.sh
# ... one per implemented ADR; see scripts/at/ for the current set
```

Integration tests **never skip silently**: a missing DB URL with
`CI=true` is a hard failure, not a skip (ADR-0019 §5). Locally, a skip is
allowed only with a printed reason — if you see a silent skip in CI
output, that's a defect in the test runner config, not acceptable
behavior.

## Definition of done (ADR-0019 §6)

- The ADR's acceptance tests are green.
- Red-team findings are resolved, or ticketed with a stated reason.
- The full gate passes: `moon ci`, pytest, mypy, contracts-drift, image
  scan.
- Empirical evidence (actual command output) is in the PR — see
  [CONTRIBUTING.md](../../CONTRIBUTING.md)'s RED/GREEN evidence sections
  and the [PR template](../../.github/pull_request_template.md).
