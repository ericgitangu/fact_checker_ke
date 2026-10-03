# ADR-0001: Product scope and delivery phasing

**Status:** Proposed · **Date:** 2026-10-03

## Problem
The brief bundles about 10 products into one weekend. They are:

- a fact-checking engine
- live-stream real-time checking
- a protest tracker with heatmap and live feeds
- a deepfake detector
- iOS and Android native apps
- a PWA
- a marketing SPA
- bot counter-posting
- a creator content funnel
- ads, subscriptions and sponsorships

Several of these are blocked by external timelines that no amount of engineering can shorten (see README "Hard blockers").

## Options
1. **Everything this weekend.** This can't be done: the Play Store testing window alone is at least 14 days **[V]**, and Threads and TikTok access is gated **[V]**.
2. **A thin vertical slice this weekend, then the rest phased against external clocks.** This is the recommendation.
3. **Research only, nothing shipped.** This loses momentum and the portfolio signal.

## Decision (proposed): Option 2

**Phase 0, this weekend (2026-10-03/04):**
- **Marketing SPA:** what the app is, the methodology, a link to the GitHub repo, and a waitlist.
- **PWA, "Check a link":**
  1. The user pastes a URL (YouTube, X, TikTok, Threads, news article) or text.
  2. The pipeline transcribes it, extracts claims and grounds them with RAG. ~~(for third-party YouTube/TikTok video, no audio is transcribed — the user supplies the quote and timestamp)~~ _(superseded — see "Red-team amendments")_
  3. It returns a draft analysis with cited sources.
  4. Output is labelled "AI-assisted analysis — not a verdict". The published "verdict" tier needs human review (ADR-0004).
- **Maandamano page, read-only:** advisories curated by an editor (date, area, status, sources), plus a coarse area-level map with no live user geolocation (ADR-0007).
- **Infrastructure skeleton:** the runtime topology (ADR-0009), CI, and ClaimReview JSON-LD on published checks.
- **Start the external clocks:**
  - register a legal entity or confirm the plan for one
  - start ODPC registration
  - start the Apple Developer org account and the Play org account (D-U-N-S)
  - start Meta App Review for `threads_keyword_search`

**Phase 1 (weeks 1-4):**
- Expo app builds.
- Run the Play closed test with 12 testers for 14 days.
- Submit to the App Store.
- Comments, likes and shares, with full UGC moderation tooling (Apple 1.2 gate **[U]**).
- Editor dashboard for human verdicts.

**Phase 2 (months 1-3):**
- Near-real-time checking of live streams, as chunked audio with a lag of tens of seconds (ADR-0005).
- Own-timeline publishing bot (ADR-0003).
- Sponsorships and subscriptions (ADR-0012).

**Phase 3 (month 3 onward):**
- Coordinated-inauthentic-behaviour analysis with GNNs. This needs graph data we don't have API access to yet (ADR-0002).
- Ads.
- IFCN application once there is a 6-12 month track record **[V]/[U]**.

## Trade-offs accepted
- No app-store presence this weekend. The PWA carries the launch.
- "Real-time" means near-real-time on recorded or segmented audio, not sub-second.
- Human review caps how many verdicts get published. That is deliberate (credibility and legal exposure, ADR-0008).

## Review trigger
Revisit if Play grants production access early or Meta App Review clears early, or if a funded partner such as PesaCheck or Code for Africa offers editorial capacity.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #9.

- **Strike "transcribes it" for video URLs.** For third-party YouTube/TikTok video, ADR-0002's decision update (accepted) means no audio is downloaded or transcribed; the user supplies the quoted text and timestamp, and the official embed is shown for context. Phase 0's "Check a link" flow description above is stale for video and is superseded by ADR-0002 §"Decision update" and ADR-0005 §"Research round 2".
- **U2 (near-real-time on live streams/speech) is redefined:** "Live mode shows existing published checks and context cards beside licensed embeds. A new named-person False verdict never ships in live mode." This resolves the contradiction between near-real-time politician checks and the ADR-0008 §3 right-of-reply window — live mode surfaces prior published work, it does not publish new verdicts live.
- **Use-case coverage findings carried in from the red-team report (informational, not new decisions):**
  - U1 (check creator/politician claims): Partial — works for text platforms (X, Threads); unsafe for video until quote attribution is verified by an editor before any rating renders (see ADR-0004 amendments).
  - U2 (near-real-time live streams/speech): Fails for third-party content as originally scoped; redefined above.
  - U9 (OSS/stores/PWA/SPA, launch soon): Partial — D-U-N-S is the critical path (3-4 weeks), and the repo is about to go public with remote CI gates off (see ADR-0013/0016 amendments).
