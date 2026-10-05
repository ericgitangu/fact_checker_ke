import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { resolveConfig } from "../config.js";
import { createBillingRegistry } from "../lib/billing/registry.js";
import { InMemoryEntitlementRepository } from "../repositories/in-memory.js";
import type { SignatureVerifier } from "../lib/internal-auth.js";

const allow: SignatureVerifier = { verify: async () => true };
const deviceToken = "device-token-degradation-1234567890ab";

/**
 * ADR-0012 (monetization v2) — GRACEFUL DEGRADATION with ZERO payment env.
 *
 * This is the DEFAULT production state until the owner provisions keys, so
 * the whole billing stack must come up and stay well-behaved: the process
 * boots (no throw at import/registry construction — never `new Stripe(
 * undefined)` or an OAuth call at module load), every billing route returns
 * a clean TYPED status (never a 500/unhandled exception), webhooks fail
 * CLOSED, and the read + sweep paths keep working (default = not premium).
 *
 * `resolveConfig({})` is the real zero-env config (it always returns the
 * mpesa/stripe blocks with null values), so this exercises the exact prod
 * default, not a hand-rolled stand-in.
 */
const zeroEnvConfig = resolveConfig({});

describe("billing stack — graceful degradation with no payment env", () => {
  it("constructs the registry with zero env without throwing; all adapters fail closed (configured=false)", () => {
    const reg = createBillingRegistry({
      paystackSecretKey: zeroEnvConfig.paystackSecretKey ?? null,
      mpesa: zeroEnvConfig.mpesa,
      stripe: zeroEnvConfig.stripe,
    });
    expect(reg.get("paystack")?.configured).toBe(false);
    expect(reg.get("mpesa")?.configured).toBe(false);
    expect(reg.get("stripe")?.configured).toBe(false);
  });

  it("builds the app and NO billing route returns a 500 when every payment env var is unset", async () => {
    const app = await buildApp({
      logger: false,
      entitlements: new InMemoryEntitlementRepository(),
      config: zeroEnvConfig,
      signatureVerifier: allow,
    });
    try {
      const headers = { "content-type": "application/json", "x-device-token": deviceToken };
      const webhookBody = JSON.stringify({ event: "charge.success", data: { id: 1 } });

      const responses = [
        // Checkout for each real provider → typed 503 not_configured, never 500.
        await app.inject({ method: "POST", url: "/v1/billing/checkout", headers, payload: { provider: "paystack" } }),
        await app.inject({ method: "POST", url: "/v1/billing/checkout", headers, payload: { provider: "mpesa", phone: "0708123456" } }),
        await app.inject({ method: "POST", url: "/v1/billing/checkout", headers, payload: { provider: "stripe" } }),
        // Webhooks fail CLOSED (adapter unconfigured → 401), never 500.
        await app.inject({ method: "POST", url: "/v1/billing/webhook/paystack", headers, payload: webhookBody }),
        await app.inject({ method: "POST", url: "/v1/billing/webhook/mpesa", headers, payload: webhookBody }),
        await app.inject({ method: "POST", url: "/v1/billing/webhook/stripe", headers, payload: webhookBody }),
        // Unknown / non-checkout providers → 404, never 500.
        await app.inject({ method: "POST", url: "/v1/billing/webhook/manual", headers, payload: webhookBody }),
        await app.inject({ method: "POST", url: "/v1/billing/webhook/wakanda", headers, payload: webhookBody }),
        // Read + sweep keep working regardless of payment env.
        await app.inject({ method: "GET", url: "/v1/entitlement", headers: { "x-device-token": deviceToken } }),
        await app.inject({ method: "POST", url: "/internal/entitlements/sweep", payload: {} }),
      ];
      // A clean typed status (401/404/501/503/200) is the point; the ONLY
      // unacceptable outcome is a 500/unhandled exception.
      for (const res of responses) {
        expect(res.statusCode).not.toBe(500);
        expect(res.statusCode).toBeLessThan(504);
      }
    } finally {
      await app.close();
    }
  });

  it("checkout for an unconfigured provider returns a clean typed 503 (not_configured), not an exception", async () => {
    const app = await buildApp({
      logger: false,
      entitlements: new InMemoryEntitlementRepository(),
      config: zeroEnvConfig,
    });
    try {
      for (const provider of ["paystack", "mpesa", "stripe"]) {
        const res = await app.inject({
          method: "POST",
          url: "/v1/billing/checkout",
          headers: { "content-type": "application/json", "x-device-token": deviceToken },
          payload: { provider, phone: "0708123456" },
        });
        expect(res.statusCode).toBe(503);
        expect(res.json().error).toBe("not_configured");
        expect(typeof res.json().message).toBe("string");
      }
    } finally {
      await app.close();
    }
  });

  it("webhooks fail CLOSED (401) with no secret, and an unknown provider is 404 — never 500", async () => {
    const app = await buildApp({
      logger: false,
      entitlements: new InMemoryEntitlementRepository(),
      config: zeroEnvConfig,
    });
    try {
      const headers = { "content-type": "application/json" };
      const body = JSON.stringify({ event: "charge.success", data: { id: 1 } });
      for (const provider of ["paystack", "mpesa", "stripe"]) {
        const res = await app.inject({ method: "POST", url: `/v1/billing/webhook/${provider}`, headers, payload: body });
        expect(res.statusCode).toBe(401);
      }
      const unknown = await app.inject({ method: "POST", url: "/v1/billing/webhook/wakanda", headers, payload: body });
      expect(unknown.statusCode).toBe(404);
      const manual = await app.inject({ method: "POST", url: "/v1/billing/webhook/manual", headers, payload: body });
      expect(manual.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("GET /v1/entitlement returns the fail-safe NO_ENTITLEMENT (not premium) with no payment env", async () => {
    const app = await buildApp({ logger: false, entitlements: new InMemoryEntitlementRepository(), config: zeroEnvConfig });
    try {
      const res = await app.inject({ method: "GET", url: "/v1/entitlement", headers: { "x-device-token": deviceToken } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ premium: false, adFree: false, tier: null });
    } finally {
      await app.close();
    }
  });
});
