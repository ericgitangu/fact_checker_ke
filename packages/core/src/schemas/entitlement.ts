import { z } from "zod";

/**
 * ADR-0012 §3 (Pro/Premium subscription) — the entitlement + billing
 * contracts. These are the single source of truth for the Postgres
 * `entitlements` / `billing_events` tables (packages/db/src/schema.ts) and
 * the services/api billing routes, the same zod-first discipline every
 * other contract in this package follows.
 *
 * Deliberately minimal and provider-AGNOSTIC: nothing here names a
 * specific PSP's field shapes. The provider seam lives entirely in
 * services/api/src/lib/billing/** so swapping Paystack for Stripe (or
 * running both) never touches these contracts.
 */

/**
 * The paid tier. One value today ("premium" = ad-free + the perks ADR-0012
 * §3 names). An enum rather than a bare boolean so a future "team"/"pro"
 * split is an additive enum value, not a schema break.
 */
export const EntitlementTierSchema = z.enum(["premium"]);
export type EntitlementTier = z.infer<typeof EntitlementTierSchema>;

/**
 * Lifecycle of an entitlement row.
 *   - `active`   — paid and within its validity window; confers the perks.
 *   - `expired`  — the paid period lapsed without renewal.
 *   - `canceled` — the subscriber (or an admin) ended it; may still be
 *                  within a paid period, so validity is decided by
 *                  `currentPeriodEnd`, not by this status alone.
 * The server-authoritative ad-free / perk decision is NEVER "status ===
 * 'active'" by itself — it is status AND an unexpired `currentPeriodEnd`
 * (see services/api/src/lib/entitlement.ts `isActiveNow`). This status is
 * the billing-lifecycle label; the date is the source of truth for access.
 */
export const EntitlementStatusSchema = z.enum(["active", "expired", "canceled"]);
export type EntitlementStatus = z.infer<typeof EntitlementStatusSchema>;

/**
 * Which processor owns the subscription. `manual` is for comped/admin
 * grants (no PSP, no `providerRef`) — e.g. a newsroom partner or a test
 * account — so a comped entitlement is a first-class, queryable state
 * rather than a fake PSP row. ADR-0012 leads with Paystack (Kenya-native
 * M-Pesa/cards, KES); `mpesa` is the direct Safaricom Daraja C2B rail
 * (monetization v2 — no Paystack intermediary, settles straight to the
 * till); `stripe` is the global card fallback.
 */
export const BillingProviderSchema = z.enum(["paystack", "stripe", "mpesa", "manual"]);
export type BillingProvider = z.infer<typeof BillingProviderSchema>;

/**
 * The server-authoritative entitlement projection returned by
 * `GET /v1/entitlement` and consumed by the web ad-free decision. The
 * boolean `premium`/`adFree` fields are computed server-side (never the
 * client deciding from a date it was handed) — the client treats this as
 * opaque truth. `adFree` is kept as its OWN field, not inferred from
 * `premium`, so the ad-free consequence of a tier is explicit at the
 * contract boundary and a future non-ad-free paid add-on wouldn't silently
 * turn ads back on for existing premium readers.
 */
export const EntitlementSchema = z.object({
  /** True iff an entitlement is active AND unexpired right now (server-decided). */
  premium: z.boolean(),
  /** True iff the reader should see NO ads. Today: exactly `premium`. */
  adFree: z.boolean(),
  /** The tier, or null when the subject has no (active) entitlement. */
  tier: EntitlementTierSchema.nullable(),
  /** Billing-lifecycle label, or null when there is no entitlement at all. */
  status: EntitlementStatusSchema.nullable(),
  /**
   * ISO-8601 end of the current paid period, or null for a never-expiring
   * manual grant or when there is no entitlement. The server has already
   * applied this to compute `premium`/`adFree`; it is returned only for
   * display ("renews/expires on …").
   */
  currentPeriodEnd: z.string().datetime().nullable(),
});
export type Entitlement = z.infer<typeof EntitlementSchema>;

/**
 * The "no entitlement" projection — a reader with no premium. A shared
 * constant so every call site (route default, client fallback on a network
 * error) returns the identical fail-safe shape: ads ON, no perks. Ad-free
 * is the thing you must PAY for, so the safe default is never ad-free.
 */
export const NO_ENTITLEMENT: Entitlement = {
  premium: false,
  adFree: false,
  tier: null,
  status: null,
  currentPeriodEnd: null,
};

/**
 * Input to `POST /v1/billing/checkout` — start a subscription purchase.
 * `tier` is the only required field; the subject is taken server-side from
 * the authenticated device/user (the `X-Device-Token` header), never from
 * the body, so a caller can't start a checkout that grants premium to
 * someone else's identity. `email` is optional and used only to pre-fill
 * the PSP's hosted checkout (Paystack requires an email); it is NOT the
 * entitlement subject.
 */
export const CheckoutInputSchema = z.object({
  tier: EntitlementTierSchema.default("premium"),
  provider: BillingProviderSchema.default("paystack"),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  /**
   * M-Pesa only: the payer's phone, used as the STK-push target. Optional
   * (and ignored by card PSPs). Accepts any user-entered form (07…, +2547…,
   * 2547…, bare 7…/1…); the server normalises it to a 2547XXXXXXXX MSISDN
   * and rejects a non-Kenyan number at checkout. Like `email`, it is NOT the
   * entitlement subject — the subject is always the server-derived device
   * token hash — so it is safe to accept from the body.
   */
  phone: z.string().trim().max(20).optional(),
});
export type CheckoutInput = z.infer<typeof CheckoutInputSchema>;

/**
 * Result of a successful checkout initialisation: the hosted-checkout URL
 * the client redirects to, plus the opaque provider reference that the
 * later webhook will carry back to match the payment to its pending
 * entitlement. Buildable only once the owner's PSP account + secret key
 * exist — until then the route is a fail-closed stub (501), so this shape
 * is the contract the real implementation must satisfy, not a live path.
 */
export const CheckoutResultSchema = z
  .object({
    provider: BillingProviderSchema,
    /**
     * How the client completes this checkout:
     *   - `redirect`  — send the buyer to `authorizationUrl` (Paystack,
     *     Stripe Checkout). The default, so the pre-existing redirect-only
     *     result shape (`{ provider, authorizationUrl, reference }`) still
     *     parses unchanged.
     *   - `stk_push`  — an M-Pesa STK prompt has been pushed to the buyer's
     *     phone; there is NO URL to redirect to. The client shows
     *     `customerMessage` and waits for the Daraja callback to grant.
     */
    kind: z.enum(["redirect", "stk_push"]).default("redirect"),
    /**
     * The PSP hosted-checkout URL to redirect the buyer to. Required for a
     * `redirect` checkout, absent for `stk_push` (M-Pesa pushes a prompt to
     * the phone instead of returning a URL).
     */
    authorizationUrl: z.string().url().optional(),
    /** Opaque reference echoed back by the webhook/callback to reconcile the payment. */
    reference: z.string().min(1),
    /** M-Pesa `CustomerMessage` ("Success. Request accepted for processing"), shown while awaiting the callback. */
    customerMessage: z.string().optional(),
  })
  .refine((d) => d.kind !== "redirect" || typeof d.authorizationUrl === "string", {
    message: "a redirect checkout requires an authorizationUrl",
    path: ["authorizationUrl"],
  });
export type CheckoutResult = z.infer<typeof CheckoutResultSchema>;
