import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingProviderAdapter,
  CreateCheckoutInput,
  CreateCheckoutResult,
  NormalizedBillingEvent,
} from "./types.js";

/**
 * ADR-0012 §3 — Paystack adapter. Paystack is the LEAD recommendation
 * (Kenya-native: M-Pesa + cards, settles in KES) over Stripe (global, no
 * native M-Pesa). See docs/adr/0012-monetization.md.
 *
 * WHAT IS BUILDABLE NOW (implemented + tested here, no account needed):
 *   - `verifyWebhook`: Paystack signs each webhook as
 *     HMAC-SHA512(rawBody, SECRET_KEY), hex, in the `x-paystack-signature`
 *     header. That is pure crypto against the owner's secret — correct and
 *     testable without any live call. Compared in constant time.
 *   - `parseEvent`: flattening Paystack's documented `{ event, data }`
 *     webhook JSON into the normalised shape.
 *
 * WHAT NEEDS THE OWNER'S ACCOUNT (a deliberate fail-closed stub):
 *   - `createCheckout`: initialising a transaction requires POSTing to
 *     Paystack's `/transaction/initialize` with the live secret key. This
 *     scaffold NEVER calls a live payments API (task constraint), so it
 *     returns `not_configured` (secret unset) or `not_implemented`
 *     (secret set, but the live call is intentionally un-shipped). The
 *     real implementation is a documented TODO below.
 *
 * The secret key is read ONLY from env (`PAYSTACK_SECRET_KEY`), never
 * hardcoded; unset ⇒ `configured=false` ⇒ every mutating op fails closed.
 */
export class PaystackBillingProvider implements BillingProviderAdapter {
  readonly provider = "paystack" as const;
  readonly signatureHeader = "x-paystack-signature";
  readonly configured: boolean;

  constructor(private readonly secretKey: string | null) {
    this.configured = Boolean(secretKey && secretKey.length > 0);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    if (!this.configured) {
      return {
        ok: false,
        error: {
          kind: "not_configured",
          message:
            "Paystack is not configured (PAYSTACK_SECRET_KEY unset). Checkout is disabled until the owner adds a live Paystack secret key.",
        },
      };
    }
    // TODO(owner-account): implement the live checkout once a Paystack
    // account + secret key exist:
    //   POST https://api.paystack.co/transaction/initialize
    //   Authorization: Bearer <PAYSTACK_SECRET_KEY>
    //   body: { email, amount (KES subunits), currency: "KES",
    //           reference: deriveReference(input.subjectRef),
    //           callback_url: input.callbackUrl,
    //           metadata: { subjectRef: input.subjectRef, tier: input.tier } }
    // then return { authorizationUrl: data.authorization_url,
    //               reference: data.reference }.
    // Deliberately NOT implemented in this scaffold — the task forbids
    // calling a live payments API. `void input` keeps the param documented
    // and lint-clean without a live call.
    void input;
    return {
      ok: false,
      error: {
        kind: "not_implemented",
        message:
          "Paystack checkout initialisation is a scaffolded stub. Implement the /transaction/initialize call (see TODO in lib/billing/paystack.ts) once the owner's account is live.",
      },
    };
  }

  verifyWebhook(input: { rawBody: string; signature: string | undefined }): boolean {
    if (!this.configured || !this.secretKey || !input.signature) return false;
    const expected = createHmac("sha512", this.secretKey).update(input.rawBody, "utf8").digest("hex");
    // Constant-time compare. `timingSafeEqual` throws on unequal lengths,
    // so guard length first (a wrong-length signature is simply invalid).
    const provided = input.signature;
    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
    } catch {
      return false;
    }
  }

  parseEvent(rawBody: string): NormalizedBillingEvent | null {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (typeof json !== "object" || json === null) return null;
    const root = json as Record<string, unknown>;
    const eventType = typeof root.event === "string" ? root.event : null;
    if (!eventType) return null;
    const data = (typeof root.data === "object" && root.data !== null ? root.data : {}) as Record<string, unknown>;

    const reference =
      (typeof data.reference === "string" && data.reference) ||
      (typeof data.subscription_code === "string" && data.subscription_code) ||
      null;

    // A stable, unique idempotency id: Paystack's numeric transaction id
    // when present, else the event-type + reference pair.
    const dataId = typeof data.id === "number" || typeof data.id === "string" ? String(data.id) : null;
    const eventId = dataId ?? (reference ? `${eventType}:${reference}` : null);
    if (!eventId) return null;

    // Only a genuinely successful payment (or an active subscription)
    // grants premium — never a failed/abandoned charge.
    const status = typeof data.status === "string" ? data.status : null;
    const grantsPremium =
      (eventType === "charge.success" && (status === null || status === "success")) ||
      eventType === "subscription.create";

    const nextPayment = typeof data.next_payment_date === "string" ? data.next_payment_date : null;
    let currentPeriodEnd: Date | null = null;
    if (nextPayment) {
      const parsed = new Date(nextPayment);
      if (!Number.isNaN(parsed.getTime())) currentPeriodEnd = parsed;
    }

    // The entitlement subject travels in the transaction metadata we set
    // at `/transaction/initialize` time (see createCheckout TODO). Paystack
    // echoes `data.metadata` back on the webhook verbatim.
    const metadata = (typeof data.metadata === "object" && data.metadata !== null ? data.metadata : {}) as Record<
      string,
      unknown
    >;
    const subjectRef = typeof metadata.subjectRef === "string" && metadata.subjectRef ? metadata.subjectRef : null;

    return { eventId, eventType, reference, subjectRef, grantsPremium, currentPeriodEnd };
  }
}
