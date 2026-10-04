import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  AttributionSchema,
  ClaimTypeSchema,
  CommentStatusSchema,
  CredibilityTierSchema,
  DemonstrationStatusSchema,
  EVENT_TYPES,
  RatingSchema,
  ReviewActionTypeSchema,
  RightOfReplyStatusSchema,
  RiskTierSchema,
  RoleSchema,
  SubmissionStatusSchema,
  WaitlistSourceSchema,
} from "@fact-checker-ke/core";

/**
 * ADR-0031 amendment (two-engine pivot) / AT-0031-9, AT-0025-6: the
 * async-audit queue's disposition. `pending` until an editor samples it;
 * `confirmed` = audited, no issue found; `error_found` = audited, an
 * error was found — the editor-side handler for that outcome MUST then
 * call `correctCheck` (services/api/src/lib/editorial.ts), which writes
 * a NEW `checks` row (`check.corrected`), never an update of this row's
 * outcome standing in for a correction.
 */
const ASYNC_AUDIT_OUTCOMES = ["pending", "confirmed", "error_found"] as const;

/**
 * zod v4 types `.options` as `T[]`; Drizzle's pgEnum requires a non-empty
 * tuple. Assert non-emptiness at module load (an empty enum is a contract bug)
 * instead of casting blindly.
 */
function enumValues<T extends string>(name: string, values: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error(`pgEnum ${name}: zod enum has no values`);
  return [first, ...rest];
}

/**
 * Postgres enums built from the zod enums exported by @fact-checker-ke/core,
 * so enum values have exactly one source of truth (ADR-0009 decision). Any
 * future enum value added in core/src/schemas/*.ts is picked up here
 * automatically on the next `drizzle-kit generate`.
 */
export const submissionStatusEnum = pgEnum("submission_status", enumValues("submission_status", SubmissionStatusSchema.options));
export const ratingEnum = pgEnum("rating", enumValues("rating", RatingSchema.options));
export const claimTypeEnum = pgEnum("claim_type", enumValues("claim_type", ClaimTypeSchema.options));
export const credibilityTierEnum = pgEnum("credibility_tier", enumValues("credibility_tier", CredibilityTierSchema.options));
export const demonstrationStatusEnum = pgEnum("demonstration_status", enumValues("demonstration_status", DemonstrationStatusSchema.options));
export const waitlistSourceEnum = pgEnum("waitlist_source", enumValues("waitlist_source", WaitlistSourceSchema.options));

/**
 * ADR-0017 §5 event types, sourced from @fact-checker-ke/core's
 * `EVENT_TYPES` tuple (same single-source-of-truth rule as the other
 * enums above). Drives `outbox.event_type` and `submission_events.event_type`.
 */
export const eventTypeEnum = pgEnum("event_type", enumValues("event_type", EVENT_TYPES));

export const roleEnum = pgEnum("role", enumValues("role", RoleSchema.options));
export const attributionEnum = pgEnum("attribution", enumValues("attribution", AttributionSchema.options));
export const reviewActionTypeEnum = pgEnum(
  "review_action_type",
  enumValues("review_action_type", ReviewActionTypeSchema.options),
);
export const rightOfReplyStatusEnum = pgEnum(
  "right_of_reply_status",
  enumValues("right_of_reply_status", RightOfReplyStatusSchema.options),
);
export const commentStatusEnum = pgEnum("comment_status", enumValues("comment_status", CommentStatusSchema.options));
export const riskTierEnum = pgEnum("risk_tier", enumValues("risk_tier", RiskTierSchema.options));
export const asyncAuditOutcomeEnum = pgEnum("async_audit_outcome", ASYNC_AUDIT_OUTCOMES);

/**
 * ADR-0031: the source of a flywheel-captured labeled row — an editor's
 * disposition on a draft (`editor_correction`), or a reader's post-publish
 * signal (`user_agree` / `user_dispute`).
 */
export const trainingLabelSourceEnum = pgEnum("training_label_source", [
  "editor_correction",
  "user_agree",
  "user_dispute",
]);

/**
 * `llm_calls.stage` is internal pipeline bookkeeping, not part of the
 * public core contracts, so it stays a locally-defined enum rather than
 * one sourced from @fact-checker-ke/core.
 */
