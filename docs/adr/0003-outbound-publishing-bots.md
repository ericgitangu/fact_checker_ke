# ADR-0003: Outbound publishing and the "counter-truth" bot

**Status:** Proposed · **Date:** 2026-10-03

## Problem
The brief calls for bots that post counter-truths on X, Threads, TikTok and YouTube. Platforms are actively shutting down unsolicited automated replies. A bot that replies to creators also *looks like* a coordinated influence operation, which is the very thing a fact-checker should be exposing.

## Evidence
- Since **23 Feb 2026**, an X API reply only goes through when the original author mentioned or quoted the replying account **[U]**. Posts that aren't replies are unaffected **[U]**. X's head of product framed this as "Operation Kill the bots" **[U]**.
- X write actions must follow the Automation Rules, and bots must disclose their operator **[U]**.
- X pay-per-use charges about $0.015 per text post and **$0.20 per post with a URL** (April 2026 surcharge) **[U]**. Every post that links to a fact-check would be expensive.

## Options
1. **Auto-reply under viral posts.** Rejected: the API blocks it **[U]**, it risks a ban, and it is reputationally toxic.
2. **Publish from our own timeline: a labelled automated account posts approved verdicts.** Recommended.
3. **Fully manual posting.** This is the fallback while volume is low.

## Decision (proposed): Option 2, human-gated
- Only verdicts **approved by a human** (ADR-0004) get published.
- The account bio reads "Automated account operated by fact_checker_ke", as X's disclosure rule requires **[U]**.
- **Wording policy:**
  - Target the *claim*, never the person.
  - Quote the claim, give the rating, cite the sources and link to the full check.
  - Personal opinions are explicitly out of scope ("we rate checkable factual claims only").
- To reduce the URL surcharge **[U]**, use image cards with the URL in the image or the first reply, and budget per month.
- **The creator funnel** (your YouTube and TikTok) is a separate, manual or assisted workflow. AI-generated scripts or voice must be disclosed under each platform's synthetic-content labelling rules **[GAP]**.

## Trade-offs accepted
Corrections reach people more slowly than a reply would. Verdicts reach our followers, not the original audience.

## Review trigger
Revisit if a platform offers a sanctioned fact-checker programme (for example X Community Notes API access **[GAP]**). Note that Meta ended its third-party fact-checking programme, and Google cut ClaimReview Search support **[V]**.

---
## Research round 2 (2026-10-03): amendments for grooming

- **The reply restriction is confirmed from a primary source.** @XDevelopers announced that from 23 Feb 2026, programmatic replies via POST /2/tweets are allowed only when the original author mentions you or quotes your post. This applies to all tiers, including pay-per-use **[V2-PRIMARY]**. Option 1 stays rejected.
- AI reply bots reportedly need **prior written X approval** under the April 2026 Automation Rules update **[V2-SECONDARY]**. Our own-timeline design avoids this, but confirm against the Automation Rules page.
- X write pricing: $0.015 per post, $0.20 per post with a URL **[V2-SECONDARY]**. The image-card approach stands.
- Threads: own-account publishing via `threads_content_publish` is available **[V2-SECONDARY]**. Add it as a second channel.

---
## Amendment (two-engine pivot, 2026-10-04) — auto-published assessments are the new outbound source

**Status:** Accepted direction (owner-approved pivot 2026-10-04). Additive; the own-timeline-only, operator-disclosed, claim-attributed, image-card-for-URL-surcharge decision is all retained unchanged.

- The outbound account now posts **auto-published** assessments (ADR-0031 default), from **both** ingest sources (fetch + submission), not only human-approved verdicts. The wording policy is unchanged and is now **enforced at auto-publish time in code** (ADR-0023 AT-0023-7 framing gate): target the claim never the person, quote+rating+sources+link, Tier-C mode (a) renders the open-question framing. The standing caveat (ADR-0033) travels with every post.
- The kill-switch (ADR-0031/0032) halts outbound auto-posting within one propagation cycle. The X per-post-with-URL surcharge and image-card mitigation are unchanged; outbound volume is now a function of auto-publish throughput, so the monthly budget cap (original Decision) is load-bearing.
