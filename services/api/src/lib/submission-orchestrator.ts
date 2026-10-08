import { and, eq, isNotNull } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { Rating, SubmissionReceivedEvent, SubmissionStatus } from "@fact-checker-ke/core";
import { enactPublishDecision, type EnactPublishDecisionOutcome } from "./publish-enactment.js";
import { advanceSubmissionStatus } from "./state-machine.js";

/**
 * Feed-quality (ingestion dedup): the canonical form of a claim used to detect
 * an already-PUBLISHED duplicate before creating a second published check for
 * the same claim (trim, lowercase, collapse ALL internal whitespace runs to a
 * single space). Mirrors the pipeline's `_normalize_claim_text`
 * (services/pipeline/app/stages/fetch_hop.py) so the two engines agree on what
 * "the same claim" means. Persisted on `checks.normalized_claim` and compared
 * via the partial index `checks_published_normalized_claim_idx`.
 */
export function normalizeClaim(text: string): string {
  return text.trim().toLowerCase().split(/\s+/).join(" ");
}

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
    // ADR-0034: the reader-facing context that leads the artifact.
    context: string | null;
  } | null;
  rejected: boolean;
  rejection_reason: string | null;
  reused_existing_check: boolean;
  // The prior published check this verdict reuses (set only alongside
  // `reused_existing_check: true`). Carried so this orchestrator points the
  // submission at the existing check instead of failing it.
  reused_check_id?: string | null;
  // ADR-0031 AT-0031-1: the citation-integrity-checked sources behind the
  // verdict, which a PUBLISHED check must carry (CheckSchema.superRefine).
  // snake_case to match the pipeline's wire format (same as the fields above).
  evidence?: Array<{
    url: string;
    title: string;
    publisher: string;
    credibility_tier: string;
    quote: string;
    published_at: string | null;
  }>;
  publish: {
    risk_tier: "A" | "B" | "C";
    auto_publish: boolean;
    reason: string;
    publish_mode: string | null;
    queued_for_async_audit: boolean;
    requires_human_tap: boolean;
    // ADR-0036: the grounded second-opinion agreement feature behind this
    // decision ("agree"|"disagree"|"no_second_opinion"), persisted onto the
    // check for the calibration flywheel. Optional — absent on a pre-ADR-0036
    // pipeline response (the API tolerates extra/missing fields, see postJson).
    corroboration_state?: string | null;
    // ADR-0038 contract A (pipeline → api): the editorial lifecycle the verify
    // hop assigns to a NON-auto-published outcome, plus its provenance. All
    // three are OPTIONAL — a pre-0038 pipeline, or one with
    // FEATURE_PRELIMINARY_THREADS off, simply omits them and the orchestrator
    // falls back to today's held-draft behaviour (see `featurePreliminaryThreads`).
    //   - `lifecycle`:  "published" (the auto-publish path, enacted by
    //     publish-enactment, NOT persisted from here) | "preliminary" |
    //     "awaiting_sources" | "dismissed".
    //   - `source_kind`: e.g. "ai_grounded_preliminary" for a grounded rescue
    //     thread; null for an ordinary verdict.
    //   - `authoritative`: false for an AI-grounded preliminary / a named-person
    //     item whose rating is withheld from the public.
    lifecycle?: "published" | "preliminary" | "awaiting_sources" | "editor_review" | "dismissed" | null;
    source_kind?: string | null;
    authoritative?: boolean | null;
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
  // Feed-quality (ingestion dedup, 1a): an already-PUBLISHED check exists for
  // this exact (normalized) claim — we do NOT create a second published check;
  // the submission is pointed at the existing one and advanced to `ready`.
  | { kind: "duplicate_published"; checkId: string }
  // Feed-quality (reused-check path, 1b): the pipeline's embedding dedup
  // short-circuited to a prior check (publish=None). The submission is a
  // completed, de-duplicated run — advanced to `ready`, never `failed`.
  | { kind: "reused_existing_check"; checkId: string | null }
  | { kind: "check_created"; checkId: string; enactment: EnactPublishDecisionOutcome };

export interface RunSubmissionOrchestrationArgs {
  db: Database;
  pipelineBaseUrl: string;
  event: SubmissionReceivedEvent;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * ADR-0038 (FEATURE_PRELIMINARY_THREADS): when true, the verify hop's
   * `lifecycle`/`source_kind`/`authoritative` fields (contract A) are trusted
   * and persisted onto the check. When false/omitted (default — shipped dark),
   * they are ignored and the item falls back to today's held-draft behaviour,
   * so the whole lifecycle track is inert until the flag is flipped on.
   */
  featurePreliminaryThreads?: boolean;
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

const CREDIBILITY_TIERS = [
  "tier1_primary",
  "tier2_established_media",
  "tier3_general",
  "tier4_unverified",
] as const;
type CredibilityTier = (typeof CREDIBILITY_TIERS)[number];

/** Coerce the pipeline's credibility_tier string to the DB enum, defaulting
 * an unexpected value to tier3_general rather than failing the whole hop. */
function normalizeCredibilityTier(tier: string): CredibilityTier {
  return (CREDIBILITY_TIERS as readonly string[]).includes(tier) ? (tier as CredibilityTier) : "tier3_general";
}

/** Parse a wire date (e.g. a fact-check reviewDate, which may be date-only or
 * absent) to a Date, or null — never an Invalid Date that would break the
 * timestamp insert. */
function parseDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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

  // RC1 (the "stuck at received" bug): this orchestrate call is the ONLY
  // production driver of the ADR-0017 submission state machine. Before
  // this, nothing in prod ever advanced `submissions.status` past
  // `received` (the `/internal/events/submission-advanced` route's only
  // callers are the DEV-ONLY simulator and tests), so even a published
  // submission showed "Received" forever in the tracker. We advance the
  // machine inline as each hop completes.
  //
  // `advanceSubmissionStatus` is a conditional UPDATE (WHERE status=from),
  // so a QStash retry of this whole orchestrate call is naturally
  // idempotent on the status: an already-applied transition is a no-op
  // `stale_or_duplicate`, never an error. Known limitation (pre-existing,
  // not introduced here): the final `verifying -> ready` advance is not in
  // the same tx as enactPublishDecision's commit, so a crash in that
  // window leaves status=`verifying` with a published check until QStash
  // retries — the same retry path that already risks a duplicate check
  // insert (tracked separately; out of scope for RC1).
  const advance = (from: SubmissionStatus, to: SubmissionStatus) =>
    advanceSubmissionStatus(args.db, { submissionId: event.submission_id, from, to });

  await advance("received", "analyzing");

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
    await advance("analyzing", "failed");
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
    await advance("analyzing", "failed");
    return { kind: "no_checkable_claims" };
  }

  // Feed-quality (ingestion dedup, 1a): BEFORE running verify or creating any
  // check, see whether a PUBLISHED check already exists for this exact
  // (normalized) claim in this org. The pipeline's embedding dedup
  // (`check_store`) is an empty in-memory stub in prod (nothing calls
  // `.save`), so the durable "same claim submitted twice -> one feed item"
  // guarantee lives here, at the API layer, as a cheap indexed lookup
  // (`checks_published_normalized_claim_idx`). If a duplicate exists we do NOT
  // run verify (saving the LLM cost) and do NOT create a second published
  // check — we point the submission at the existing check and finish `ready`.
  const normalizedClaim = normalizeClaim(claimText);
  const [existingPublished] = await args.db
    .select({ id: schema.checks.id })
    .from(schema.checks)
    .where(
      and(
        eq(schema.checks.orgId, event.org_id),
        eq(schema.checks.normalizedClaim, normalizedClaim),
        eq(schema.checks.isDraft, false),
        isNotNull(schema.checks.publishedAt),
      ),
    )
    .limit(1);
  if (existingPublished) {
    await advance("analyzing", "analyzed");
    await advance("analyzed", "verifying");
    await advance("verifying", "ready");
    return { kind: "duplicate_published", checkId: existingPublished.id };
  }

  await advance("analyzing", "analyzed");
  await advance("analyzed", "verifying");

  const verify = await postJson<VerifyHopResponseBody>(fetchImpl, `${args.pipelineBaseUrl}/hops/verify`, {
    submission_id: event.submission_id,
    org_id: event.org_id,
    claim_text: claimText,
    language: analyze.language && analyze.language !== "unknown" ? analyze.language : "en",
    named_person_involved: false,
  });

  // Feed-quality (reused-check path, 1b): the pipeline's embedding dedup
  // matched a prior check and short-circuited — `reused_existing_check: true`
  // with `publish: null` (pipeline_io.py). This is a KNOWN/duplicate claim,
  // NOT a rejection: handle it explicitly BEFORE the `!verify.publish`
  // fail-closed branch below (which would otherwise mis-advance the submission
  // to `failed`). No second check is created; the submission is a completed,
  // de-duplicated run — advanced to `ready`, carrying the reused check id.
  if (verify.reused_existing_check) {
    await advance("verifying", "ready");
    return { kind: "reused_existing_check", checkId: verify.reused_check_id ?? null };
  }

  const summary = verify.verdict?.rationale?.trim() || null;
  if (!verify.publish || verify.rejected || !summary) {
    await advance("verifying", "failed");
    return { kind: "verify_rejected_no_check_created", reason: verify.rejection_reason ?? verify.publish?.reason ?? null };
  }

  // ADR-0038 contract A: read the verify hop's editorial-lifecycle fields —
  // but ONLY when FEATURE_PRELIMINARY_THREADS is on (otherwise ship dark: the
  // fields are ignored and the item falls back to today's held-draft path).
  //
  // What we persist on INSERT:
  //   - `source_kind` + `authoritative` are orthogonal to the publish gate and
  //     carried straight through.
  //   - `lifecycle_state` is set to a NON-publish state (preliminary /
  //     awaiting_sources / dismissed) here; the `published` terminal state is
  //     enacted atomically by `enactPublishDecision` (publish-enactment.ts), so
  //     this never pre-sets `published` and never double-sets it.
  //   - `last_activity_at = now()` — ingest is activity, and it is the clock the
  //     expiry sweep reads.
  const lifecycleOn = args.featurePreliminaryThreads === true;
  const hopLifecycle = lifecycleOn ? (verify.publish.lifecycle ?? null) : null;
  const initialLifecycleState: NonNullable<(typeof schema.checks.$inferSelect)["lifecycleState"]> | null =
    hopLifecycle === "preliminary" ||
    hopLifecycle === "awaiting_sources" ||
    hopLifecycle === "dismissed" ||
    // editor_review: the pipeline routes a named-person/escalated item here. It
    // is a NON-publish state — persisted so the item enters the bounded editor
    // queue, and the publish gate below is suppressed so it is NEVER auto-published.
    hopLifecycle === "editor_review"
      ? hopLifecycle
      : null;
  const hopSourceKind = lifecycleOn ? (verify.publish.source_kind ?? null) : null;
  // `authoritative` is NOT NULL (default true): a null/absent hop value keeps
  // the row authoritative; only an explicit `false` marks it non-authoritative.
  const hopAuthoritative = lifecycleOn ? (verify.publish.authoritative ?? true) : true;

  const [check] = await args.db
    .insert(schema.checks)
    .values({
      lifecycleState: initialLifecycleState,
      sourceKind: hopSourceKind,
      authoritative: hopAuthoritative,
      lastActivityAt: new Date(),
      submissionId: event.submission_id,
      orgId: event.org_id,
      summary,
      rating: null, // not yet published — enactPublishDecision sets this atomically with isDraft/publishedAt
      isDraft: true,
      publishedAt: null,
      riskTier: verify.publish.risk_tier,
      calibratedConfidence: verify.verdict ? String(verify.verdict.confidence) : null,
      // ADR-0036 Phase-2 flywheel: persist the draft's RAW confidence + the
      // grounded second-opinion agreement_state per check, so editor
      // corrections can later be joined into fresh calibration samples that
      // re-fit the corroboration lift (the "robust over weeks" loop). Both are
      // nullable on the wire — a verify response from a pre-ADR-0036 pipeline,
      // or an item that got no second opinion, simply stores null.
      rawConfidence: verify.verdict ? String(verify.verdict.confidence) : null,
      agreementState: verify.publish.corroboration_state ?? null,
      whatWouldChangeThis: verify.verdict?.what_would_change_this ?? null,
      context: verify.verdict?.context ?? null,
      ingestSource,
      // Feed-quality (ingestion dedup, 1a): persist the normalized claim so a
      // LATER submission of the same claim finds this one via the published
      // dedup lookup above. Stored on drafts too (harmless — the lookup filters
      // on published), so a held draft that an editor later publishes still
      // dedups future submissions.
      normalizedClaim,
      // Feed-quality (virality): the single log-weighted engagement score the
      // fetch engine computed and carried on the event (null for every reader
      // submission). numeric column -> string, same convention as
      // calibratedConfidence above.
      viralityScore:
        event.payload.virality_score === null || event.payload.virality_score === undefined
          ? null
          : String(event.payload.virality_score),
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
    await advance("verifying", "failed");
    return { kind: "verify_rejected_no_check_created", reason: "verdict had no rating to enact" };
  }

  // ADR-0031 AT-0031-1: persist the citation-integrity-checked sources
  // (ADR-0023 §2) as this check's evidence. Done for EVERY check, published
  // or held — a held draft needs its evidence when an editor later approves
  // it. (Not wrapped in one tx with the check insert / enactment: same
  // non-atomic window as the pre-existing enactment step; a crash here is
  // recovered by QStash's retry of the whole orchestrate call.)
  const evidenceItems = verify.evidence ?? [];
  for (const ev of evidenceItems) {
    const [src] = await args.db
      .insert(schema.sources)
      .values({
        orgId: event.org_id,
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

  // A PUBLISHED check must cite at least one source (ADR-0031 AT-0031-1,
  // enforced by CheckSchema.superRefine at read time). So an un-cited verdict
  // is NEVER auto-published here — it is held as a draft for an editor,
  // regardless of the pipeline's confidence-based auto_publish decision.
  // Fail-closed: this is the publish-time half of the invariant the schema
  // enforces at read time.
  const hasEvidence = evidenceItems.length > 0;
  // ADR-0034: context leads a published artifact, so (belt-and-suspenders to
  // the pipeline's own rating-implies-context assertion) a verdict with no
  // context is never auto-published — held for an editor instead.
  const hasContext = typeof verify.verdict?.context === "string" && verify.verdict.context.trim().length > 0;
  const publishable = hasEvidence && hasContext;

  const enactment = await enactPublishDecision(args.db, {
    checkId: check.id,
    actorId: null,
    ingestSource,
    rating,
    summary,
    riskTier: verify.publish.risk_tier,
    decision: {
      // HARD INVARIANT (never auto-publish a named person): when the pipeline
      // routes an item to editor_review (named-person/escalated), suppress
      // auto-publish here regardless of the pipeline's confidence-based
      // auto_publish flag — a named-person claim that clears the band is held
      // for a human editor, never published by an autonomous edge. This is the
      // API-side half of the pipeline's editor_review guard; enactPublishDecision
      // itself trusts `autoPublish`, so the gate must be applied here.
      autoPublish: verify.publish.auto_publish && publishable && hopLifecycle !== "editor_review",
      reason:
        hopLifecycle === "editor_review"
          ? "held for editor review: named-person / escalated item routed to the editor queue (never auto-published)"
          : publishable
            ? verify.publish.reason
            : !hasEvidence
              ? "held for editor review: no citable evidence to satisfy the published-check requirement (ADR-0031 AT-0031-1)"
              : "held for editor review: no context to lead the published assessment (ADR-0034)",
      publishMode: verify.publish.publish_mode,
      queuedForAsyncAudit: verify.publish.queued_for_async_audit,
      requiresHumanTap: verify.publish.requires_human_tap,
    },
    sampleRateAtQueueTime: verify.publish.queued_for_async_audit ? 1.0 : undefined,
  });

  // An assessment was produced (published OR held as a draft for an
  // editor) — the submission's lifecycle is complete either way. Whether
  // it is publicly visible is a property of the CHECK (isDraft/
  // publishedAt), surfaced in the UI, not of the submission's status.
  await advance("verifying", "ready");

  return { kind: "check_created", checkId: check.id, enactment };
}
