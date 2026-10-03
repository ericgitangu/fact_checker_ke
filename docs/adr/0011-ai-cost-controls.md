# ADR-0011: LLM routing and cost controls

**Status:** Proposed · **Date:** 2026-10-03 · **Pricing figures are [GAP]: verify against Anthropic's pricing page before accepting**

## Problem
Token cost is the one cost that can't scale to zero. Live streams and viral spikes could blow up spend at the same moment the free tiers run out.

## Decision (proposed)
1. **Tiered routing.** A small model (Haiku-class) handles claim detection, classification and dedup confirmation. A frontier model (Sonnet- or Opus-class) handles only draft verdicts on claims that are new and checkable. Exact model choice should follow a cost/quality eval on the ADR-0004 claim set.
2. **Don't call the LLM if you don't have to.** Check the claim-hash and embedding similarity hit against existing checks first (ADR-0004 step 3). Viral content is repetitive, so this is the biggest lever **[I]**.
3. **Prompt caching** for the static prefix: system prompt, rating rubric, credibility registry and methodology. The discount size is a **[GAP]**.
4. **Batch API** for non-urgent work such as backfills, RSS sweeps and nightly re-checks. The discount is a **[GAP]**.
5. **Structured output** with tight max_tokens. No free-form essays.
6. **Hard budgets.** Per-user daily quotas (Redis), a global monthly cap (circuit breaker that degrades to "queued for review"), and Anthropic console spend limits.
7. **Per-call cost telemetry** to Postgres: `{stage, model, input_tokens, cached_tokens, output_tokens, usd}`, so cost per published check is a first-class metric.

## Trade-offs accepted
Routing adds complexity, and small-model misclassification may drop real claims. Mitigate by sampling dropped items into the editor queue.

## Review trigger
Revisit if cost per published check goes above a target set after week 1.

---
## Research round 2 (2026-10-03): pricing filled in

| Item | Value | Evidence |
|---|---|---|
| Haiku 4.5 | $1 / $5 per MTok (in/out) | [V2-PRIMARY claude.com/pricing] |
| Opus 5.5 | $4 / $20 per MTok | [V2-PRIMARY] |
| Sonnet | Agent reported "Sonnet 5.5" at $2 / $10. **The model name doesn't match the known lineup (Sonnet 5): re-check before use** | [needs re-check] |
| Batch API | 50% off | [V2-PRIMARY] |
| Cache write | 1.25× input (5-min TTL), 2× (1-hour TTL) | [V2-PRIMARY] |
| Cache read | 0.1× input (0.05× Opus 5.5) | [V2-PRIMARY] |
| Min cacheable prefix | **4,096 tokens on Haiku 4.5**, 512 on Sonnet/Opus | [V2-PRIMARY] |

**Implications:**
- On Haiku, the cached static prefix (rubric, credibility registry, examples) must reach 4,096 tokens or caching does nothing. Build the claim-detection prompt with few-shot Kenyan examples, which raises quality and crosses the threshold.
- Use the 5-minute TTL for bursty viral traffic. The 1-hour TTL (2× write) pays off only if the prefix is read about 3 or more times within the hour **[I]**.
- Batch (50% off) suits backfills and the nightly re-check sweep. It isn't suitable for user-facing submissions.
