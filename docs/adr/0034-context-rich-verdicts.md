# ADR-0034: Context-rich verdicts — the context leads, the rating follows

**Status:** Accepted · **Date:** 2026-10-05
**Amends (additive):** ADR-0004 (verification pipeline / step 6 draft verdict), ADR-0031 (confidence-weighted guidance / the output model). Additive — it adds a first-class `context` field and a publish-time presence gate; it does not remove or rewrite any existing field, prompt rule, or acceptance test. ADR-0023's citation-integrity and framing guards are reused unchanged and extended to cover the new text.

## Problem
A published check today leads with a `rating` label and a short `rationale`/`summary`. For the single most common Kenyan misinformation shape — a real quote or clip taken **out of context** ("Misleading") — a bare label is itself misleading: it tells the reader *what* we decided but not *why the original framing deceives*, and it invites the "you're just picking sides" dismissal. ADR-0031 already bans the bare person-indicting verdict and makes the assessment claim-and-evidence framed; this ADR makes the **context the lead of the artifact**, not a label with a paragraph hidden beneath it.

The rendering requirement: for every assessment, and especially "Misleading", the published artifact must surface, in order, (a) what the claim asserts, (b) the misconception — exactly how it misleads, (c) the actual context and any kernel of truth, then (d) the rating. The model still makes its own rating call, the citation-integrity rules (ADR-0023) still bind any new text, and an unverifiable claim stays `Unproven` — context is never fabricated to manufacture a verdict.

## Context / evidence
- The pipeline already emits structured `{rating, rationale, citations[], confidence, what_would_change_this}` (ADR-0004 step 6; `DraftVerdictOutput` in `services/pipeline/app/models/pipeline_io.py`). There is no field whose contract is "the context that must lead the artifact" — `rationale` is free-form justification, not a guaranteed, renderable, queryable context block. **[V: read of pipeline_io.py / templates.py / check.ts]**
- `CheckSchema` (`packages/core/src/schemas/check.ts`) already enforces published-check invariants additively via a `superRefine` (ADR-0031: `calibrated_confidence` + `what_would_change_this` + cited `evidence` required on publish; bare-indictment framing banned). Adding one more required-on-publish field follows that exact established pattern. **[V]**
- The `checks` table (`packages/db/src/schema.ts`) already carries ADR-0031's nullable `what_would_change_this` / `calibrated_confidence` / `risk_tier` columns as EXPAND-only additions; adding one nullable `context` column is the same move. **[V]**
- `apps/web` already renders check text through a safe markdown renderer (ADR-0004 / recent nav-polish commit) — no new renderer is needed, only a reordering so context leads. **[V: git log b6864c4 "safe markdown rendering"]**