export const llmStageEnum = pgEnum("llm_stage", [
  "normalize",
  "transcribe",
  "extract",
  "retrieve",
  "draft",
]);

/**
 * pgvector's `vector(n)` type has no first-class drizzle-orm column
 * builder as of drizzle-orm 0.38, so it's declared as a custom type.
 * 384 dims matches the multilingual sentence-embedding model chosen for
 * claim retrieval (ADR-0009 decision update) — NOT OpenAI's 1536-dim
 * text-embedding-3-small used in the original hand-written migration.
 */
const vector384 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(384)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .filter((part) => part.length > 0)
      .map(Number);
  },
});

const ORG_DEFAULT = sql`'00000000-0000-0000-0000-000000000001'`;

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id)
      .default(ORG_DEFAULT),
    url: text("url"),
    text: text("text"),
    submittedBy: text("submitted_by"),
    // ADR-0021 AT-0021-4 (data-lifecycle hardening pass): the hashed
    // (sha256, same `hashDeviceToken` as `comments.authorDeviceHash`)
    // ADR-0020 device token that created this submission. Nullable —
    // historical rows predate this column, and some future ingestion
    // path (e.g. an editor-entered tip) may legitimately have none —
    // but every row written via POST /v1/submissions after this change
    // sets it, which is what makes a DSAR export by device token
    // actually able to find a caller's own submissions/drafts (closes
    // the schema gap `runDsarExport`'s docblock in retention.ts used to
    // flag as a stub).
    deviceTokenHash: text("device_token_hash"),
    // ADR-0002/0004 amendment #6: user-supplied quote + timestamp for
    // third-party video URLs (we never download the audio).
    quote: text("quote"),
    timestampSec: integer("timestamp_sec"),
    status: submissionStatusEnum("status").notNull().default("received"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // ADR-0018: the polling ETag is derived from (status, updated_at).
    // There is no DB trigger — every write path that changes `status`
    // (lib/state-machine.ts's conditional UPDATE, and the initial
    // insert) must also set this column explicitly; it is NOT
    // automatic on UPDATE in Postgres without a trigger we deliberately
    // don't add (one more moving part for a single-column need).
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("submissions_org_id_idx").on(table.orgId),
    index("submissions_device_token_hash_idx").on(table.deviceTokenHash),
    check(
      "submissions_url_or_text",
      sql`(${table.url} is not null and ${table.text} is null) or (${table.url} is null and ${table.text} is not null)`,
    ),
  ],
);

export const credibilityRegistry = pgTable("credibility_registry", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id)
    .default(ORG_DEFAULT),
  domain: text("domain").notNull().unique(),
  credibilityTier: credibilityTierEnum("credibility_tier").notNull(),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id)
      .default(ORG_DEFAULT),
    url: text("url").notNull(),
    title: text("title").notNull(),
    publisher: text("publisher").notNull(),
    credibilityTier: credibilityTierEnum("credibility_tier").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
    excerpt: text("excerpt"),
  },
  (table) => [index("sources_org_id_idx").on(table.orgId)],
);

export const checks = pgTable(
  "checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id)
      .default(ORG_DEFAULT),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    rating: ratingEnum("rating"),
    isDraft: boolean("is_draft").notNull().default(true),
    reviewedBy: text("reviewed_by"),
    // ADR-0024 §8: a check tagged to an ongoing protest event (via its
    // demonstration) has comments disabled regardless of the comment
    // row state, until the demonstration is marked concluded. Nullable:
    // most checks have no tracker tie-in at all.
    demonstrationId: uuid("demonstration_id").references(() => demonstrations.id),
    // ADR-0025 §6: a correction is additive — `correctedFromCheckId`
    // chains a corrected check back to the verdict it supersedes, so
    // the history view can show both rather than overwriting a row.
    correctedFromCheckId: uuid("corrected_from_check_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // ADR-0031: the measured-calibrated confidence weight (NOT the raw LLM
    // confidence — see services/pipeline/app/eval/calibrate.py), the
    // falsifiability note the pipeline already emits, and the risk tier
    // that drove the publish-policy decision (app/stages/risk_tier.py /
    // publish_policy.py). All three are nullable: a fresh draft has none
    // of them; the application-level CheckSchema `superRefine` (packages/
    // core/src/schemas/check.ts) is what actually enforces they're
    // present before a Check is treated as published.
    calibratedConfidence: numeric("calibrated_confidence", { precision: 5, scale: 4 }),
    whatWouldChangeThis: text("what_would_change_this"),
    riskTier: riskTierEnum("risk_tier"),
  },
  (table) => [
    index("checks_org_id_idx").on(table.orgId),
    index("checks_submission_id_idx").on(table.submissionId),
    index("checks_demonstration_id_idx").on(table.demonstrationId),
    check(
      "checks_published_requires_rating",
      sql`${table.publishedAt} is null or ${table.rating} is not null`,
    ),
  ],
);

