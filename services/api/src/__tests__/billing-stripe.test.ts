import { describe, expect, it, vi } from "vitest";
import { StripeBillingProvider, type StripeClientLike } from "../lib/billing/stripe.js";
import type { StripeConfig } from "../config.js";

const CONFIGURED: StripeConfig = {
  secretKey: "sk_test_fake",
  webhookSecret: "whsec_test_fake",
  priceId: "price_test_fake",
};

/** A fake Stripe client: records the session-create params, and lets a test decide whether constructEvent throws. */
function fakeStripe(opts: {
  sessionUrl?: string | null;
  constructThrows?: boolean;
  onCreate?: (params: unknown) => void;
} = {}): StripeClientLike {
  return {
    checkout: {
      sessions: {
        create: async (params) => {
          opts.onCreate?.(params);
          return { id: "cs_test_123", url: opts.sessionUrl === undefined ? "https://checkout.stripe.com/c/cs_test_123" : opts.sessionUrl };
        },
      },
    },
    webhooks: {
      constructEvent: (payload) => {
        if (opts.constructThrows) throw new Error("No signatures found matching the expected signature");
        return JSON.parse(String(payload)) as { id: string; type: string; data: { object: unknown } };
      },
    },
  };
}

describe("StripeBillingProvider.createCheckout (Checkout Session, SDK mocked)", () => {
  it("is not_configured with no secret key", async () => {
    const p = new StripeBillingProvider({ ...CONFIGURED, secretKey: null }, { client: fakeStripe() });
    const r = await p.createCheckout({ tier: "premium", subjectRef: "dh" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_configured");
  });

  it("is not_configured with no price id", async () => {
    const p = new StripeBillingProvider({ ...CONFIGURED, priceId: null }, { client: fakeStripe() });
    const r = await p.createCheckout({ tier: "premium", subjectRef: "dh" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_configured");
  });

  it("creates a payment-mode session and returns a redirect result with the hosted URL + id", async () => {
    const onCreate = vi.fn();
    const p = new StripeBillingProvider(CONFIGURED, { client: fakeStripe({ onCreate }) });
    const r = await p.createCheckout({
      tier: "premium",
      subjectRef: "dh_subject",
      email: "reader@example.com",
      callbackUrl: "https://app.test/premium/thanks",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        provider: "stripe",
        kind: "redirect",
        reference: "cs_test_123",
        authorizationUrl: "https://checkout.stripe.com/c/cs_test_123",
      });
    }
    // Request-build: price line item, payment mode, subject in BOTH client_reference_id and metadata.
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        line_items: [{ price: "price_test_fake", quantity: 1 }],
        client_reference_id: "dh_subject",
        customer_email: "reader@example.com",
        metadata: { subjectRef: "dh_subject", tier: "premium" },
      }),
    );
  });

  it("is a provider_error when Stripe returns a session with no URL", async () => {
    const p = new StripeBillingProvider(CONFIGURED, { client: fakeStripe({ sessionUrl: null }) });
    const r = await p.createCheckout({ tier: "premium", subjectRef: "dh" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("provider_error");
  });
});

describe("StripeBillingProvider.verifyWebhook (constructEvent)", () => {
  it("fails closed when unconfigured / no webhook secret / no signature", () => {
    const noSecret = new StripeBillingProvider({ ...CONFIGURED, webhookSecret: null }, { client: fakeStripe() });
    expect(noSecret.verifyWebhook({ rawBody: "{}", signature: "t=1,v1=x" })).toBe(false);
    const p = new StripeBillingProvider(CONFIGURED, { client: fakeStripe() });
    expect(p.verifyWebhook({ rawBody: "{}", signature: undefined })).toBe(false);
  });

  it("returns true when constructEvent succeeds and false when it throws", () => {
    const ok = new StripeBillingProvider(CONFIGURED, { client: fakeStripe() });
    expect(ok.verifyWebhook({ rawBody: "{}", signature: "t=1,v1=good" })).toBe(true);
    const bad = new StripeBillingProvider(CONFIGURED, { client: fakeStripe({ constructThrows: true }) });
    expect(bad.verifyWebhook({ rawBody: "{}", signature: "t=1,v1=bad" })).toBe(false);
  });
});

describe("StripeBillingProvider.parseEvent (checkout.session.completed)", () => {
  const p = new StripeBillingProvider(CONFIGURED, { client: fakeStripe() });

  it("grants premium on a completed+paid session and derives period from created + 30d", () => {
    const created = Math.floor(Date.parse("2026-10-05T00:00:00.000Z") / 1000);
    const body = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", payment_status: "paid", client_reference_id: "dh_subject", created } },
    });
    const parsed = p.parseEvent(body);
    expect(parsed).toMatchObject({
      eventId: "evt_1",
      eventType: "checkout.session.completed",
      reference: "cs_1",
      subjectRef: "dh_subject",
      grantsPremium: true,
    });
    expect(parsed?.currentPeriodEnd?.toISOString()).toBe("2026-11-04T00:00:00.000Z");
  });

  it("falls back to metadata.subjectRef when client_reference_id is absent", () => {
    const body = JSON.stringify({
      id: "evt_2",
      type: "checkout.session.completed",
      data: { object: { id: "cs_2", payment_status: "paid", metadata: { subjectRef: "dh_meta" } } },
    });
    expect(p.parseEvent(body)?.subjectRef).toBe("dh_meta");
  });

  it("does NOT grant on an unpaid session or a different event type", () => {
    const unpaid = JSON.stringify({
      id: "evt_3",
      type: "checkout.session.completed",
      data: { object: { id: "cs_3", payment_status: "unpaid", client_reference_id: "dh" } },
    });
    expect(p.parseEvent(unpaid)?.grantsPremium).toBe(false);
    const other = JSON.stringify({ id: "evt_4", type: "payment_intent.created", data: { object: { id: "pi_1" } } });
    expect(p.parseEvent(other)?.grantsPremium).toBe(false);
  });
});
