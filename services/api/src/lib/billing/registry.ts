import type { BillingProvider } from "@fact-checker-ke/core";
import { PaystackBillingProvider } from "./paystack.js";
import type { BillingProviderAdapter, PspProvider } from "./types.js";

/**
 * ADR-0012 §3: the provider registry. The billing routes ask for an
 * adapter by name and stay provider-agnostic; adding Stripe later is one
 * new adapter + one line here, no route change. A provider the registry
 * doesn't know (or `manual`, which has no checkout) resolves to null, and
 * the route returns 404 for it.
 *
 * Secrets come ONLY from config (env), never hardcoded; an unconfigured
 * adapter is still registered (so its routes exist) but fails closed on
 * every mutating op — see each adapter's `configured` flag.
 */
export class BillingRegistry {
  private readonly adapters: Map<PspProvider, BillingProviderAdapter>;

  constructor(adapters: BillingProviderAdapter[]) {
    this.adapters = new Map(adapters.map((a) => [a.provider, a]));
  }

  get(provider: string): BillingProviderAdapter | null {
    if (provider === "manual") return null;
    return this.adapters.get(provider as PspProvider) ?? null;
  }

  /** The default PSP for a checkout when the caller doesn't name one. ADR-0012 leads with Paystack. */
  get defaultProvider(): BillingProvider {
    return "paystack";
  }
}

/** Builds the registry from resolved config. Paystack today; Stripe is a future adapter. */
export function createBillingRegistry(env: { paystackSecretKey: string | null }): BillingRegistry {
  return new BillingRegistry([new PaystackBillingProvider(env.paystackSecretKey)]);
}
