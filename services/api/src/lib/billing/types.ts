import type { BillingProvider, CheckoutResult, EntitlementTier } from "@fact-checker-ke/core";

/**
 * ADR-0012 §3: the provider-AGNOSTIC billing seam. The entitlement routes
 * depend only on this interface, never on a specific PSP's SDK — swapping
 * Paystack for Stripe (or running both, keyed by `provider`) is a new
 * adapter, not a route change. Mirrors the `SignatureVerifier` /
 * `Publisher` seams already in this service (lib/internal-auth.ts,
 * lib/publisher.ts): a narrow interface + a fail-closed default.
 */

/** A PSP-backed provider (never `manual`, which is an admin comp, not a checkout). */
export type PspProvider = Exclude<BillingProvider, "manual">;

export interface CreateCheckoutInput {
  tier: EntitlementTier;
  /**
   * The server-derived entitlement subject (the device token hash today).
   * Passed so the adapter can stamp it into the PSP's metadata/reference,
   * letting the later webhook reconcile the payment back to this subject.
   * NEVER taken from the request body.
   */
  subjectRef: string;
  /** Optional buyer email to pre-fill the PSP's hosted checkout. */
  email?: string;
  /** The URL the PSP redirects back to after payment. */
  callbackUrl?: string;
  /**
   * M-Pesa only: the payer's phone (the STK-push target), as entered by the
   * user. The adapter normalises it to a 2547XXXXXXXX MSISDN and rejects a
   * non-Kenyan number. Ignored by card PSPs. NEVER the entitlement subject.
   */
  phone?: string;
}

export type CreateCheckoutResult =
  | { ok: true; value: CheckoutResult }
  | {
      ok: false;
      error: {
        /**
         *  - `not_configured`  — the PSP secret is unset (fail-closed; 503).
         *  - `not_implemented` — configured, but the live `initialize` call
         *    is a deliberate, un-shipped stub (account-dependent; 501).
         *  - `provider_error`  — the PSP rejected the request (502).
         */
        kind: "not_configured" | "not_implemented" | "provider_error";
        message: string;
      };
    };

/**
 * A PSP webhook event normalised to the only facts the entitlement layer
 * acts on — provider-specific JSON shapes are flattened by each adapter's
 * `parseEvent`, so the webhook route stays provider-agnostic.
 */
export interface NormalizedBillingEvent {
  /** The PSP's own event id — the `(provider, event_id)` idempotency key. */
  eventId: string;
  /** The PSP's event-type string, stored verbatim for audit. */
  eventType: string;
  /** The reference tying this event to its subscription (`provider_ref`). */
  reference: string | null;
  /**
   * The entitlement subject (device token hash) the adapter stamped into
   * the PSP's metadata at checkout time and the PSP echoes back here. This
   * is what lets the webhook create the grant without a prior "pending"
   * row — null when the event carries no recognisable subject, in which
   * case the grant is a safe no-op (we never guess whose premium to turn on).
   */
  subjectRef: string | null;
  /** True iff this event should ACTIVATE premium (e.g. a successful charge). */
  grantsPremium: boolean;
  /** New paid-period end carried by the event, when present; else null. */
  currentPeriodEnd: Date | null;
}

export interface BillingProviderAdapter {
  /** The core `BillingProvider` value this adapter owns. */
  readonly provider: PspProvider;
  /**
   * The lowercase HTTP header the PSP puts its webhook signature in. Empty
   * string for a provider that doesn't sign its callback with a header
   * (M-Pesa's Daraja callback is authenticated by source-IP allowlist +
   * result-field validation, not an HMAC header).
   */
  readonly signatureHeader: string;
  /** False when the PSP secret(s) are unset — every mutating op fails closed. */
  readonly configured: boolean;
  /** Start a hosted checkout / STK push. Fail-closed when unconfigured. */
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  /**
   * Verify the webhook/callback against the RAW request bytes. Returns false
   * (never throws) on a missing/invalid signature, a disallowed source IP,
   * or when unconfigured — fail closed, exactly like
   * `DenyAllSignatureVerifier`.
   *
   * `signature` is the header-borne HMAC (Paystack/Stripe). `sourceIp` is
   * the request's client IP, used by providers that authenticate the
   * callback by source-IP allowlist (M-Pesa) rather than a signature.
   * Providers ignore whichever they don't use.
   */
  verifyWebhook(input: { rawBody: string; signature: string | undefined; sourceIp?: string | undefined }): boolean;
  /** Parse a (already signature-verified) raw webhook body into the normalised shape, or null if unparseable. */
  parseEvent(rawBody: string): NormalizedBillingEvent | null;
}
