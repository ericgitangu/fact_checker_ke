import { desc, eq } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import { TERMINAL_CHECK_LIFECYCLES, type CheckLifecycle, type Rating } from "@fact-checker-ke/core";
import {
  postJson,
  normalizeCredibilityTier,
  parseDateOrNull,
  type VerifyHopResponseBody,
} from "./submission-orchestrator.js";
import { enactPublishDecision } from "./publish-enactment.js";
import type { ReverifyPayload } from "./claim-source.js";

/**
 * ADR-0038 Wave 2 re-verify PERSISTENCE closer.
 *
 * THE GAP this closes: crowdsourced sources (`POST /v1/checks/:id/sources`,
 * lib/claim-source.ts) enqueue a re-verify to the pipeline's STATELESS
 * `/hops/verify`. The pipeline re-verifies WITH the injected crowdsourced
 * sources and returns a fresh verdict — but nothing ever wrote that result
 * back, so the check stayed `preliminary`/`awaiting_sources` forever and the
 * sources moved nothing.
 *
 * This module is the API-side relay+persister that `POST /internal/hops/reverify`
 * drives: it calls the pipeline verify hop with the injected docs, then
 * PROGRESSES THE SAME EXISTING check row (UPDATE, not a new INSERT — this is
 * advancing the one thread the sources attached to, NOT an ADR-0025 correction
 * of a published verdict). It mirrors `runSubmissionOrchestration`'s persist
 * semantics exactly — evidence rows, the `publishable = hasEvidence && hasContext`
 * gate, and the HARD named-person invariant (`hopLifecycle !== "editor_review"`
 * in the auto-publish gate; a named-person / escalated item is NEVER
 * auto-published by this autonomous edge, it is held for a human editor).
 *
 * Idempotent / fail-closed:
 *   - No check for the submission, or an ALREADY-TERMINAL check
 *     (published/dismissed/archived_expired, or a non-null publishedAt) → no-op.
 *     A published item is not re-verified by community sources.
 *   - A rejected / rating-less verify response → no-op (the check is left as-is;
 *     a weaker/empty re-verify must not downgrade an existing open thread).
 */

export interface RunReverifyOrchestrationArgs {
  db: Database;
  pipelineBaseUrl: string;
  payload: ReverifyPayload;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * ADR-0038 (FEATURE_PRELIMINARY_THREADS): mirrors the submission
   * orchestrator — only when on are the verify-hop `lifecycle`/`source_kind`/
   * `authoritative` fields trusted and persisted (and the editor_review
   * suppression armed). Off ⇒ today's held-draft fallback.
   */
  featurePreliminaryThreads?: boolean;
}

export type ReverifyOutcome =
  // No open check to progress (none for the submission, or already terminal).
  | { outcome: "noop"; reason: string }
  // Re-verified, content + evidence persisted, the check left as a non-publish
  // open thread (preliminary/awaiting_sources/editor_review) — includes the
  // named-person editor_review hold.
  | { outcome: "updated"; checkId: string; lifecycle: CheckLifecycle | null }
  // Re-verified and the existing check was published (non-named, cleared the band).
  | { outcome: "published"; checkId: string };

