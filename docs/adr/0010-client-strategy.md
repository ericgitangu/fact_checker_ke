# ADR-0010: Client strategy — PWA first, Expo monorepo for the stores

**Status:** Proposed · **Date:** 2026-10-03

## Problem
Your preference is native Swift and Kotlin. You also want DRY code across web and mobile, a weekend timeline and a solo developer.

## Evidence
- Play: a new personal account needs a closed test with 12+ testers for 14+ consecutive days, then up to about 7 days of review **[V]**. An organization account (D-U-N-S) probably avoids this **[I]**. **The account type is hard to change later.**
- Apple: UGC apps need filtering, reporting, blocking and contact info (1.2). Premium content needs IAP, and auto-renewable subscriptions must run at least 7 days (3.1.1/3.1.2(a)). Sensitive or regulated apps should be submitted by a legal entity (5.1.1(ix)) **[U]**. Review times are a **[GAP]**.

## Options
1. **Native Swift and Kotlin.** Three codebases for one developer, and no code shared with the web. Rejected for now. It remains a valid Phase 3 path for a flagship native feature.
2. **Expo (React Native) in a pnpm/Turborepo monorepo with the Next.js PWA.** ~~Turborepo~~ _(superseded — see ADR-0014: moonrepo replaces Turborepo)_ Recommended.
3. **PWA only, plus TWA (Android) and a thin wrapper (iOS).** Fastest, but Apple 4.2 (minimum functionality) risks rejecting wrappers **[GAP]**.

## Decision (proposed): Option 2
```
apps/web        Next.js PWA (launch surface)
apps/site       marketing SPA (GitHub CTA, waitlist)
apps/mobile     Expo (EAS Build), Phase 1
packages/core   zod schemas, API client, rating enums, ClaimReview builder
packages/ui     tokens + shared primitives (web via react-native-web where it pays off)
services/api    Fastify
services/pipeline FastAPI
docs/adr
```
- Share **logic and contracts**, not every component. Write native-feeling screens per platform where UX needs it.
- Native modules (Swift/Kotlin) go in through Expo modules for things like the share extension: "Share to fact_checker_ke" from TikTok or YouTube. That is the key intake UX and it gives you a native showcase.
- **Today:** apply for the Apple org account and a Play org account (D-U-N-S), or accept the 14-day path on a personal account.

## Trade-offs accepted
RN instead of pure native performance and polish. Mitigated by native share extensions.

## Review trigger
Revisit if an RN limitation blocks a core feature, such as background audio capture or a widget.

---
## Research round 2 (2026-10-03): amendments for grooming

- **Apple 4.2 confirmed [V2-PRIMARY]:** apps must "elevate it beyond a repackaged website". A thin PWA wrapper is a rejection risk. This supports choosing Expo and shipping native features (share extension, push notifications, offline).
- **Apple 5.1.1(ix) exact list [V2-PRIMARY]:** banking, healthcare, gambling, cannabis, air travel, crypto. Fact-checking isn't listed, so an org account isn't strictly *required* by Apple **[I]**. It is still recommended for legal exposure (ADR-0008).
- **Play:**
  - Organisation accounts are reportedly exempt from the 12-tester, 14-day rule, and **personal-to-organisation conversion in place is reportedly supported** **[V2-SECONDARY: confirm on support.google.com answer/16260648]**. If confirmed, the account type is *not* irreversible, so downgrade that warning.
  - A TWA build (Bubblewrap or PWABuilder) is a legitimate fast Android path and goes through normal Play review **[V2-SECONDARY]**.
- **D-U-N-S is the critical path.** Google says up to 30 days. Apple org enrollment takes 2-4 weeks **[V2-SECONDARY]**. **Apply for D-U-N-S this weekend.** Realistic floor to both stores: 3-4 weeks.
- **Play News & Magazines self-declaration** is required if the app uses news branding **[V2-SECONDARY]**.
- Apple review-time figures conflict (90% within 24h vs a 1.5-day average) **[GAP]**.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #15 (README/hygiene wave, medium severity).

- The monorepo-tooling choice in Option 2 above (Turborepo) is superseded by ADR-0014 (moonrepo replaces Turborepo), marked inline above. This ADR's client-strategy decision (Expo + Next.js PWA + shared `packages/core`) is otherwise unaffected.
