import { z } from "zod";

export const DemonstrationStatusSchema = z.enum([
  "rumoured",
  "announced",
  "confirmed",
  "ongoing",
  "ended",
  "cancelled",
]);
export type DemonstrationStatus = z.infer<typeof DemonstrationStatusSchema>;

/**
 * ADR-0035: the platforms whose iframe/oEmbed hosts we allow. `platform`
 * is a plain string on the DB side (`demonstration_media.platform text`),
 * but constrained here so an editor cannot attach a platform we have no
 * host-allowlist entry for.
 */
export const DemonstrationMediaPlatformSchema = z.enum(["youtube", "x", "tiktok"]);
export type DemonstrationMediaPlatform = z.infer<typeof DemonstrationMediaPlatformSchema>;

/**
 * ADR-0035: the misinfo-check lifecycle of an attached embed. `unchecked`
 * at attach time → `checking` once a triage job is enqueued → `clear` or
 * `flagged` once the pipeline's reverse-image/synthetic-media check
 * returns. A `flagged` embed renders a "may be recycled footage" caveat.
 * Named (not inline) so the Postgres enum
 * (`demonstration_media_misinfo_status`) derives from exactly one source,
 * the same single-source discipline as every other core-sourced enum.
 */
export const DemonstrationMediaMisinfoStatusSchema = z.enum([
  "unchecked",
  "checking",
  "clear",
  "flagged",
]);
export type DemonstrationMediaMisinfoStatus = z.infer<typeof DemonstrationMediaMisinfoStatusSchema>;

/**
 * ADR-0035 host allowlist: the ONLY hosts a `embedUrl` may point at — the
 * platforms' own embed/oEmbed hosts. This is what structurally blocks a
 * re-hosted/arbitrary URL (a bucket URL, a scraped MP4, our own origin):
 * media is an iframe embed to the source platform, never bytes we serve.
 * Enforced TS-side via `.refine` (JSON Schema can't express it, so it is
 * NOT present in the generated Python model — the host check lives at the
 * API boundary where an embed is attached, not in the pipeline).
 */
const ALLOWED_EMBED_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "platform.twitter.com",
  "twitter.com",
  "x.com",
  "www.tiktok.com",
  "tiktok.com",
] as const;

export function isPlatformEmbedHost(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return (ALLOWED_EMBED_HOSTS as readonly string[]).includes(parsed.hostname.toLowerCase());
}

/**
 * ADR-0035: an iframe embed attached to an advisory. We store a POINTER to
 * the source platform post (`embedUrl` on a host-allowlisted embed host)
 * plus a caption, when it was observed, and the misinfo-check status — and
 * NEVER any media bytes. `embedUrl`'s host allowlist is what blocks a
 * re-hosted URL (see `isPlatformEmbedHost`).
 */
export const DemonstrationMediaSchema = z.object({
  id: z.string().uuid(),
  platform: DemonstrationMediaPlatformSchema,
  embedUrl: z
    .string()
    .url()
    .refine(isPlatformEmbedHost, {
      message: "embedUrl host must be a platform embed/oEmbed host (ADR-0035 — embeds only, never re-hosted bytes)",
    }),
  caption: z.string().max(280).nullable(),
  observedAt: z.string().datetime(),
  misinfoStatus: DemonstrationMediaMisinfoStatusSchema,
  misinfoNote: z.string().max(500).nullable(),
});
export type DemonstrationMedia = z.infer<typeof DemonstrationMediaSchema>;

/**
 * ADR-0035: one append-only status transition in a demonstration's
 * history (backs the archive's "real, not reconstructed" timeline — a row
 * is written in the SAME transaction as the `demonstrations.status`
 * update, see services/api/src/lib/maandamano.ts#recordDemonstrationStatus).
 */
export const DemonstrationStatusEventSchema = z.object({
  status: DemonstrationStatusSchema,
  note: z.string().max(500).nullable(),
  occurredAt: z.string().datetime(),
});
export type DemonstrationStatusEvent = z.infer<typeof DemonstrationStatusEventSchema>;

/**
 * A maandamano (protest) advisory entry. Deliberately coarse-grained:
 * `area` is a ward / sub-county name, never a coordinate pair or precise
 * address, so the advisory cannot be used to pinpoint individuals.
 *
 * ADR-0035: `media` is an ADDITIVE, optional field defaulting to `[]`, so
 * every existing row and the `MaandamanoResponse` shape keep validating
 * (AT-0035-1). It carries embed POINTERS + a misinfo status, never bytes.
 */
export const DemonstrationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  area: z.string().min(1).max(200),
  county: z.string().min(1).max(100),
  status: DemonstrationStatusSchema,
  date: z.string().date().nullable(),
  summary: z.string().min(1).max(2000),
  sourceUrl: z.string().url().nullable(),
  updatedAt: z.string().datetime(),
  media: z.array(DemonstrationMediaSchema).default([]),
});
export type Demonstration = z.infer<typeof DemonstrationSchema>;

/**
 * ADR-0035 archive read model (AT-0035-5): `ended`/`cancelled` advisories
 * with their status history + source/embed links, NEVER raw media (embeds
 * are links, so this holds trivially). Kill-switch-gated through the same
 * frozen check as the live list (AT-0035-4) — `frozen: true` always comes
 * with `archived: []`.
 */
export const MaandamanoArchiveResponseSchema = z.object({
  frozen: z.boolean(),
  archived: z.array(DemonstrationSchema.extend({ statusHistory: z.array(DemonstrationStatusEventSchema) })),
});
export type MaandamanoArchiveResponse = z.infer<typeof MaandamanoArchiveResponseSchema>;

/**
 * ADR-0007 kill-switch mechanism (AT-0007-A): the public `GET
 * /v1/maandamano` response shape. `frozen: true` means the kill switch
 * is ON and `demonstrations` is ALWAYS `[]` in that case — the server
 * never sends live advisory rows alongside `frozen: true` (see
 * services/api/src/lib/maandamano.ts#getMaandamanoAdvisories). A reader
 * cannot distinguish "frozen" from "no advisories right now" by probing
 * the array; that's intentional — `frozen` is the only signal consumers
 * should branch on, and the array carries no information while frozen.
 */
export const MaandamanoResponseSchema = z.object({
  frozen: z.boolean(),
  demonstrations: z.array(DemonstrationSchema),
});
export type MaandamanoResponse = z.infer<typeof MaandamanoResponseSchema>;