export async function runReverifyOrchestration(
  args: RunReverifyOrchestrationArgs,
): Promise<ReverifyOutcome> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const { payload } = args;

  // (a) Resolve the EXISTING check for this submission — the most-recent one
  // (the public trending stream exposes submissionId, never the draft check id,
  // so the re-verify is keyed on submission_id; see claim-source.ts). A re-verify
  // for an unknown submission, or one whose check is already terminal, is an
  // idempotent no-op — a published/dismissed/archived item is not re-verified by
  // community source-weight.
  const [check] = await args.db
    .select({
      id: schema.checks.id,
      orgId: schema.checks.orgId,
      lifecycleState: schema.checks.lifecycleState,
      isDraft: schema.checks.isDraft,
      publishedAt: schema.checks.publishedAt,
    })
    .from(schema.checks)
    .where(eq(schema.checks.submissionId, payload.submission_id))
    .orderBy(desc(schema.checks.createdAt))
    .limit(1);

  if (!check) {
    return { outcome: "noop", reason: "no check found for submission" };
  }
  // Terminal = already published (publishedAt set) OR a terminal lifecycle
  // state. Fail-closed on either signal.
  const lifecycle = (check.lifecycleState as CheckLifecycle | null) ?? null;
  const isTerminal =
    check.publishedAt !== null || (lifecycle !== null && TERMINAL_CHECK_LIFECYCLES.includes(lifecycle));
  if (isTerminal) {
    return { outcome: "noop", reason: "check is terminal (published/dismissed/archived_expired)" };
  }

  // (b) Drive the pipeline verify hop WITH the injected crowdsourced docs. Same
  // response shape the submission orchestrator consumes.
  const verify = await postJson<VerifyHopResponseBody>(fetchImpl, `${args.pipelineBaseUrl}/hops/verify`, {
    submission_id: payload.submission_id,
    org_id: payload.org_id,
    claim_text: payload.claim_text,
    language: payload.language && payload.language !== "unknown" ? payload.language : "en",
    injected_docs: payload.injected_docs,
    named_person_involved: false,
  });

  // (c) A rejected / rating-less / summary-less re-verify is a no-op: a
  // re-verification that found nothing stronger must not tear down the existing
  // open thread. Leave the check exactly as it was.
  const summary = verify.verdict?.rationale?.trim() || null;
  const rating = verify.verdict?.rating ?? null;
  if (!verify.publish || verify.rejected || !summary || !rating) {
    return { outcome: "noop", reason: verify.rejection_reason ?? "re-verify produced no actionable verdict" };
  }

  // ADR-0038 contract A gating — identical to runSubmissionOrchestration.
  const lifecycleOn = args.featurePreliminaryThreads === true;
  const hopLifecycle = lifecycleOn ? (verify.publish.lifecycle ?? null) : null;
  const nonPublishLifecycle: NonNullable<(typeof schema.checks.$inferSelect)["lifecycleState"]> | null =
    hopLifecycle === "preliminary" ||
    hopLifecycle === "awaiting_sources" ||
    hopLifecycle === "dismissed" ||
    hopLifecycle === "editor_review"
      ? hopLifecycle
      : null;
  const hopSourceKind = lifecycleOn ? (verify.publish.source_kind ?? null) : null;
  const hopAuthoritative = lifecycleOn ? (verify.publish.authoritative ?? true) : true;

  // (d) PERSIST onto the EXISTING check. First the fresh evidence rows (sources +
  // check_evidence), same shape as the orchestrator — a published check must cite
  // at least one source (ADR-0031 AT-0031-1), and these are the re-verify's cited
  // sources (including the newly-injected crowdsourced ones the pipeline accepted).
  const evidenceItems = verify.evidence ?? [];
  for (const ev of evidenceItems) {
    const [src] = await args.db
      .insert(schema.sources)
      .values({
        orgId: check.orgId,
        url: ev.url,
        title: ev.title,
        publisher: ev.publisher,
        credibilityTier: normalizeCredibilityTier(ev.credibility_tier),
        publishedAt: parseDateOrNull(ev.published_at),
        excerpt: ev.quote.slice(0, 2000),
      })
      .returning({ id: schema.sources.id });
    if (!src) continue;
    await args.db.insert(schema.checkEvidence).values({
      checkId: check.id,
      sourceId: src.id,
      quote: ev.quote.slice(0, 2000),
    });
  }

  // Update the check's CONTENT from the fresh verdict (same fields the
  // orchestrator sets on INSERT). This runs on BOTH the publish and the
  // update branches so the published row carries the re-verified content, and a
  // held thread shows the progressed assessment. `rating` is NOT set here — it
  // is set atomically by enactPublishDecision on publish, and deliberately left
  // as-is (typically null) on the non-publish branch, mirroring the orchestrator.
  const now = new Date();
  await args.db
    .update(schema.checks)
    .set({
      summary,
      context: verify.verdict?.context ?? null,
      whatWouldChangeThis: verify.verdict?.what_would_change_this ?? null,
      rawConfidence: verify.verdict ? String(verify.verdict.confidence) : null,
      calibratedConfidence: verify.verdict ? String(verify.verdict.confidence) : null,
      agreementState: verify.publish.corroboration_state ?? null,
      riskTier: verify.publish.risk_tier,
      sourceKind: hopSourceKind,
      authoritative: hopAuthoritative,
      lastActivityAt: now,
    })
    .where(eq(schema.checks.id, check.id));

  // Same publish gate as the orchestrator, including the HARD named-person
  // invariant: an un-cited or context-less verdict is never auto-published, and
  // an item the pipeline routed to editor_review (named-person / escalated) is
  // NEVER auto-published by this autonomous edge regardless of auto_publish.
  const hasEvidence = evidenceItems.length > 0;
  const hasContext = typeof verify.verdict?.context === "string" && verify.verdict.context.trim().length > 0;
  const publishable = hasEvidence && hasContext;
  const autoPublish = verify.publish.auto_publish && publishable && hopLifecycle !== "editor_review";

  if (autoPublish) {
    const enactment = await enactPublishDecision(args.db, {
      checkId: check.id,
      actorId: null,
      // A re-verify only ever runs on a submission-origin crowdsourced thread;
      // enactPublishDecision carries this onto the published check's provenance.
      ingestSource: "submission",
      rating,
      summary,
      riskTier: verify.publish.risk_tier,
      decision: {
        autoPublish: true,
        reason: verify.publish.reason,
        publishMode: verify.publish.publish_mode,
        queuedForAsyncAudit: verify.publish.queued_for_async_audit,
        requiresHumanTap: verify.publish.requires_human_tap,
      },
      sampleRateAtQueueTime: verify.publish.queued_for_async_audit ? 1.0 : undefined,
    });
    // enactPublishDecision is fail-closed (kill switches / missing summary) and
    // may decline to publish — only report "published" when it actually did.
    if (enactment.kind === "published") {
      return { outcome: "published", checkId: check.id };
    }
    // Declined (kill switch / fail-closed): the check keeps its open lifecycle,
    // content already updated above. Report as a (content) update.
    return { outcome: "updated", checkId: check.id, lifecycle };
  }

  // Non-publish branch: progress the lifecycle to the hop's non-publish state
  // (preliminary/awaiting_sources/editor_review) when the lifecycle track is on,
  // and bump the activity clock. NEVER publishes. When the flag is off,
  // `nonPublishLifecycle` is null and the lifecycle column is left unchanged
  // (today's held-draft fallback), only the activity clock advances.
  if (nonPublishLifecycle !== null) {
    // ADR-0038 Wave 3 stance persistence (mirrors runSubmissionOrchestration):
    // a NON-named (`risk_tier !== 'C'`) PRELIMINARY carries the fresh AI draft
    // stance so the public feed shows it behind the "AI-grounded" caveat; any
    // other non-publish state (awaiting_sources / editor_review / a named 'C'
    // item) has its rating withheld (set null) — defence-in-depth against a
    // prior stance lingering on a row that re-verify moved to a protected state.
    const preliminaryDraftRating: Rating | null =
      nonPublishLifecycle === "preliminary" && verify.publish.risk_tier !== "C" ? rating : null;
    await args.db
      .update(schema.checks)
      .set({ lifecycleState: nonPublishLifecycle, rating: preliminaryDraftRating, lastActivityAt: now })
      .where(eq(schema.checks.id, check.id));
    return { outcome: "updated", checkId: check.id, lifecycle: nonPublishLifecycle };
  }
  return { outcome: "updated", checkId: check.id, lifecycle };
}
