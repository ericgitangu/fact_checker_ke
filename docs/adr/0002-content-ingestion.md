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
## Decision update (2026-10-03): ACCEPTED, video transcript path

Option **(a)** was accepted by the product owner. For third-party YouTube and TikTok videos, the user supplies the quoted text and timestamp. We fact-check that text and show the official embed for context. No audio is downloaded. Options (b) (apply to YouTube for written approval) and (c) (partner broadcasters via owner OAuth) remain the scaling path and are tracked separately.