/**
 * ADR-0031: cited evidence backing a Check's assessment. One row per
 * (check, source, quoted span) — a check normally cites several sources,
 * and a source can be quoted more than once for different spans, hence a
 * separate table rather than a jsonb array on `checks` (keeps the FK to
 * `sources` real and queryable, e.g. "which checks cite source X").
 */
export const checkEvidence = pgTable(
  "check_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => checks.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    quote: text("quote").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("check_evidence_check_id_idx").on(table.checkId)],
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id)
      .default(ORG_DEFAULT),
    checkId: uuid("check_id")
      .notNull()
      .references(() => checks.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    claimType: claimTypeEnum("claim_type").notNull(),
    spanStart: integer("span_start"),
    spanEnd: integer("span_end"),
    // 384 dims — multilingual sentence-embedding model (ADR-0009 decision
    // update). ivfflat index created in a follow-on migration once there
    // are enough rows to pick a sane `lists` value (empty-table ivfflat
    // index builds are a known footgun — tracked as tech debt below).
    embedding: vector384("embedding"),
    // ADR-0004/0025: gates rating/attribution visibility to the
    // submitter (AT-0004-A/B) until an editor confirms the quote.
    namedPerson: boolean("named_person").notNull().default(false),
    attribution: attributionEnum("attribution").notNull().default("not_applicable"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("claims_org_id_idx").on(table.orgId),
    index("claims_check_id_idx").on(table.checkId),
  ],
);

