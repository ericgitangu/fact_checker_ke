import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Database } from "@fact-checker-ke/db";
import type { CheckLifecycle, CredibilityTier } from "@fact-checker-ke/core";
import type { Publisher } from "./publisher.js";
import { isAuthoritativeTier, tierForUrl } from "./credibility-registry.js";

/**
 * ADR-0038 Wave 2 "Submit the truth" — the crowdsourced source-seeking
 * contract behind `POST /v1/checks/:id/sources` (routes/checks.ts).
 *
 * A submitted URL is UNTRUSTED content (ADR-0023/0036): it is resolved +
 * tiered server-side, and only an accepted tier≤2 (authoritative) source
 * counts toward the re-verify threshold. tier3/tier4/unknown are kept as
 * community context (`status: 'rejected'`) — persisted for the record, never
 * auto-ingested as evidence. Dedup is per (check, url): a repeat is an
 * idempotent `duplicate`.
 *
 * The DB work sits behind a `ClaimSourceStore` port so the route can run
 * against Postgres in prod and the core logic is unit-testable in-memory
 * without a database (the API's unit suite runs with no DATABASE_URL).
 */

/** The three lifecycle states a thread must be in to accept a source. */
const OPEN_FOR_SOURCES: readonly CheckLifecycle[] = ["preliminary", "awaiting_sources", "editor_review"];

export interface ClaimSourceCheckInfo {
  lifecycleState: CheckLifecycle | null;
  /** The checkable claim text, for the re-verify payload. Null if none persisted. */
  claimText: string | null;
  /** The owning submission id — the pipeline verify hop's identity key (ADR-0017). */
  submissionId: string;
  /** The owning org id — required by VerifyHopRequest. */
  orgId: string;
  /** The detected language (ISO, e.g. "sw"); re-verify grounds in it, not "en".
   * Null for legacy rows → falls back to "en". */
  language: string | null;
}

/** An accepted (tier≤2) source, as needed to build a re-verify injected_doc. */
export interface AcceptedSourceDoc {
  url: string;
  resolvedUrl: string | null;
  note: string | null;
}

export interface InsertClaimSourceRow {
  checkId: string;
  url: string;
  note: string | null;
  submitterDeviceHash: string;
  status: "accepted" | "rejected";
  credibilityTier: CredibilityTier;
  resolvedUrl: string | null;
}

export interface ClaimSourceStore {
  /** Check lifecycle + claim text, or null when the check does not exist. */
  getCheckInfo(checkId: string): Promise<ClaimSourceCheckInfo | null>;
  /** Resolve a submission id to its most-recent check id (the public trending
   * stream exposes submissionId but NEVER the draft check id). Null if none. */
  resolveCheckIdBySubmission(submissionId: string): Promise<string | null>;
  /** Has this exact URL already been submitted for this check? (dedup probe) */
  hasExistingUrl(checkId: string, url: string): Promise<boolean>;
  /** Insert the submission row. */
  insert(row: InsertClaimSourceRow): Promise<void>;
  /** Bump `checks.last_activity_at = now()` — a source is activity (TTL clock). */
  bumpLastActivity(checkId: string): Promise<void>;
  /** Count accepted tier≤2 (authoritative) sources for this check. */
  countAcceptedAuthoritative(checkId: string): Promise<number>;
  /** The accepted tier≤2 sources, for the re-verify injected_docs array. */
  listAcceptedAuthoritative(checkId: string): Promise<AcceptedSourceDoc[]>;
}

const AUTHORITATIVE_TIERS: CredibilityTier[] = ["tier1_primary", "tier2_established_media"];

/** Postgres-backed store (prod path), using the shared Drizzle handle. */
export class PostgresClaimSourceStore implements ClaimSourceStore {
  constructor(private readonly db: Database) {}

