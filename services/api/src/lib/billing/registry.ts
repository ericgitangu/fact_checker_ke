import type { BillingProvider } from "@fact-checker-ke/core";
import type { MpesaConfig, StripeConfig } from "../../config.js";
import { PaystackBillingProvider } from "./paystack.js";
import { MpesaBillingProvider } from "./mpesa.js";
import { StripeBillingProvider } from "./stripe.js";
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

/**
 * Builds the registry from resolved config. ADR-0012 §3 (monetization v2):
 * Paystack, M-Pesa (direct Daraja C2B) and Stripe are ALL registered — even
 * when unconfigured — so their checkout/webhook routes exist and fail closed
 * (503/401) rather than 404, exactly like the original Paystack-only
 * scaffold. Every secret comes from config (env); nothing is hardcoded.
 */
export function createBillingRegistry(env: {
  paystackSecretKey: string | null;
  mpesa?: MpesaConfig;
  stripe?: StripeConfig;
}): BillingRegistry {
  const adapters: BillingProviderAdapter[] = [new PaystackBillingProvider(env.paystackSecretKey)];
  // The M-Pesa allowlist + amount travel on the config block itself.
  if (env.mpesa) adapters.push(new MpesaBillingProvider(env.mpesa));
  if (env.stripe) adapters.push(new StripeBillingProvider(env.stripe));
  return new BillingRegistry(adapters);
}
