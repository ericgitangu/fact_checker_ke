import { z } from "zod";

/**
 * ADR-0021 retention table, as data: one row per data class. `retentionDays:
 * null` means indefinite (published checks + evidence, audit log).
 */
export const RetentionPolicySchema = z.object({
  dataClass: z.string().min(1).max(100),
  retentionDays: z.number().int().positive().nullable(),
  notes: z.string(),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

/**
 * ADR-0021 "DSAR flow": a documented, manual (not self-serve) export run
 * by an editor against a device token. Logged in `dsar_requests` (audit
 * trail of who was exported, when) distinct from the audit_log table
 * (ADR-0020), which tracks editor/admin ACTIONS, not export contents.
 */
export const DsarExportSchema = z.object({
  deviceTokenHash: z.string(),
  submissions: z.array(z.record(z.string(), z.unknown())),
  drafts: z.array(z.record(z.string(), z.unknown())),
  comments: z.array(z.record(z.string(), z.unknown())),
  /** Published-check evidence is NEVER included (ADR-0021: "not subject to erasure/export"). */
  excludedPublishedEvidence: z.literal(true),
  exportedAt: z.string().datetime(),
});
export type DsarExport = z.infer<typeof DsarExportSchema>;