  async getCheckInfo(checkId: string): Promise<ClaimSourceCheckInfo | null> {
    const [check] = await this.db
      .select({
        lifecycleState: schema.checks.lifecycleState,
        submissionId: schema.checks.submissionId,
        orgId: schema.checks.orgId,
        normalizedClaim: schema.checks.normalizedClaim,
        language: schema.checks.language,
      })
      .from(schema.checks)
      .where(eq(schema.checks.id, checkId))
      .limit(1);
    if (!check) return null;
    // Prefer a checkable claim's text for the re-verify payload; fall back to
    // the first claim, then the stored normalized claim, else null (language
    // isn't persisted — see submitClaimSource, which defaults it to "en").
    const claimRows = await this.db
      .select({ text: schema.claims.text, claimType: schema.claims.claimType })
      .from(schema.claims)
      .where(eq(schema.claims.checkId, checkId));
    const checkable = claimRows.find((c) => c.claimType === "checkable");
    const claimText = (checkable ?? claimRows[0])?.text ?? check.normalizedClaim ?? null;
    return {
      lifecycleState: check.lifecycleState as CheckLifecycle | null,
      claimText,
      submissionId: check.submissionId,
      orgId: check.orgId,
      language: check.language,
    };
  }

  async resolveCheckIdBySubmission(submissionId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: schema.checks.id })
      .from(schema.checks)
      .where(eq(schema.checks.submissionId, submissionId))
      .orderBy(desc(schema.checks.createdAt))
      .limit(1);
    return row?.id ?? null;
  }

  async hasExistingUrl(checkId: string, url: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.claimSourceSubmissions.id })
      .from(schema.claimSourceSubmissions)
      .where(and(eq(schema.claimSourceSubmissions.checkId, checkId), eq(schema.claimSourceSubmissions.url, url)))
      .limit(1);
    return Boolean(row);
  }

  async insert(row: InsertClaimSourceRow): Promise<void> {
    await this.db.insert(schema.claimSourceSubmissions).values({
      checkId: row.checkId,
      url: row.url,
      note: row.note,
      submitterDeviceHash: row.submitterDeviceHash,
      status: row.status,
      credibilityTier: row.credibilityTier,
      resolvedUrl: row.resolvedUrl,
    });
  }

  async bumpLastActivity(checkId: string): Promise<void> {
    await this.db
      .update(schema.checks)
      .set({ lastActivityAt: sql`now()` })
      .where(eq(schema.checks.id, checkId));
  }

  async countAcceptedAuthoritative(checkId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.claimSourceSubmissions)
      .where(
        and(
          eq(schema.claimSourceSubmissions.checkId, checkId),
          eq(schema.claimSourceSubmissions.status, "accepted"),
          inArray(schema.claimSourceSubmissions.credibilityTier, AUTHORITATIVE_TIERS),
        ),
      );
    return row?.n ?? 0;
  }

  async listAcceptedAuthoritative(checkId: string): Promise<AcceptedSourceDoc[]> {
    const rows = await this.db
      .select({
        url: schema.claimSourceSubmissions.url,
        resolvedUrl: schema.claimSourceSubmissions.resolvedUrl,
        note: schema.claimSourceSubmissions.note,
      })
      .from(schema.claimSourceSubmissions)
      .where(
        and(
          eq(schema.claimSourceSubmissions.checkId, checkId),
          eq(schema.claimSourceSubmissions.status, "accepted"),
          inArray(schema.claimSourceSubmissions.credibilityTier, AUTHORITATIVE_TIERS),
        ),
      );
    return rows.map((r) => ({ url: r.url, resolvedUrl: r.resolvedUrl, note: r.note }));
  }
}

/**
 * Non-durable, seedable double (same role as the `InMemory*Repository`
 * classes) used by the unit suite, which runs with no DATABASE_URL. Seed a
 * check's lifecycle + claim text, then exercise the full `submitClaimSource`
 * flow without Postgres. NOT wired into app.ts (in-memory mode uses a null
 * store → 501), because it holds no cross-request durable state.
 */
export class InMemoryClaimSourceStore implements ClaimSourceStore {
  private readonly checks = new Map<string, ClaimSourceCheckInfo>();
  private readonly rows: Array<InsertClaimSourceRow> = [];
  readonly bumped: string[] = [];

  seedCheck(checkId: string, info: ClaimSourceCheckInfo): void {
    this.checks.set(checkId, info);
  }

  /** The rows inserted so far — tests assert on status/tier/resolvedUrl. */
  get inserted(): ReadonlyArray<InsertClaimSourceRow> {
    return this.rows;
  }

  async getCheckInfo(checkId: string): Promise<ClaimSourceCheckInfo | null> {
    return this.checks.get(checkId) ?? null;
  }

