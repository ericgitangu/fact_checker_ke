import Stripe from "stripe";
import type { StripeConfig } from "../../config.js";
import { premiumPeriodEnd } from "./premium.js";
import type {
  BillingProviderAdapter,
  CreateCheckoutInput,
  CreateCheckoutResult,
  NormalizedBillingEvent,
} from "./types.js";

/**
 * ADR-0012 §3 (monetization v2) — the Stripe adapter (global card fallback;
 * no native M-Pesa). Ported from the moovn Stripe PATTERN — the official
 * SDK's raw-body `constructEvent` signature check + fail-closed secret
 * handling — not its secret values; every key is read from
 * fact_checker_ke's OWN env via `StripeConfig`.
 *
 * MODEL — a one-off Premium PASS via Checkout in `payment` mode (see
 * lib/billing/premium.ts for why recurring subscriptions are out of scope).
 * `STRIPE_PRICE_ID` MUST therefore be a ONE-TIME price, not a recurring
 * one (a recurring price errors at `payment`-mode session creation).
 *
 * FAIL-CLOSED (safe to deploy with NO keys set):
 *   - `STRIPE_SECRET_KEY` unset ⇒ `configured=false` ⇒ checkout 503.
 *   - `STRIPE_PRICE_ID` unset ⇒ checkout 503 (can't build a session).
 *   - `STRIPE_WEBHOOK_SECRET` unset ⇒ `verifyWebhook` denies everything.
 */

/**
 * The slice of the Stripe SDK this adapter uses. A real `Stripe` instance
 * satisfies it structurally; unit tests inject a fake so NO real network /
 * real keys are needed.
 */
export interface StripeClientLike {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }>;
    };
  };
  webhooks: {
    constructEvent(
      payload: string | Buffer,
      header: string | Buffer,
      secret: string,
    ): { id: string; type: string; data: { object: unknown } };
  };
}

export interface StripeAdapterDeps {
  /** Injected for tests; defaults to a real `new Stripe(secretKey)`. */
  client?: StripeClientLike;
  /** Where Stripe redirects after success/cancel; defaults derived from the checkout `callbackUrl`. */
  successUrl?: string;
  cancelUrl?: string;
  now?: () => Date;
}

export class StripeBillingProvider implements BillingProviderAdapter {
  readonly provider = "stripe" as const;
  readonly signatureHeader = "stripe-signature";
  readonly configured: boolean;

  private readonly client: StripeClientLike | null;
  private readonly now: () => Date;

  constructor(
    private readonly cfg: StripeConfig,
    private readonly deps: StripeAdapterDeps = {},
  ) {
    this.configured = Boolean(cfg.secretKey && cfg.secretKey.length > 0);
    this.now = deps.now ?? (() => new Date());
    // Build a real client only when a secret key exists and no fake was
    // injected. `apiVersion` is pinned by the installed SDK's default.
    this.client =
      deps.client ?? (this.configured && cfg.secretKey ? (new Stripe(cfg.secretKey) as unknown as StripeClientLike) : null);
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    if (!this.configured || !this.client) {
      return {
        ok: false,
        error: {
          kind: "not_configured",
          message: "Stripe is not configured (STRIPE_SECRET_KEY unset). Checkout is disabled until the owner adds a key.",
        },
      };
    }
    if (!this.cfg.priceId) {
      return {
        ok: false,
        error: { kind: "not_configured", message: "Stripe price is unset (STRIPE_PRICE_ID); cannot build a checkout session." },
      };
    }

    const successUrl = this.deps.successUrl ?? input.callbackUrl ?? "https://example.invalid/premium/thanks";
    const cancelUrl = this.deps.cancelUrl ?? input.callbackUrl ?? "https://example.invalid/premium";

    let session: { id: string; url: string | null };
    try {
      session = await this.client.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: this.cfg.priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        // The subject travels BOTH ways: client_reference_id (echoed on the
        // session) and metadata (belt-and-braces); the webhook reads either.
        client_reference_id: input.subjectRef,
        ...(input.email ? { customer_email: input.email } : {}),
        metadata: { subjectRef: input.subjectRef, tier: input.tier },
      });
    } catch (err) {
      return { ok: false, error: { kind: "provider_error", message: `Stripe session create failed: ${errMsg(err)}` } };
    }

    if (!session.url) {
      return { ok: false, error: { kind: "provider_error", message: "Stripe returned a session with no URL." } };
    }
    return {
      ok: true,
      value: { provider: "stripe", kind: "redirect", authorizationUrl: session.url, reference: session.id },
    };
  }

  verifyWebhook(input: { rawBody: string; signature: string | undefined; sourceIp?: string | undefined }): boolean {
    if (!this.configured || !this.client || !this.cfg.webhookSecret || !input.signature) return false;
    try {
      this.client.webhooks.constructEvent(input.rawBody, input.signature, this.cfg.webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  parseEvent(rawBody: string): NormalizedBillingEvent | null {
    // Safe to JSON.parse directly: verifyWebhook already confirmed the
    // signature over these exact bytes (the security boundary), so the body
    // is trusted. (parseEvent takes only rawBody — no signature — by the
    // seam's contract, same as the Paystack adapter.)
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (!json || typeof json !== "object") return null;
    const root = json as Record<string, unknown>;
    const eventId = typeof root.id === "string" ? root.id : null;
    const eventType = typeof root.type === "string" ? root.type : null;
    if (!eventId || !eventType) return null;

    const data = (root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : {}) as Record<
      string,
      unknown
    >;
    const object = (data.object && typeof data.object === "object" ? (data.object as Record<string, unknown>) : {}) as Record<
      string,
      unknown
    >;

    const metadata = (object.metadata && typeof object.metadata === "object" ? (object.metadata as Record<string, unknown>) : {}) as Record<
      string,
      unknown
    >;
    const subjectRef =
      (typeof object.client_reference_id === "string" && object.client_reference_id) ||
      (typeof metadata.subjectRef === "string" && metadata.subjectRef) ||
      null;

    // The session id is the stable, unique entitlement reference (one-off
    // payment has no subscription id).
    const reference = typeof object.id === "string" ? object.id : null;

    // Only a completed, PAID Checkout session grants premium.
    const paymentStatus = typeof object.payment_status === "string" ? object.payment_status : null;
    const grantsPremium = eventType === "checkout.session.completed" && paymentStatus === "paid";

    let currentPeriodEnd: Date | null = null;
    if (grantsPremium) {
      const createdSec = typeof object.created === "number" ? object.created : null;
      currentPeriodEnd = premiumPeriodEnd(createdSec !== null ? new Date(createdSec * 1000) : this.now());
    }

    return { eventId, eventType, reference, subjectRef, grantsPremium, currentPeriodEnd };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
