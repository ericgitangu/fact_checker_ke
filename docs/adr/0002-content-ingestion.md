# ADR-0002: Content ingestion — user-submitted links and official APIs, no bulk scraping

**Status:** Accepted (option a, 2026-10-03) · **Date:** 2026-10-03

## Problem
The brief wants to crawl X, Threads, TikTok and YouTube for trending stories. Official access is narrow, and scraping exposes us to ToS, legal and account-ban risk. A ban from one platform would kill that platform as a channel for the whole product.

## Platform access matrix (as of 2026-10-03)

| Platform | Discovery and search | Per-item fetch | Key constraint |
|---|---|---|---|
| TikTok | **Research API is not available** to us. It is limited to academic institutions in US/EEA/UK/CA/CH and non-commercial applicants **[V]** | oEmbed and Display API per URL **[GAP]** | No bulk discovery path |
| YouTube | Data API search is quota-metered **[GAP: quotas]** | Metadata yes. **captions.download only works on videos you can edit [V]** | Needs our own STT pipeline (ADR-0005). yt-dlp and timedtext violate the ToS **[V]** |
| Threads | `threads_keyword_search` needs App Review. Without it, search returns only our own posts. 2,200 queries per user per 24h. Sensitive terms return empty results **[V]** | oEmbed **[GAP]** | Meta may silently suppress protest terms **[V]**, a bias risk |
| X | Free tier eliminated except for "Public Utility Apps" **[U]**. Pay-per-use costs about $0.005 per post read with a 3M/month read cap **[U]** | Same pricing | Redistribution caps of 1.5M IDs per 30 days and 500 objects per user per day **[U]** |

## Options
1. **Headless-browser scraping fleet.** Rejected: ToS violations, IP bans, and conflict with the "authoritative and compliant" positioning.
2. **User-submitted links, plus official APIs where we qualify, plus open news and RSS sources.** Recommended.
3. **Buy a third-party social data vendor.** Deferred: the cost goes against the near-zero target.

## Decision (proposed): Option 2
- **Primary intake** is a "Check this" URL or text submission from users (PWA, app share-sheet, and later a WhatsApp or Telegram bot). Users bring the content, so we fetch one item at a time under the platform's embed terms.
- **Trending detection without scraping:**
  - RSS from Kenyan outlets (Nation, Standard, Citizen, The Star, KBC)
  - Google Fact Check Tools API **[V]**
  - Google Trends KE **[GAP]**
  - X pay-per-use search with a hard monthly budget cap **[U]**
  - submission velocity: many users submitting the same URL or claim is itself a trend signal
- **Media handling:**
  - We never re-host third-party video. We store the transcript, the claim, the timestamp offsets and the embed URL.
  - Audio is fetched transiently for STT only where the platform ToS allows it **[GAP: verify per platform]**.
  - Otherwise we fall back to user upload of audio or video they hold the rights to share.
- **An adapter interface per platform** (`SourceAdapter { resolve(url) -> ContentRef; fetchMedia?(); fetchText?() }`) so that gaining or losing access is a config change, not a rewrite.

## Trade-offs accepted
- Coverage is reactive (driven by what users submit), not proactive. Trending detection is weaker than a crawler would give.
- The GNN/propagation analysis in the brief is deferred because we don't legally have the follower or share graph.

## Irreversible / hard to undo
Getting a developer account banned. Never run scraping from accounts or IPs tied to the production app.

## Review trigger
Revisit if Meta App Review is approved, or if TikTok opens a commercial or non-profit research path. It's worth checking whether a not-for-profit arm could qualify for the TikTok VCE **[U]**.

---
## Research round 2 (2026-10-03): amendments for grooming

- **YouTube audio download is prohibited.** The YouTube API Services developer policies bar clients from downloading, caching or storing audiovisual content "without YouTube's prior written approval". They also bar separating or isolating the audio or video components **[V2-PRIMARY]**. Combined with captions.download working only on videos the caller can edit **[V]**, **we have no compliant automated path to transcribe third-party YouTube videos.**
  - Options to groom:
    - (a) The user supplies the quote and timestamp, and we fact-check the quoted text. The embed is shown for context.
    - (b) Apply to YouTube for written approval.
    - (c) Partner with broadcasters who own their channels. Their OAuth grant gives edit-permission captions.
    - (d) User uploads of clips they recorded, under rights and fair-dealing review. Copyright risk is **[GAP]**.
  - Recommended: (a) now, (c) as the scaling path, and (b) started in parallel.