export const demonstrations = pgTable(
  "demonstrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id)
      .default(ORG_DEFAULT),
    title: text("title").notNull(),
    area: text("area").notNull(),
    county: text("county").notNull(),
    status: demonstrationStatusEnum("status").notNull(),
    date: date("date"),
    summary: text("summary").notNull(),
    sourceUrl: text("source_url"),
    // ADR-0024 §8: an explicit override flag, reserved for a later
    // "re-enable before conclusion" exception. The primary gate is
    // `status === 'ongoing'` (checked in application code, see
    // services/api/src/lib/moderation.ts#commentsAllowedForDemonstration) —
    // this column defaults true and only MATTERS when status is
    // 'ongoing', since a concluded/upcoming event is never gated by it.
    commentsEnabled: boolean("comments_enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("demonstrations_org_id_idx").on(table.orgId)],
);

export const llmCalls = pgTable(
  "llm_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id)
      .default(ORG_DEFAULT),
    stage: llmStageEnum("stage").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    usd: numeric("usd", { precision: 10, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("llm_calls_org_id_idx").on(table.orgId), index("llm_calls_stage_idx").on(table.stage)],
);

/**
 * Waitlist signups (POST /v1/waitlist). Idempotent on normalised
 * (lowercased) email via the unique index — the route relies on
 * `on conflict (email) do nothing` returning zero rows to detect
 * "already joined" rather than a pre-check + insert race.
 */
export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    source: waitlistSourceEnum("source").notNull().default("site"),
    referrer: text("referrer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("waitlist_signups_email_idx").on(table.email)],
);

/**
 * ADR-0017 §1: the transactional outbox. A row is inserted in the SAME
 * transaction as the state change it announces. `published_at` is set
 * by the relay (inline, then the sweeper) after a successful QStash
 * publish; `id` doubles as the QStash `Upstash-Deduplication-Id` so a
 * relay crash between publish and mark can't fan out twice.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: eventTypeEnum("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [
    // Partial index: the relay's `SELECT ... WHERE published_at IS NULL
    // FOR UPDATE SKIP LOCKED` only ever scans unpublished rows, and a
    // full-table index would grow unboundedly as published rows pile up.
    index("outbox_unpublished_idx")
      .on(table.createdAt)
      .where(sql`${table.publishedAt} is null`),
    index("outbox_aggregate_idx").on(table.aggregateType, table.aggregateId),
  ],
);

/**
 * ADR-0017 §2 (broker -> consumer layer): the inbox. A duplicate QStash
 * delivery fails the PK insert, so the handler acks without re-running
 * its side effects. `handler` scopes the id so two different handlers
 * invoked with coincidentally-equal message ids (shouldn't happen, but
 * cheap to guard) don't collide.
 */
export const processedMessages = pgTable("processed_messages", {
  messageId: text("message_id").notNull(),
  handler: text("handler").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("processed_messages_message_handler_idx").on(table.messageId, table.handler),
]);

/**
 * ADR-0017 §2 (client -> API layer): the idempotency-key table.
 * `request_hash` is the SHA-256 of the canonicalised request body, so a
 * replay with the same key + same body returns `response_body` as-is,
 * and same key + different body is a 422 (see services/api/src/lib/idempotency.ts).
 * TTL is 24h, enforced by the outbox-drain sweeper's cleanup pass, not a
 * cron (ADR-0017 cost policy: no always-on worker).
 */
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: uuid("key").primaryKey(),
  requestHash: text("request_hash").notNull(),
  responseStatus: integer("response_status").notNull(),
  responseBody: jsonb("response_body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-submission replay log for SSE `Last-Event-ID` resume (ADR-0018
 * §"Resume"). Every outbox event for a submission also lands here
 * (same transaction) so the SSE handler can replay "everything after
 * event X" from Postgres without re-reading the outbox's cross-aggregate
 * rows. `eventId` is unique so a resume replay can never duplicate.
 */
export const submissionEvents = pgTable(
  "submission_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    eventType: eventTypeEnum("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("submission_events_submission_id_idx").on(table.submissionId, table.occurredAt),
    uniqueIndex("submission_events_event_id_idx").on(table.eventId),
  ],
);

/**
 * ADR-0020 §1 (anonymous-token slice). The API never stores the raw
 * token — only its SHA-256 hash — so a row leak doesn't hand out live
 * bearer credentials. This is also the quota key for ADR-0011/0009's
 * per-device caps (CGNAT-safe: keyed on device, not bare IP).
 */
export const deviceTokens = pgTable("device_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ADR-0020 §4: editor/admin/moderator accounts, self-hosted (Neon-backed,
 * no vendor identity product). `passwordHash` is scrypt (node:crypto,
 * no external dependency) — see services/api/src/lib/auth/password.ts.
 * `mfaEnabled` only flips true once a TOTP secret has been verified
 * (totp_secrets.verifiedAt set) — enforced in application code
 * (services/api/src/lib/auth/service.ts), since "no role grant without
 * verified MFA" (AT-0020-3) is a cross-table invariant Postgres CHECK
 * constraints can't express without a trigger (deliberately avoided —
 * one more moving part for an invariant the service layer already owns).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  // Nullable: a freshly registered account has NO role until an
  // admin (or the bootstrap path, see services/api/src/lib/auth/service.ts)
  // grants one, and a grant is rejected without verified MFA
  // (AT-0020-3) -- this column being nullable is what makes "pending,
  // ungranted" a representable, queryable state rather than a role
  // value standing in for "not yet real".
  role: roleEnum("role"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("users_email_idx").on(table.email)]);

/**
 * One row per user (1:1) holding the TOTP secret. Separate from `users`
 * so an unverified enrollment-in-progress never touches the `users` row
 * (and so `users.mfa_enabled` can't drift from "is there a verified
 * secret" without an explicit write to both in the same transaction).
 */
