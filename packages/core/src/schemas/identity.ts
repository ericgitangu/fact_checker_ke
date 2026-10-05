import { z } from "zod";

/**
 * ADR-0020 §4: editor/admin RBAC. `editor` reviews/publishes/corrects
 * checks; `admin` additionally grants roles and flips kill-switches.
 * `moderator` (ADR-0024 §7) is scoped to comment moderation only — it is
 * NOT a superset/subset of editor, it is a disjoint capability set, kept
 * in the same enum so a single `users.role` column can express all three
 * (a user has exactly one of them; a volunteer moderator is never also
 * an editor by virtue of the role column alone).
 */
export const RoleSchema = z.enum(["editor", "admin", "moderator"]);
export type Role = z.infer<typeof RoleSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  /** Null until an admin (or the bootstrap path) grants a role -- see ADR-0020 §4, AT-0020-3. */
  role: RoleSchema.nullable(),
  mfaEnabled: z.boolean(),
  createdAt: z.string().datetime(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

/**
 * ADR-0020 §5: immutable append-only audit log. `targetId` is a free
 * string (not a uuid-typed column) because targets span several tables
 * (checks, users, comments) and a login event has no target at all.
 */
export const AuditActionSchema = z.enum([
  "login",
  "login_failed",
  "totp_enrolled",
  "totp_verified",
  "role_granted",
  "role_grant_rejected_no_mfa",
  "role_grant_rejected_bootstrap_scope",
  "check.approved",
  "check.corrected",
  "check.rejected",
  "check.published",
  "right_of_reply.issued",
  "right_of_reply.recorded",
  "comment.released",
  "comment.rejected",
  "comment.hidden",
  "comment.auto_hidden",
  "dsar.exported",
  // ADR-0031 hard constraint 2 / AT-0031-5: any tier-threshold change is
  // audit-logged; relaxing Tier C additionally records an advocate
  // sign-off reference (see services/api/src/lib/policy-audit.ts).
  "policy.threshold_changed",
  "policy.tier_c_relaxed",
  // ADR-0030 AT-0030-1: the creator-funnel conflict-of-interest firewall
  // audit trail — a founder-channel post referencing a published check.
  "funnel.post_recorded",
  // ADR-0007 kill-switch mechanism (AT-0007-A): a flip of the
  // `maandamano_kill_switch` policy flag, admin-only (see
  // services/api/src/lib/maandamano.ts, docs/runbooks/nc4-kill-switch.md).
  // Distinct from "policy.threshold_changed" so an incident responder
  // scanning audit_log for this action name doesn't have to also
  // disambiguate it from an ordinary ADR-0031 threshold tweak.
  "policy.kill_switch_flipped",
  // ADR-0032 (two-engine pivot) / AT-0032-6: the fetch-engine kill switch
  // blocked an auto-publish decision that would otherwise have published
  // (ingest_source === "fetch" and the fetch kill switch was frozen at
  // enactment time) — the draft is left pending for a human instead. See
  // services/api/src/lib/publish-enactment.ts.
  "check.auto_publish_blocked",
  // ADR-0035: an editor/admin attached an iframe embed (a POINTER to a
  // source-platform post, never bytes) to a demonstration advisory, and
  // an editor/admin changed a demonstration's status (the latter also
  // appends a demonstration_status_events row in the same transaction).
  // Both are human-curated actions — the fetch engine never writes these.
  "demonstration.media_attached",
  "demonstration.status_changed",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  action: AuditActionSchema,
  targetType: z.string().min(1).max(100),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