- **YouTube metadata is cheap.** The quota is 10,000 units a day. videos.list costs 1 unit (batches of 50) and search.list costs 100 **[V2-SECONDARY]**. Lookups of a single submitted URL fit comfortably. Avoid search.list.
- **TikTok:** public oEmbed (`tiktok.com/oembed`) needs no auth and returns embed HTML, title, author and thumbnail. It suits the submitted-URL flow **[V2]**. Whether the Display API can read videos the authorizing user doesn't own is **unresolved (sources conflict)**: assume no until it has been tested live. ToS on downloading audio for transcription: **[GAP]**. Treat it the same as YouTube (option (a)) until confirmed.
- **Threads:** oEmbed is available **[V2-SECONDARY]**. App Review turnaround: **[GAP]**.
- **X:** pay-per-use. Post read $0.005, user read $0.010. No free tier for new developers **[V2-SECONDARY, matches round 1 U]**. Confirm in the X billing console.
- **Net effect on the matrix:** text platforms (X, Threads) are fully workable per URL. **Video platforms are embed plus user-supplied quote until a licensed transcript path exists.** This moves ADR-0005 (STT) toward live streams *we* are permitted to capture, our own uploads, and partner content.

---
## Amendment (two-engine pivot, 2026-10-04) — the autonomous fetch engine becomes the PRIMARY ingestion source

