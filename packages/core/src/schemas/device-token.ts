import { z } from "zod";

/**
 * ADR-0020 §1 (anonymous-token slice only — full Better Auth editor/admin
 * RBAC is a later wave). `POST /v1/device` issues an opaque token; the
 * API never learns or stores the raw token, only its SHA-256 hash
 * (`device_tokens.token_hash`), so a DB leak doesn't hand out live
 * bearer credentials. The response schema below is what the client
 * stores (cookie on web, secure storage on mobile).
 */
export const DeviceTokenResponseSchema = z.object({
  token: z.string().min(32),
  expiresAt: z.string().datetime(),
});
export type DeviceTokenResponse = z.infer<typeof DeviceTokenResponseSchema>;

/**
 * ADR-0018/0020: the SSE capability token minted at submission time,
 * scoped to exactly one submission id, short TTL. Carried as a signed
 * JWT; this schema describes its *claims* (post-verification shape), not
 * the wire JWT string itself.
 */
export const CapabilityTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  scope: z.literal("submission:events"),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});
export type CapabilityTokenClaims = z.infer<typeof CapabilityTokenClaimsSchema>;
