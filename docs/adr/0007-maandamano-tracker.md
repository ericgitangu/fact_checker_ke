# ADR-0007: Maandamano tracker — safety, legal posture and data model

**Status:** Proposed · **Date:** 2026-10-03

## Problem
A live, ongoing protest heatmap with live feeds and comments is useful to the public, the press and families. It can also be used to target protesters, to dispatch counter-groups, or as grounds for blocking the app. This is the feature most likely to cause real-world harm and regulatory action.

## Evidence
- The Court of Appeal (6 Mar 2026) declared CMCA ss.22-23 (false publication) unconstitutional **[U, Wayback source]**.
- The 2025 CMCA amendments give the NC4 power to order websites or apps blocked or removed, with critics noting no judicial oversight. Some parts of the amendments were suspended by the court; it is unclear whether the blocking power was **[U]**.
- The High Court quashed the Communications Authority (CA) directive banning live broadcast of protests. That ruling covers licensed broadcasters, not apps or streams **[U]**.
- Apple 1.2 requires filtering, reporting, blocking and contact info for any UGC **[U]**. Apple 5.1.5 permits location only where it is relevant to the app's features. 5.1.1(ix) says apps in regulated or sensitive fields should be submitted by a legal entity **[U]**.

## Options
1. **Real-time crowd-sourced pins and live feeds.** Rejected for Phase 0-1: it enables targeting, the content is unverifiable, and UGC moderation load would be heavy on day one.
2. **Editor-curated advisories with coarse, delayed geography.** Recommended.
3. **No protest feature.** Rejected: it is the core differentiator.

## Decision (proposed): Option 2
- **Event model:** `Demonstration { id, status: rumoured|announced|confirmed|ongoing|ended|cancelled, area (ward/sub-county polygon, not point), window, organiser_claimed, sources[] (credited), advisories[], last_verified_at, verified_by }`.
- **Status "rumoured"** is itself a fact-check target. Viral calls to protest go through ADR-0004.
- **Heatmap:** aggregate to ward or sub-county level. No user GPS is stored. For *ongoing* events, delay public granularity by 15-30 minutes **[I: tune with legal review]**.
- **Live feeds:** embed only public streams from licensed outlets, credited (Citizen, NTV, KTN YouTube embeds). Don't re-stream, and don't surface individual creators' location-bearing streams in Phase 0-1.
- **Advisories:** road closures, transport, hospital and legal-aid hotlines (LSK, KNCHR, Red Cross). Source and timestamp every item.
- **Comments:** arrive in Phase 1 only, with the full Apple 1.2 toolset (filtering, report, block, published contact) plus rate limits and a no-faces and no-names policy for uploads.
- **Kill switch:** an operator-level feature flag that freezes the tracker without a deploy. This is the response to an NC4 order or an escalation of violence.

## Trade-offs accepted
Less "live" than Twitter Spaces or TikTok Live. Safety and the app's legal survival outrank engagement.

## Review trigger
Revisit after a legal opinion (ADR-0008), or after the first incident report or takedown request.

---
## Research round 2 (2026-10-03): amendments for grooming

- **The NC4 blocking power has reportedly been struck down.** A High Court ruling (about 2 Jul 2026, Nyaundi J) reportedly declared the 2025 amendment's s.6(1) (NC4 blocking and removal) and s.27(1) (cyber harassment) unconstitutional. No appeal was found **[V2-SECONDARY: judgment text not retrieved]**. **Keep the kill switch:** the provision could be reinstated on appeal, and other takedown routes exist.
- CA live-broadcast ban quashed (Chigiti J; Katiba Institute petition; directive dated 25 Jun 2025) **[V2-SECONDARY: no case number]**. It covers broadcasters. Embedding licensed broadcasters' streams fits that precedent.
- **Public Order Act (Cap 56) s.5:** the duty to give 3-14 days' notice falls on *organisers* **[V2-PRIMARY: kenyalaw.org]**. A useful data source: a "notified to regulating officer" field can strengthen `announced`/`confirmed` status when the notice is public. No ruling covers third parties republishing protest schedules **[GAP: advocate question]**.
- **Google Play sensitive-events policy** allows content with educational or documentary value that raises awareness, but enforcement is judgment-based **[V2-SECONDARY]**. Keep the tracker's framing informational (safety advisories, sources), never mobilising.
