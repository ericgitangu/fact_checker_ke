<!--
ADR-0013 / ADR-0019: every PR implementing (or amending) an ADR must show
RED -> GREEN evidence for that ADR's acceptance tests, plus a red-team pass.
Zero required approvals (ADR-0013 #5) -- this template IS the review.
-->

## ADR

- Implements / amends: <!-- e.g. docs/adr/0014-monorepo-tooling-moon.md -->
- Acceptance test IDs touched: <!-- e.g. AT-0014-1..5 -->

## What changed

<!-- One paragraph: what, and why this approach over the alternatives. -->

## RED evidence

<!-- Paste the failing-test output captured *before* implementation
     (ADR-0019 #2: "write the failing test first and run it"). -->

```
<paste RED output here>
```

## GREEN evidence

<!-- Paste the passing output after implementation. Include the real
     command, not a description of what it "should" show. -->

```
<paste GREEN output here>
```

## Test plan

- [ ] Unit tests pass (`moon run :test` / `uv run pytest`)
- [ ] Typecheck passes (`moon run :typecheck`)
- [ ] Integration tests pass against a real Postgres (not skipped)
- [ ] `moon ci` is green on the affected set
- [ ] Contracts drift gate is clean (`moon run core:gen-contracts && git diff --exit-code`)
- [ ] Container images build and pass a healthz dry run (if Dockerfiles changed)

## Red-team findings

<!-- ADR-0019 #4: a reviewer attacks the change with edge-case REDs. List
     each attack tried from the standing checklist (concurrency, input,
     abuse, cost, legal/safety, config) and its result -- "no finding",
     "fixed", or "ticketed: <link/reason>". Do not leave this section
     empty or boilerplate. -->

| Attack | Result |
|---|---|
|  |  |

## Deviations / known gaps

<!-- Anything shipped as a documented shortcut or deferred, with the risk
     and the real fix (ADR-0019 "No silent tech debt" -- surfaced, not
     buried). "None" is a valid answer if true. -->