## Options
1. **Keep context inside the existing `summary`/`rationale`; enforce the (a)-(d) structure in the prompt only.** — ✓ zero schema/migration/codegen churn, maximally additive ✗ no contract guarantee the context exists or is non-empty on a published check; not independently queryable or renderable-as-lead; the FE cannot reliably lead with it without fragile parsing; regresses silently under prompt drift with nothing to catch it.
2. **Add one explicit nullable `context` field** to the draft verdict + `checks` table + `CheckSchema`, required-on-publish via an additive `superRefine` branch (mirrors ADR-0031's own nullable-column + publish-gate pattern), with the prompt producing the (a)-(c) narrative and the rating staying the model's call. — ✓ first-class, FE leads with it, contract-guaranteed present on publish, queryable, one field not four ✗ an EXPAND-only migration + a `pnpm gen:contracts` re-run + a one-time backfill of pre-launch published fixtures/seeds.
3. **Add four separate structured columns** (`claim_asserts`, `misconception`, `actual_context`, `kernel_of_truth`). — ✓ maximally structured, each sub-part independently addressable ✗ over-constrains the model and forces it to fill fields that may not apply (an `Unproven` claim has no "kernel of truth"), a four-column migration, brittle FE, and it fights the "model makes its own call / Unproven stays Unproven" constraint by demanding fabricated structure.

## Decision: Option 2
Add a single first-class **`context`** field (nullable at rest, required-on-publish), carrying the (a)+(b)+(c) narrative that leads the artifact; the `rating` remains the model's own output and renders *after* the context.

- **Prompt (`build_draft_verdict_prompt`).** The draft-verdict JSON schema gains `"context": str`. The task text requires the model to write `context` as, in order: **(a)** what the claim asserts, **(b)** the misconception — precisely how the claim misleads (for "Misleading", the out-of-context mechanism is mandatory here), **(c)** the actual context and any kernel of truth — built **only** from the retrieved sources, with the same "if no source supports it, don't assert it; rate `Unproven`" rule that already governs the rating. `context` is **synthesis prose, not new quotes**: any directly quoted source span still belongs in `citations[]` and is still substring-checked there (ADR-0023 §2), so `context` introduces no uncited source material. `rationale` stays as the short "why this rating" justification; `context` is the reader-facing lead.
- **`context` for `Unproven`/`NotCheckable`.** It states what the claim asserts and *why the evidence is insufficient* — it never fabricates supporting context to manufacture a verdict. `Unproven` stays `Unproven` (ADR-0004/0031 hard rule, unchanged).
- **Contract + storage (additive, EXPAND-only).** `DraftVerdictOutput.context: str | None` (default `None`, so the dedup-reuse path that constructs a verdict directly still validates). `CheckSchema` gains `context: string().min(1).max(2000).nullable()`; the **existing** `superRefine` gains one branch requiring non-empty `context` on a published check (same gate as `what_would_change_this`), and the framing-ban check (`isBareIndictmentFraming`) is extended to scan `context` too, so context cannot smuggle a bare indictment past ADR-0023. The `checks` table gains a nullable `context text` column.
- **Display (FE note only).** The check card and detail lead with the `context` paragraph (existing safe markdown renderer), rating badge after; `FeedItem` carries `context` so the feed card can lead with it too. No new renderer.

## Trade-offs accepted
1. **A one-time backfill of pre-launch published fixtures/seeds** to satisfy the new required-on-publish gate (identical to ADR-0031's rollout; pre-launch, so no production published rows exist to migrate).
2. **One more required-on-publish invariant** to keep green across the pipeline → enactment → contract path; a draft that produces no context is routed to editor review / retried rather than auto-published (consistent with ADR-0023 §1's retry-then-route rule).
3. **Context is model-authored synthesis** — longer output tokens per draft verdict (bounded at 2000 chars) and one more surface the framing/citation gates must police; accepted because the context block is the artifact's core value, not an add-on.

## Irreversible
None. Additive column + contract field; reversible in code. The only non-trivial step is the fixture backfill, which is forward-only data, not a destructive migration.

## Review trigger
Revisit if editors find `context` frequently restating `rationale` (merge them) or frequently fabricating where sources are thin (tighten the prompt's "Unproven stays Unproven" rule, or make `context` optional for `Unproven` specifically).

## Delegation notes (for the implementing pass — do not re-litigate the single-`context`-field decision)

**Schema / contract / migration (EXPAND-only):**
1. `services/pipeline/app/models/pipeline_io.py` — `DraftVerdictOutput`: add `context: str | None = Field(default=None, max_length=2000)`. Default `None` is load-bearing: the dedup-reuse branch in `verify.py` (~L122-134) builds a `DraftVerdictOutput` directly and must keep validating; carry `candidate.context` there if the `CheckStore` candidate exposes it, else leave `None`.
2. `packages/core/src/schemas/check.ts` — add `context: z.string().min(1).max(2000).nullable()`. Extend the **existing** `superRefine` additively: add a branch that `addIssue` on `context === null || empty` when `!isDraft && publishedAt` (mirror the `whatWouldChangeThis` branch verbatim), and change the bare-indictment check to run over `context` as well as `summary` (e.g. `isBareIndictmentFraming(check.summary) || (check.context && isBareIndictmentFraming(check.context))`). Do not touch the other branches.
3. `packages/db/src/schema.ts` — `checks` table: add `context: text("context")` (nullable, no default), placed beside `whatWouldChangeThis`. Then `pnpm --filter @fact-checker-ke/db drizzle-kit generate` → the new migration must be a single `ALTER TABLE checks ADD COLUMN context text;` (nullable, EXPAND-only — verify the generated SQL does **not** add a `NOT NULL`/default or drop anything).
4. `pnpm gen:contracts` (runs `scripts/gen-contracts.sh`) — regenerate `packages/core/generated/contracts.schema.json` and `services/pipeline/app/models/generated.py` so the Python `Check` contract carries `context`. The `superRefine` publish gate is not expressible in JSON Schema — that is expected and already handled for ADR-0031's invariants by `services/pipeline/app/models/domain.py`; add `context` there the same way if a refinement wrapper exists.

**Pipeline:**
5. `services/pipeline/app/prompts/templates.py` — `build_draft_verdict_prompt`: add `"context": str` to the returned JSON schema line; add a task paragraph mandating the (a)→(b)→(c) ordering built only from retrieved sources, "no new quotes in context (quotes go in citations)", and "`Unproven` when unsupported — never fabricate context". Keep the injection-containment prefix and the existing citation/`rating` rules unchanged.
6. `services/pipeline/app/stages/verify.py` / `app/stages/citation_guard.py` — no change to `verify_citations`' doc_id/substring contract (context carries no quotes, so it adds no new citable spans). Add a draft-time structural assertion that `context` is non-empty whenever `rating is not None`; on failure, treat it like any other schema violation (retry once, then the rejected path), so a context-less draft never reaches auto-publish.

**API + FE:**
7. `services/api/src/lib/publish-enactment.ts` (and the pipeline→API verdict mapping) — persist `draft.context` into `checks.context` at draft/enactment time.
8. `services/api/src/repositories/{types,postgres,in-memory}.ts` + `packages/core` feed schema — add `context` to `FeedItem` so `GET /v1/feed` cards can lead with it (additive, nullable).
9. **FE (apps/web, note only):** `apps/web` check card + detail + feed card reorder to render `context` as the lead paragraph, rating badge after; reuse the existing safe markdown renderer. No new renderer, no new dependency.

**Acceptance checks:**
| ID | Behaviour | Status |
|---|---|---|
| AT-0034-1 | A "Misleading" draft's output carries a non-empty `context` stating (a) what the claim asserts, (b) how it misleads, (c) the actual context + any kernel of truth, before the rating — produced by the real `build_draft_verdict_prompt` template (fixture test, not a mock), citation-integrity-checked. | RED |
| AT-0034-2 | A published `Check` with `context === null`/empty fails `CheckSchema` validation (the additive `superRefine` branch), exactly as a missing `what_would_change_this` already does. | RED |
| AT-0034-3 | `context` introduces no uncited source quote (the citation guard still passes with quotes only in `citations[]`), and a bare person-indicting phrasing placed in `context` is rejected by the framing gate (ADR-0023 AT-0023-7 extended to `context`). | RED |
| AT-0034-4 | An `Unproven` claim yields a `context` that states the assertion + why evidence is insufficient, does **not** fabricate supporting context, and the rating stays `Unproven` (model's call unchanged). | RED |
| AT-0034-5 | The check card/detail and feed card render the `context` paragraph as the lead with the rating badge after (FE). | RED |