**Status of this amendment:** Accepted direction (owner-approved product pivot 2026-10-04). It is **additive**: the user-submission path (the original Decision above) is unchanged and becomes the *secondary* engine. Nothing above is deleted — the compliance boundaries (blockers #5/#8, the audio-download prohibition, `attribution: unverified`) carry forward **unchanged** and now bind the fetch engine too.

### What changed
The product is no longer primarily a user-submission fact-checker. It is a **self-sufficient, near-real-time** fact-checker with **two co-equal, event-driven ingestion engines feeding one verification+publish pipeline**:
1. **FETCH ENGINE (primary, "bait the hook and catch").** Autonomously ingests viral/trending political claims from YouTube/X/TikTok via **official platform APIs first**, using the **owner's own developer accounts**, with a **fakes/fixtures fallback** so the engine runs offline until keys land ("activate on owner's keys"). It detects virality → extracts the claim → verifies → auto-publishes a confidence-weighted, AI-caveated assessment (ADR-0031), with **no user required**. The "how it decides what to check" + EDA topology + dedup + backpressure is **ADR-0032**.
2. **SUBMISSION ENGINE (secondary).** The existing "Check this URL/text" path (the original Decision), now a *second front door* into the same pipeline.

Both emit the same `submission.received.v1` event after ingest; downstream analyze/verify/assess (ADR-0004/0031) is identical. Events gain `ingest_source: "fetch" | "submission"` provenance (ADR-0017 amendment).

### Revised Options (feasibility-driven, KE-landscape research 2026-10-04)
The headless-scraping option (original #1) stays rejected. The recommended intake is now **two engines**, and the fetch engine's *per-platform* feasibility is **not uniform** — this changes what is buildable:
- **YouTube Data API v3 — PRIMARY fetch source.** Cheapest and most ToS-compliant: 10,000 units/day, `search.list`=100 units (~100 searches/day free), `videos.list`=1 unit. Discovery + metadata are lawful; **audio download/isolation remains prohibited (blocker #8).**
- **PesaCheck / Africa Check — first-class triage feed AND check-against source.** They debunk viral KE claims fastest and publish open data via **openAFRICA/CKAN**; poll via **RSS/CKAN [GAP: confirm no realtime API]**. A claim they've already rated is both a top virality signal and an authoritative reuse/attribution hit (ADR-0004 step 4).
- **X/Twitter API v2 — secondary, metered, sampled.** Free tier discontinued (Feb 2026); pay-per-use (~$0.005/read, ~2M/mo cap). Sustained hashtag monitoring now **costs real money** — so X is **sampled and budgeted, never a firehose** (named trade-off; see ADR-0032 §4).
- **TikTok — explicit compliance decision point, NOT an assumed capability.** The Research API is gated to academic/public-interest institutions in US/EEA/UK/CH; a **Kenya-based commercial pilot almost certainly cannot qualify** (blocker #2, reconfirmed). TikTok is **embed-plus-metadata only** (public oEmbed per a surfaced URL), entering via cross-platform spread detected elsewhere — autonomous TikTok *discovery* is unavailable unless a public-interest partnership lands. Unofficial access is **rejected** (ban risk, "irreversible" below).
- **Authoritative check-against sources** for the KE-political focus: Parliament **Hansard** (searchable), **Judiciary causelist/e-filing** (case-status claims), **KNBS** (stats), plus the PesaCheck/Africa Check corpus. **Verify-before-building:** stable public **IEBC/KNBS APIs are [GAP]** — confirm the access path before depending on it.

### Revised Decision (additive)
- Keep the submission engine exactly as the original Decision specifies (secondary).
- Add the fetch engine as primary, per ADR-0032, bound by: **no third-party audio download/isolation** (blockers #5/#8); **official APIs + open data + lawful metadata only**; **scale-to-zero, cron-triggered** (no resident poller); **per-engine cost breaker** (ADR-0011/0032 §4); **kill-switch** (`FETCH_ENGINE_ENABLED`).
- The `SourceAdapter` interface (original Decision) is extended with a *discovery* capability for the fetch engine (`discover() -> ContentRef[]`) alongside the existing `resolve(url)`; gaining/losing a platform stays a config change.
- **Reverse-image/frame search becomes a named capability** (ADR-0032 §1b): the dominant KE tactic is recycled/misattributed old protest footage, so matching footage to an earlier-dated appearance is a first-class check, not an afterthought.

### Trade-offs accepted (additive to the originals)
- **Coverage is now proactive, but bounded by the ToS boundary.** Third-party viral *video audio* is still off-limits; some viral clips are checkable only from metadata/cross-posted text or not at all until a licensed/partner path exists. We keep this limit rather than risk the account bans that would kill the channel (irreversible, below).
- **X monitoring costs real money.** Accepting X as a sampled/budgeted secondary (not the near-real-time firehose the brief imagined) keeps cost-to-near-zero; YouTube (free quota) + PesaCheck/Africa Check (free open data) carry the primary load.
- **TikTok autonomous discovery is effectively unavailable** without a partnership — accepted over ban risk.
- **Autonomy raises stakes, not just throughput.** Auto-published named-person assessments are a defamation vector with no human in the submit loop — governed by ADR-0031 tiers + ADR-0033 caveat; virality is a *selection* signal, never a *publishing* authorization.

### Acceptance tests (fetch-engine ingestion; detailed topology ATs live in ADR-0032)
| ID | Behaviour | Status |
|---|---|---|
| AT-0002-1 | With no platform keys set, the fetch engine runs end-to-end on fakes/fixtures and makes zero outbound platform-API and zero billable LLM/STT calls ("activate on owner's keys"). | RED |
| AT-0002-2 | A fetched item and a user-submitted item converge on the same `submission.received.v1` → analyze/verify/assess pipeline, distinguished only by `ingest_source` provenance. | RED |
| AT-0002-3 | No fetch path downloads or isolates third-party YouTube/TikTok audio (blockers #5/#8 hold for the autonomous engine); YouTube Data API v3 is primary, X is budget-capped+sampled, TikTok has no autonomous-discovery path. | RED |

---
## Decision update (2026-10-03): ACCEPTED, video transcript path

Option **(a)** was accepted by the product owner. For third-party YouTube and TikTok videos, the user supplies the quoted text and timestamp. We fact-check that text and show the official embed for context. No audio is downloaded. Options (b) (apply to YouTube for written approval) and (c) (partner broadcasters via owner OAuth) remain the scaling path and are tracked separately.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #6 (also applied to ADR-0004 step 1).

- **A user-supplied quote carries `attribution: unverified`.** Nothing in this ADR today verifies that a submitted quote/timestamp pair is real: a submitter can invent words, attribute them to a named person, and get a check page built on a fabrication (red-team C-1). The editor must confirm the quote against the embed at the stated timestamp before any rating is published (see ADR-0004 step 7 amendment, AT-0004-A/AT-0004-B).
- **UI copy requirement:** wherever a video/audio URL is checked via user-supplied quote, the UI must state *"We checked the quote you provided, not the video audio."* This makes the ADR-0002 round-2 descoping (no audio fetch from YouTube/TikTok) honest to end users, which the original decision text above did not require.
