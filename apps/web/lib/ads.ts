/**
 * ADR-0012 §4 (non-intrusive ads, Phase 3) — AdSense configuration + the
 * pure render decision, env-gated so the whole ad surface is INVISIBLE
 * until the owner adds a real AdSense account.
 *
 * `NEXT_PUBLIC_` because these are read in the browser (the ad `<ins>`
 * carries the client/slot ids) and need no secrecy — the AdSense client id
 * is public by design. Unset ⇒ `undefined` ⇒ `<AdSlot>` renders NOTHING,
 * exactly like the footer supporter links hide when their env URL is unset
 * (lib/site.ts). No placeholder, no dead markup.
 *
 * NOTE: ADR-0012 sequences ads to Phase 3 (never on the tracker/verdict
 * pages, only after the AdMob/AdSense policy is verified). This is the
 * buildable-now scaffold — it ships inert; turning it on is the owner
 * setting these env vars once that policy gate is cleared.
 */
export const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT || undefined;

/**
 * Slot ids per placement. Each placement is independently gated: a slot
 * with no id renders nothing even when the client id is set, so the owner
 * can enable placements one at a time.
 */
export const AD_SLOTS = {
  inFeed: process.env.NEXT_PUBLIC_ADSENSE_SLOT_INFEED || undefined,
  inArticle: process.env.NEXT_PUBLIC_ADSENSE_SLOT_INARTICLE || undefined,
} as const;

export type AdSlotName = keyof typeof AD_SLOTS;

/** After how many feed items the in-feed unit appears (ADR-0012: never above the fold; after item 4). */
export const IN_FEED_AD_AFTER = 4;

export function resolveSlotId(name: AdSlotName): string | undefined {
  return AD_SLOTS[name];
}

/**
 * The pure, dependency-free render decision for an ad slot — unit-testable
 * without a DOM. An ad renders ONLY when all hold:
 *   - AdSense is configured (client id present) AND this placement has a
 *     slot id;
 *   - the reader is NOT ad-free (Premium readers never see ads, ADR-0012
 *     §3);
 *   - consent is satisfied (not required, or required and granted — the
 *     EEA/UK CMP gate, ADR-0012 §4 / lib/consent.ts).
 * Anything unknown defaults to NOT showing an ad (fail-safe: never show an
 * ad we're unsure we're allowed to).
 */
export function shouldRenderAd(input: {
  client: string | undefined;
  slotId: string | undefined;
  adFree: boolean;
  consentSatisfied: boolean;
}): boolean {
  if (!input.client || !input.slotId) return false;
  if (input.adFree) return false;
  if (!input.consentSatisfied) return false;
  return true;
}
