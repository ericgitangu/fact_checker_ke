import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ClaimTypeSchema,
  CredibilityTierSchema,
  DemonstrationStatusSchema,
  RatingSchema,
  SubmissionStatusSchema,
  WaitlistSourceSchema,
} from "@fact-checker-ke/core";

/**
 * Postgres enums built from the zod enums exported by @fact-checker-ke/core,
 * so enum values have exactly one source of truth (ADR-0009 decision). Any
 * future enum value added in core/src/schemas/*.ts is picked up here
 * automatically on the next `drizzle-kit generate`.
 */
export const submissionStatusEnum = pgEnum(
  "submission_status",
  SubmissionStatusSchema.options,
);
export const ratingEnum = pgEnum("rating", RatingSchema.options);
export const claimTypeEnum = pgEnum("claim_type", ClaimTypeSchema.options);
export const credibilityTierEnum = pgEnum(
  "credibility_tier",
  CredibilityTierSchema.options,
);
export const demonstrationStatusEnum = pgEnum(
  "demonstration_status",
  DemonstrationStatusSchema.options,
);
export const waitlistSourceEnum = pgEnum(
  "waitlist_source",
  WaitlistSourceSchema.options,
);

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
    status: submissionStatusEnum("status").notNull().default("received"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("submissions_org_id_idx").on(table.orgId),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    index("checks_org_id_idx").on(table.orgId),
    index("checks_submission_id_idx").on(table.submissionId),
    check(
      "checks_published_requires_rating",
      sql`${table.publishedAt} is null or ${table.rating} is not null`,
    ),
  ],
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
