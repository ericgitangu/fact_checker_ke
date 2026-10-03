# ADR-0012: Monetization sequencing

**Status:** Proposed · **Date:** 2026-10-03

## Problem
The brief wants ads, sponsors, subscriptions and creator-funnel revenue. Monetizing a political fact-checker creates a perceived-bias risk, which is the product's core asset. App-store rules also constrain payments.

## Evidence
- Apple: premium features and content need IAP, and auto-renewable subscriptions must run at least 7 days **[U]**.
- AdSense/AdMob policy on political and news content: a source was fetched but nothing was verified **[GAP]**.
- Africa-focused fact-checkers lost Google and Meta support in 2025 **[U, Poynter source fetched]**, which shows that platform funding is unreliable.

## Decision (proposed)
1. **Phase 0-1: no ads.** Ads next to protest and political verdicts invite "who's paying you" attacks, and AdSense policy is unverified **[GAP]**.
2. **Phase 2: disclosed sponsorships and grants.** Media-development funders, civic-tech grants and newsroom partnerships. Publish a funding page (IFCN transparency).
3. **Phase 2: "Pro" subscription.** Covers higher submission quotas, alerts, API access for newsrooms, and no ads (once ads exist). Use IAP on iOS and Play Billing on Android, and web checkout on the PWA.
4. **Phase 3: non-intrusive ads.** Only on non-political pages, only after verifying the policy, and never on the tracker or verdict pages.
5. **Rule:** monetization can never affect which claims get checked or how they are rated. Write this into the editorial policy (ADR-0008).

## Trade-offs accepted
Slower revenue in exchange for protecting the credibility asset.

## Review trigger
Revisit once there is verified AdMob/AdSense policy research, or at 10k MAU.

---
## Research round 2 (2026-10-03): amendments for grooming

- **AdMob/AdSense "Sensitive Events" policy** (since Feb 2024) bans profiting from or exploiting civil emergencies, conflict and mass violence, but reportedly "won't impact news reporting" **[V2-SECONDARY, consistent across 3 sources]**. Ads beside fact-checks are likely permissible. **Ad copy or targeting that references a protest is not.** Kenya-specific political-ad rules: **[GAP]**. Phase 3 timing is unchanged.
- **Apple:** the US-only external-checkout carve-out (May 2025) **does not extend to Kenya**. iOS subscriptions must use IAP **[V2-SECONDARY]**.
- **Google:** alternative/user-choice billing rollout phases **don't list Kenya** before the rest-of-world phase (30 Sep 2027) **[V2-SECONDARY]**. Play Billing is required.
- Web (PWA) subscriptions can use any processor (for example M-Pesa via a PSP). Price parity and the inability to link from the apps are **[I]**.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #15 (README/hygiene wave, medium severity; cross-reference only — the substantive change is in ADR-0015).

- **ADR-0015's trigger for moving off Vercel Hobby is broadened** from "ads or payments ship" to also cover sponsors, grants and operating as an incorporated entity — all of which Vercel's fair-use terms treat as commercial use (red-team C-15). This ADR's monetization sequencing (no ads until Phase 3, Pro subscription in Phase 2) is unchanged; see ADR-0015's amendments for the hosting-tier consequence.