  async resolveCheckIdBySubmission(submissionId: string): Promise<string | null> {
    for (const [checkId, info] of this.checks) {
      if (info.submissionId === submissionId) return checkId;
    }
    return null;
  }

  async hasExistingUrl(checkId: string, url: string): Promise<boolean> {
    return this.rows.some((r) => r.checkId === checkId && r.url === url);
  }

  async insert(row: InsertClaimSourceRow): Promise<void> {
    this.rows.push(row);
  }

  async bumpLastActivity(checkId: string): Promise<void> {
    this.bumped.push(checkId);
  }

  async countAcceptedAuthoritative(checkId: string): Promise<number> {
    return this.listAcceptedSync(checkId).length;
  }

  async listAcceptedAuthoritative(checkId: string): Promise<AcceptedSourceDoc[]> {
    return this.listAcceptedSync(checkId).map((r) => ({ url: r.url, resolvedUrl: r.resolvedUrl, note: r.note }));
  }

  private listAcceptedSync(checkId: string): InsertClaimSourceRow[] {
    return this.rows.filter(
      (r) => r.checkId === checkId && r.status === "accepted" && AUTHORITATIVE_TIERS.includes(r.credibilityTier),
    );
  }
}

export interface SubmitClaimSourceDeps {
  /** Resolve a URL to its final (post-redirect) URL, or null on failure. */
  resolveUrl: (url: string) => Promise<string | null>;
  publisher: Publisher;
  /** The pipeline verify-hop URL the re-verify is published to via QStash. */
  reverifyHopUrl: string;
  /** Accepted tier≤2 count at/above which a re-verify is enqueued. */
  reverifyThreshold: number;
}

export interface SubmitClaimSourceArgs {
  checkId: string;
  url: string;
  note: string | null;
  deviceHash: string;
}

export type ClaimSourceOutcome = {
  status: "accepted" | "rejected" | "duplicate";
  reVerifyQueued: boolean;
};

export type ClaimSourceResult =
  | { ok: true; httpStatus: number; value: ClaimSourceOutcome }
  | { ok: false; httpStatus: number; error: { code: string; message: string } };

/**
 * The exact re-verify payload published (via QStash) to the pipeline verify
 * hop. This is intentionally a valid `services/pipeline` `VerifyHopRequest`
 * (that model has `extra="forbid"`, so NO extra keys — the pipeline tells a
 * re-verify apart purely by `injected_docs` being present, not by a flag): the
 * check is re-identified by `submission_id` (the hop's ADR-0017 identity key),
 * not a check id. Field bounds mirror the pipeline model: `claim_text` ≤2000,
 * each injected doc's `url` ≤2048, `title` 1..500, `text` 1..20000 (and all
 * three non-empty — an empty `text` would fail the pipeline's InjectedDoc
 * validation, so `text` falls back to the domain when there's no note).
 *
 * `language` is best-effort "en": no language column is persisted on checks/
 * claims today, so the pipeline re-detects from `claim_text`.
 */
export interface ReverifyInjectedDoc {
  url: string;
  title: string;
  text: string;
}
export interface ReverifyPayload {
  submission_id: string;
  org_id: string;
  claim_text: string;
  language: string;
  injected_docs: ReverifyInjectedDoc[];
}