export const totpSecrets = pgTable("totp_secrets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secretBase32: text("secret_base32").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * SEC-3 (security-hardening finding #3, 2026-10-04): single-use tracking
 * for TOTP codes. `verifyTotpCode` (app/lib/auth/totp.ts) accepts a code
 * for its whole +/-1 step (90s) drift window with no state of its own --
 * without this table, the SAME code could be replayed any number of
 * times within that window, across both the enrollment-verification and
 * login call sites. One row per (user, counter) actually consumed; a
 * duplicate insert for an already-used counter is the replay rejection
 * (`ON CONFLICT DO NOTHING`, checked by rows-returned, same pattern as
 * `comment_reports`'s dedup). Rows are small and effectively
 * append-only; a scheduled prune of rows older than the drift window
 * (a few minutes) is tech debt -- not implemented here, since an unused
 * extra row has no behavioural effect, only a few bytes of storage.
 */
export const totpUsedCodes = pgTable(
  "totp_used_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    counter: integer("counter").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("totp_used_codes_user_counter_idx").on(table.userId, table.counter)],
);

/**
 * Opaque, hashed (sha256) session tokens — same pattern as
 * `device_tokens`, applied to authenticated editor/admin/moderator
 * sessions instead of anonymous devices.
 */
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("sessions_user_id_idx").on(table.userId)]);

/**
 * ADR-0020 §5: immutable append-only audit log. Enforcement of
 * "no update/delete" is at the application level (no repository method
 * ever issues one — see services/api/src/lib/audit.ts) — a DB-role-level
 * REVOKE UPDATE/DELETE would need a non-owner Postgres role, which
 * Neon's single `neondb_owner` connection string doesn't provide for
 * this project; tracked as tech debt below.
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_log_actor_id_idx").on(table.actorId),
  index("audit_log_target_idx").on(table.targetType, table.targetId),
]);

/**
 * ADR-0025 §6: every editor disposition on a check, append-only. Never
 * updated/deleted — a `correct` writes a NEW checks row
 * (`correctedFromCheckId` chains it) plus a new review_actions row;
 * the original review_actions row for the prior check is untouched.
 */
