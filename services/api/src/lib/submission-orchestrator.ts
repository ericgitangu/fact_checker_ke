import { schema, type Database } from "@fact-checker-ke/db";
import type { Rating, SubmissionReceivedEvent } from "@fact-checker-ke/core";
import { enactPublishDecision, type EnactPublishDecisionOutcome } from "./publish-enactment.js";

/**
 * ADR-0032/0017 "C1 gap" closer, API side: the ONE place a
 * `submission.received` event (from EITHER engine — the submission
 * engine's POST /v1/submissions, or the fetch engine's autonomous
 * ingestion, both distinguished only by `payload.ingest_source`) is
 * driven, over real HTTP, through services/pipeline's `/hops/analyze`
 * then `/hops/verify`, and the resulting `PublishDecisionPayload` is
 * handed to `enactPublishDecision` (publish-enactment.ts) — this is the
 * missing relay/consumer step F2's report flagged ("no HTTP route yet
 * creates the draft `checks` row and calls `/hops/verify`").
 *
 * Invoked by the internal `/internal/hops/orchestrate` route
 * (routes/internal.ts), which is the target the outbox relay now
 * publishes `submission.received` rows to (see app.ts wiring) — same
 * relay mechanism (`drainOutbox`/`publishOutboxRowInline`), just a
 * different target URL: this module calls the pipeline's hops directly
 * over plain HTTP (no further queue hop in between), since both calls
 * here are a single bounded request and nothing downstream of them
 * needs independent retry/backoff beyond QStash's own retry of the
 * ORCHESTRATE call itself.
 */

interface AnalyzeHopResponseBody {
  language: string;
  translation_en: string;
  claims: Array<{ text: string; claim_type: string; sampled_for_editor_review: boolean }>;
  attribution: string | null;
  needs_quote: boolean;
}

interface VerifyHopResponseBody {
  verdict: {
    rating: Rating | null;
    rationale: string;
    confidence: number;
    what_would_change_this: string;
  } | null;
  rejected: boolean;
  rejection_reason: string | null;
  reused_existing_check: boolean;
  publish: {
    risk_tier: "A" | "B" | "C";
    auto_publish: boolean;
    reason: string;
    publish_mode: string | null;
    queued_for_async_audit: boolean;
    requires_human_tap: boolean;
  } | null;
}

export type OrchestrationOutcome =
  // ADR-0004 SEC-4 / ADR-0032/0005 AT-0032-4: no checkable text at all
  // (video with no quote, or an item the fetch hop already blocked as
  // non-compliant media) — never calls verify, never creates a check.
  | { kind: "needs_quote" }
  | { kind: "no_checkable_claims" }
  // The draft was rejected (no verdict) or had no renderable summary —
  // fail closed at the EARLIEST point: no `checks` row is created at
  // all (there is nothing to show an editor either), rather than
  // creating one and relying solely on enactPublishDecision's own
  // fail-closed defence. See this module's docblock trade-off note.
  | { kind: "verify_rejected_no_check_created"; reason: string | null }
  | { kind: "check_created"; checkId: string; enactment: EnactPublishDecisionOutcome };

export interface RunSubmissionOrchestrationArgs {
  db: Database;
  pipelineBaseUrl: string;
  event: SubmissionReceivedEvent;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

async function postJson<T>(fetchImpl: typeof fetch, url: string, body: unknown): Promise<T> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable body>");
    throw new Error(`POST ${url} returned ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function runSubmissionOrchestration(
  args: RunSubmissionOrchestrationArgs,
): Promise<OrchestrationOutcome> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const { event } = args;
  // ADR-0032 (two-engine pivot): `.default("submission")` in the zod
  // schema means an already-parsed event always carries this field —
  // the `?? "submission"` here is belt-and-suspenders for a caller that
  // constructs the event object literally rather than via `.parse()`.
  const ingestSource = event.payload.ingest_source ?? "submission";

  const analyze = await postJson<AnalyzeHopResponseBody>(fetchImpl, `${args.pipelineBaseUrl}/hops/analyze`, {
    submission_id: event.submission_id,
    org_id: event.org_id,
    payload: {
      url: event.payload.url,
      text: event.payload.text,
      submitted_by: event.payload.submitted_by,
      quote: event.payload.quote,
      timestamp_sec: event.payload.timestamp_sec,
      ingest_source: ingestSource,
    },
  });

  if (analyze.needs_quote) {
    return { kind: "needs_quote" };
  }

  // Only a claim the analyze hop classified as "checkable" is eligible
  // for verification — an "opinion"/"prediction"/"rhetoric" claim (or no
  // claims at all) must never reach /hops/verify or create a `checks`
  // row, same fail-closed spirit as the `needs_quote` short-circuit
  // above (deliberately NOT falling back to `translation_en`, which
  // would silently verify a non-checkable statement).
  const checkable = analyze.claims.find((c) => c.claim_type === "checkable");
  const claimText = checkable?.text?.trim();
  if (!claimText) {
    return { kind: "no_checkable_claims" };
  }

  const verify = await postJson<VerifyHopResponseBody>(fetchImpl, `${args.pipelineBaseUrl}/hops/verify`, {
    submission_id: event.submission_id,
    org_id: event.org_id,
    claim_text: claimText,
    language: analyze.language && analyze.language !== "unknown" ? analyze.language : "en",
    named_person_involved: false,
  });

  const summary = verify.verdict?.rationale?.trim() || null;
  if (!verify.publish || verify.rejected || !summary) {
    return { kind: "verify_rejected_no_check_created", reason: verify.rejection_reason ?? verify.publish?.reason ?? null };
  }

  const [check] = await args.db
    .insert(schema.checks)
    .values({
      submissionId: event.submission_id,
      orgId: event.org_id,
      summary,
      rating: null, // not yet published — enactPublishDecision sets this atomically with isDraft/publishedAt
      isDraft: true,
      publishedAt: null,
      riskTier: verify.publish.risk_tier,
      calibratedConfidence: verify.verdict ? String(verify.verdict.confidence) : null,
      whatWouldChangeThis: verify.verdict?.what_would_change_this ?? null,
      ingestSource,
    })
    .returning();
  if (!check) {
    throw new Error("insert into checks returned no row");
  }

  // Fail-closed defence in depth: `verify.verdict.rating` must be
  // present whenever `summary` is (DraftVerdictOutput only has
  // `rating: null` for the named-person pre-approval case, which this
  // orchestrator sends `named_person_involved: false` for) — but if the
  // pipeline ever violates that contract, enactPublishDecision's OWN
  // fail-closed rule (missing summary) can't catch a missing RATING, so
  // this must never fabricate one.
  const rating = verify.verdict?.rating;
  if (!rating) {
    return { kind: "verify_rejected_no_check_created", reason: "verdict had no rating to enact" };
  }

  const enactment = await enactPublishDecision(args.db, {
    checkId: check.id,
    actorId: null,
    ingestSource,
    rating,
    summary,
    riskTier: verify.publish.risk_tier,
    decision: {
      autoPublish: verify.publish.auto_publish,
      reason: verify.publish.reason,
      publishMode: verify.publish.publish_mode,
      queuedForAsyncAudit: verify.publish.queued_for_async_audit,
      requiresHumanTap: verify.publish.requires_human_tap,
    },
    sampleRateAtQueueTime: verify.publish.queued_for_async_audit ? 1.0 : undefined,
  });

  return { kind: "check_created", checkId: check.id, enactment };
}