const MAX_CLAIM_TEXT = 2000;
const MAX_DOC_TEXT = 20000;
const MAX_DOC_TITLE = 500;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function submitClaimSource(
  store: ClaimSourceStore,
  deps: SubmitClaimSourceDeps,
  args: SubmitClaimSourceArgs,
): Promise<ClaimSourceResult> {
  const info = await store.getCheckInfo(args.checkId);
  if (!info) {
    return { ok: false, httpStatus: 404, error: { code: "not_found", message: `Check ${args.checkId} not found.` } };
  }
  // A source only attaches to an OPEN thread (preliminary/awaiting_sources/
  // editor_review). A published/dismissed/archived/verifying check is not
  // accepting community sources — 409 (conflict), not a silent drop.
  if (!info.lifecycleState || !OPEN_FOR_SOURCES.includes(info.lifecycleState)) {
    return {
      ok: false,
      httpStatus: 409,
      error: {
        code: "lifecycle_closed",
        message: "This check is not accepting sources (only preliminary, awaiting_sources, or editor_review threads do).",
      },
    };
  }

  // Dedup per (check, url): a repeat submission is an idempotent no-op — the row
  // already exists, so we don't insert again or re-trigger a re-verify.
  if (await store.hasExistingUrl(args.checkId, args.url)) {
    return { ok: true, httpStatus: 200, value: { status: "duplicate", reVerifyQueued: false } };
  }

  // Resolve server-side (follow redirects) and tier the FINAL domain — a URL
  // shortener or tracking wrapper shouldn't hide the real host's tier.
  const resolvedUrl = await deps.resolveUrl(args.url);
  const tier = tierForUrl(resolvedUrl ?? args.url);
  const authoritative = isAuthoritativeTier(tier);
  const status: "accepted" | "rejected" = authoritative ? "accepted" : "rejected";

  await store.insert({
    checkId: args.checkId,
    url: args.url,
    note: args.note,
    submitterDeviceHash: args.deviceHash,
    status,
    credibilityTier: tier,
    resolvedUrl,
  });
  await store.bumpLastActivity(args.checkId);

  let reVerifyQueued = false;
  if (status === "accepted") {
    const acceptedCount = await store.countAcceptedAuthoritative(args.checkId);
    // Guard: the pipeline VerifyHopRequest requires a non-empty claim_text
    // (min_length 1). A check with no claim text AND no normalized claim can't
    // form a valid re-verify — skip the enqueue (the source is still accepted
    // and persisted; it just doesn't trigger a re-verify) rather than publish an
    // invalid request the hop would 422.
    const claimText = (info.claimText ?? "").trim().slice(0, MAX_CLAIM_TEXT);
    if (acceptedCount >= deps.reverifyThreshold && claimText.length > 0) {
      const docs = await store.listAcceptedAuthoritative(args.checkId);
      const payload: ReverifyPayload = {
        submission_id: info.submissionId,
        org_id: info.orgId,
        claim_text: claimText,
        language: info.language ?? "en",
        injected_docs: docs.map((d) => {
          const docUrl = (d.resolvedUrl ?? d.url).slice(0, 2048);
          const title = hostOf(docUrl).slice(0, MAX_DOC_TITLE);
          // InjectedDoc.text is min_length 1 — fall back to the domain title
          // when the submitter left no note, so the doc never fails validation.
          const text = ((d.note ?? "").trim() || title).slice(0, MAX_DOC_TEXT);
          return { url: docUrl, title, text };
        }),
      };
      // Dedup id keyed on (check, accepted-count): crossing the threshold at a
      // given count enqueues at most once, so a QStash retry of the submit — or
      // a double-tap — never double-fans-out, while a LATER accepted source
      // (a higher count, more docs) does enqueue a fresh, richer re-verify.
      // NOTE: QStash DeduplicationId must not contain ':' — use '-' (checkId is a
      // UUID, so hyphen-joining stays collision-free).
      try {
        await deps.publisher.publish({
          url: deps.reverifyHopUrl,
          body: payload,
          deduplicationId: `reverify-${args.checkId}-${acceptedCount}`,
        });
        reVerifyQueued = true;
      } catch {
        // Non-fatal: the source is already stored + accepted. A failed re-verify
        // enqueue must not fail the submission (the next accepted source, or the
        // expiry sweep, still moves the item). reVerifyQueued stays false.
        reVerifyQueued = false;
      }
    }
  }

  return { ok: true, httpStatus: 201, value: { status, reVerifyQueued } };
}

/**
 * Best-effort server-side URL resolution: follow redirects with a bounded
 * timeout and return the final URL, or null on any failure (the caller then
 * tiers the submitted URL as-is). Tries HEAD first (cheap), falling back to GET
 * for hosts that reject HEAD. Never throws — a bad/slow URL must not 500 the
 * endpoint.
 */
export async function resolveUrlServerSide(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4000,
): Promise<string | null> {
  for (const method of ["HEAD", "GET"] as const) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method, redirect: "follow", signal: controller.signal });
      clearTimeout(timer);
      if (res.ok || res.status < 400) return res.url || url;
      // A 4xx/5xx on HEAD is worth a GET retry; on GET, give up (resolve to null).
      if (method === "GET") return null;
    } catch {
      clearTimeout(timer);
      if (method === "GET") return null;
    }
  }
  return null;
}