export const reviewActions = pgTable("review_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  checkId: uuid("check_id")
    .notNull()
    .references(() => checks.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  action: reviewActionTypeEnum("action").notNull(),
  notes: text("notes"),
  publicSafetyReason: text("public_safety_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("review_actions_check_id_idx").on(table.checkId)]);

/**
 * ADR-0025 §4: right-of-reply workflow state for a named-person draft.
 * One row per (check, named person) — a check naming two people gets two rows.
 */
export const rightOfReply = pgTable("right_of_reply", {
  id: uuid("id").primaryKey().defaultRandom(),
  checkId: uuid("check_id")
    .notNull()
    .references(() => checks.id, { onDelete: "cascade" }),
  namedPerson: text("named_person").notNull(),
  contactChannel: text("contact_channel"),
  contactAttemptAt: timestamp("contact_attempt_at", { withTimezone: true }),
  windowExpiresAt: timestamp("window_expires_at", { withTimezone: true }),
  replyReceivedAt: timestamp("reply_received_at", { withTimezone: true }),
  replyText: text("reply_text"),
  status: rightOfReplyStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("right_of_reply_check_id_idx").on(table.checkId)]);

/**
 * ADR-0024 §1: comments on published checks only. `authorDeviceHash`
 * reuses the ADR-0020 device-token hash (accountability without
 * requiring a full account) — a registered user's comments also carry
 * their device hash from the session that posted them.
 */
export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  checkId: uuid("check_id")
    .notNull()
    .references(() => checks.id, { onDelete: "cascade" }),
  authorDeviceHash: text("author_device_hash").notNull(),
  body: text("body").notNull(),
  status: commentStatusEnum("status").notNull().default("pending"),
  reportCount: integer("report_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("comments_check_id_idx").on(table.checkId),
  index("comments_status_idx").on(table.status),
]);

/**
 * ADR-0024 §3: three reports from three DISTINCT device identities
 * auto-hide a comment. Unique on (comment, reporter) so the same device
 * reporting twice counts once — this is what makes "two reports from
 * devices sharing one identity" (AT-0024-2) a no-op.
 */
export const commentReports = pgTable("comment_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  commentId: uuid("comment_id")
    .notNull()
    .references(() => comments.id, { onDelete: "cascade" }),
  reporterDeviceHash: text("reporter_device_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("comment_reports_comment_reporter_idx").on(table.commentId, table.reporterDeviceHash),
]);

/**
 * ADR-0024 §4: a reader-side block (client-filters that blocker's view
 * only — NOT a global ban, which is an editor/admin action via
 * comments.status = 'hidden').
 */
export const commentBlocks = pgTable("comment_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  blockerDeviceHash: text("blocker_device_hash").notNull(),
  blockedDeviceHash: text("blocked_device_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("comment_blocks_pair_idx").on(table.blockerDeviceHash, table.blockedDeviceHash),
]);

/**
 * ADR-0021 retention table, seeded (db/migrations) with the ADR's rows.
 * `retentionDays: null` = indefinite. Read by the sweeper
 * (services/api/src/lib/retention.ts) so the retention period lives in
 * data, not hardcoded in the sweep query.
 */
export const retentionPolicy = pgTable("retention_policy", {
  dataClass: text("data_class").primaryKey(),
  retentionDays: integer("retention_days"),
  notes: text("notes").notNull().default(""),
});

/**
 * ADR-0021 "DSAR flow": an append-only log of each manual export run,
 * distinct from audit_log (which logs editor ACTIONS, not export
 * contents/subjects).
 */
export const dsarRequests = pgTable("dsar_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestedBy: uuid("requested_by")
    .notNull()
    .references(() => users.id),
  deviceTokenHash: text("device_token_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ADR-0031 "data flywheel" (ADR-0021 retention/audit tables is where these
 * rows live, per the task's file-ownership note): every editor correction
 * and every reader agree/dispute signal becomes a labeled training/eval
 * row. Append-only — never updated/deleted, same discipline as
 * `review_actions`/`audit_log` — so the flywheel's eval set is a growing,
 * reproducible history rather than a mutable "current belief" table.
 * `checkId`/`claimId` are both nullable because a user dispute signal may
 * target a check with no single claim singled out.
 */
export const trainingEvalLabels = pgTable(
  "training_eval_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id").references(() => checks.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").references(() => claims.id, { onDelete: "cascade" }),
    source: trainingLabelSourceEnum("source").notNull(),
    // The actor who produced this label: a user_id for an editor
    // correction, or a hashed device identity for a reader signal — kept
    // as a free string (not an FK) because the two identity spaces
    // (users.id vs device hash) differ, same pattern as
    // comments.authorDeviceHash vs review_actions.actorId.
    actorRef: text("actor_ref").notNull(),
    // The structured label payload: e.g. { correctedRating, notes } for an
    // editor correction, or { agreed: boolean, reason } for a reader
    // signal. jsonb rather than fixed columns because the shape differs
    // per `source` and the eval harness (services/pipeline/app/eval)
    // consumes it as data, not as typed application state.
    label: jsonb("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("training_eval_labels_check_id_idx").on(table.checkId),
    index("training_eval_labels_source_idx").on(table.source),
    // ADR-0031 review finding: one actor (device hash or editor id) can
    // otherwise flood the labeled dataset with duplicate signals on the
    // same check by resubmitting (double-tap, buggy client retry, or a
    // deliberate attempt to weight the flywheel). This UNIQUE constraint
    // is what `captureUserSignal`'s upsert (services/api/src/lib/
    // flywheel.ts) relies on via `onConflictDoUpdate` — last-signal-wins
    // per (check, actor) pair rather than accumulating N rows.
    uniqueIndex("training_eval_labels_check_actor_idx").on(table.checkId, table.actorRef),
  ],
);

/**
 * ADR-0031 hard constraint 2 / AT-0031-5: the live publish-policy flags
 * (global auto-publish kill switch, per-tier thresholds, Tier-C relaxation
 * state). A SINGLE current-value row per `key`, mutated only through
 * services/api/src/lib/policy-audit.ts, which writes the new value here
 * AND an audit_log row in the same transaction — never one without the
 * other. `advocateSignoffRef` is required (enforced in application code,
 * not a CHECK constraint, since it's only required for the specific
 * `tier_c_relaxation_enabled` key, not every flag) whenever a write
 * relaxes the Tier-C human gate.
 */
export const policyFlags = pgTable("policy_flags", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  advocateSignoffRef: text("advocate_signoff_ref"),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ADR-0030 "creator-funnel conflict-of-interest firewall" (AT-0030-1):
 * append-only audit record of every founder-channel (YouTube/TikTok)
 * post that references a published check. The row shape matches
 * docs/architecture/creator-funnel-firewall.md's "rule 3" table exactly:
 * `{ check_id, published_at, funnel_post_url, posted_at, ai_disclosed }`
 * (`published_at` is derived from `checks.publishedAt` at write time —
 * recorded here too, denormalized, so the audit record is self-contained
 * even if a check's `publishedAt` could ever change, and so AT-0030-1's
 * "published_at earlier than posted_at" check can run against this
 * table alone without a join).
 *
 * This is a firewall/audit record, not a feature: nothing reads this
 * table to drive editorial decisions (ADR-0030 rule 2 — the editor
 * queue/priority code path takes no funnel-sourced parameter, enforced
 * by the simple fact that no such code exists, not by this table).
 * `revenueCents` is nullable and unused by any code path in this pass
 * (AT-0030-4, the funding-transparency page line item, is apps/web
 * territory out of scope here) — present now so a future web change
 * doesn't need another migration just to add a revenue column to an
 * append-only audit table.
 */
export const funnelAuditLog = pgTable(
  "funnel_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => checks.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    funnelPostUrl: text("funnel_post_url").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    platform: text("platform").notNull(),
    aiDisclosed: boolean("ai_disclosed").notNull(),
    revenueCents: integer("revenue_cents"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("funnel_audit_log_check_id_idx").on(table.checkId),
    // AT-0030-1's invariant, enforced at the database level (belt-and-
    // suspenders alongside the application-layer check in
    // services/api/src/lib/flywheel.ts#recordFunnelPost): a row can
    // never claim a post predates the check's own publication.
    check("funnel_audit_log_posted_after_published", sql`${table.postedAt} >= ${table.publishedAt}`),
  ],
);

/**
 * ADR-0031 amendment (two-engine pivot) / AT-0031-9, AT-0025-6/7: the
 * async-audit sampling queue. The editor is no longer a pre-publish
 * approver for Tier A/B and Tier-C mode (a) — a row here is the record
 * that a published check was SAMPLED for post-publish human audit, at
 * what rate (`sampleRateAtQueueTime`, a snapshot of
 * app/eval/calibrate.py's `compute_audit_sample_rate` output at the
 * moment this row was written — a later recomputation naturally yields
 * a different rate for later checks, which is exactly "an output, not a
 * constant").
 *
 * ONE row per published check (`uniqueIndex` below) — a check is queued
 * for audit at most once, at publish time; an outcome is recorded by
 * UPDATING this row's `outcome`/`auditedBy`/`auditedAt`/`notes`
 * (deliberately mutable, unlike `audit_log`/`review_actions`: this is a
 * worklist row, not an append-only history record — the HISTORY of what
 * happened to the check is `review_actions` + a `check.corrected` row on
 * an error finding, both append-only; this row only tracks "has someone
 * looked at the sampled item yet").
 */
export const asyncAuditQueue = pgTable(
  "async_audit_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => checks.id, { onDelete: "cascade" }),
    tier: riskTierEnum("tier").notNull(),
    // "open_question" (Tier-C mode a) | "plain_caveat" (Tier A/B, or
    // Tier-C mode c under advocate sign-off) — mirrors
    // app/stages/publish_policy.py's `PublishDecision.publish_mode`.
    // Free text (not a pgEnum) because new publish modes are a config/
    // product concern this table should not need a migration to track.
    publishMode: text("publish_mode").notNull(),
    sampleRateAtQueueTime: doublePrecision("sample_rate_at_queue_time").notNull(),
    outcome: asyncAuditOutcomeEnum("outcome").notNull().default("pending"),
    auditedBy: uuid("audited_by").references(() => users.id),
    auditedAt: timestamp("audited_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("async_audit_queue_check_id_idx").on(table.checkId),
    index("async_audit_queue_outcome_idx").on(table.outcome),
  ],
);
