# fact_checker_ke — Architecture Decision Records

Status of all ADRs: **Proposed**, for grooming. ~~None are accepted yet.~~ _(superseded — see "Red-team review (2026-10-03)": ADR-0002 and ADR-0009 are now **Accepted**; the rest remain Proposed.)_

Research basis: deep-research run `wf_7f486c8c-80e` (2026-10-03). It fetched 24 sources, extracted 110 claims and adversarially verified the top 25 (3 votes each). All 25 were confirmed.

## Evidence legend (every factual claim in these ADRs is tagged)

| Tag | Meaning |
|---|---|
| **[V]** | Verified: a 3-0 or 2-1 adversarial vote against a cited primary or secondary source |
| **[U]** | Unverified: pulled from a fetched source but not vote-checked because of budget. Re-verify before you depend on it |
| **[I]** | Inference: reasoned from the evidence, with no source saying it directly |
| **[GAP]** | Not researched. Treat it as unknown, not as cleared |

## Index

| # | Title | Blocks weekend? |
|---|---|---|
| [0001](0001-scope-and-phasing.md) | Product scope and delivery phasing | defines it |
| [0002](0002-content-ingestion.md) | Content ingestion: user-submitted links, no bulk scraping **(Accepted)** | yes |
| [0003](0003-outbound-publishing-bots.md) | Outbound publishing and the "counter-truth" bot | no (deferred) |
| [0004](0004-verification-pipeline.md) | Claim verification pipeline (RAG + human verdicts) | yes |
| [0005](0005-speech-and-language.md) | Speech-to-text and translation (Swahili/Sheng/English) | yes |
| [0006](0006-synthetic-media.md) | Synthetic media and deepfake handling | no (triage only) |
| [0007](0007-maandamano-tracker.md) | Maandamano tracker: safety, legal and data model | partial |
| [0008](0008-legal-compliance.md) | Legal entity, ODPC registration and editorial policy | yes (gates accounts and comments) |
| [0009](0009-runtime-topology.md) | Runtime topology, data stores and event flow **(Accepted)** | yes |
| [0010](0010-client-strategy.md) | Client strategy: PWA first, Expo monorepo for stores | yes |
| [0011](0011-ai-cost-controls.md) | LLM routing and cost controls | yes |
| [0012](0012-monetization.md) | Monetization sequencing | no (deferred) |
| [0013](0013-git-workflow.md) | Git workflow and branch hygiene | process |
| [0014](0014-monorepo-tooling-moon.md) | Monorepo tooling: moonrepo replaces Turborepo | tooling |
| [0015](0015-deployment-topology.md) | Deployment topology: Cloud Run backend, Vercel frontends and BFF | yes |
| [0016](0016-deploy-rail-iac.md) | Atomic deploy rail and IaC (Terraform), scale-to-zero only | yes |
| [0017](0017-event-driven-core.md) | Event-driven core: outbox, idempotency, ACID | yes |
| [0018](0018-realtime-and-caching.md) | Near-real-time status (SSE) and caching | no (poll fallback) |
| [0019](0019-test-strategy-redteam.md) | Test strategy: ADR-derived TDD and red-team gates | process |
| [0020](0020-identity-auth-roles.md) | Identity, auth and roles | red-team gap |
| [0021](0021-data-protection-lifecycle.md) | Data protection lifecycle | red-team gap |
| [0022](0022-observability-incident-response.md) | Observability and incident response | red-team gap |
| [0023](0023-adversarial-ai-abuse.md) | Adversarial AI and abuse | red-team gap |
| [0024](0024-trust-safety-moderation.md) | Trust and safety, and moderation | red-team gap |
| [0025](0025-editorial-operations-capacity.md) | Editorial operations and capacity | red-team gap |
| [0026](0026-open-source-boundary-licence.md) | Open-source boundary and licence | red-team gap |
| [0027](0027-user-media-uploads.md) | User media uploads | red-team gap |
| [0028](0028-client-ux-baseline.md) | Client UX baseline — i18n, accessibility, low bandwidth, offline | red-team gap |
| [0029](0029-cost-model-runway.md) | Cost model and runway | red-team gap |
| [0030](0030-creator-funnel-conflict-of-interest.md) | Creator funnel and conflict-of-interest firewall | red-team gap |

## Hard blockers found

1. **Play Store (new personal account):** at least 14 days of closed testing with 12 or more testers before production access, then up to about 7 days of review. **[V]**
2. **TikTok Research API:** not available to a Kenyan commercial product. **[V]**
3. **IFCN signatory status:** processing alone takes 6-18 months, and it requires a published track record. **[V]**
4. **Best open Swahili ASR (Meta MMS)** is licensed CC-BY-NC, so it can't be used in a monetized product. **[V]**
5. **YouTube captions API:** works only on videos you can edit. Third-party captions need your own STT. **[V]**
6. **Threads public keyword search:** requires Meta App Review. **[V]**
7. **X API replies (since 23 Feb 2026):** an API reply only goes through when the original author mentioned you or quoted your post. **[U]**

## Research gaps (second round needed before the affected ADR is accepted)

Each of these is marked **[GAP]** in the relevant ADR:

- Claude per-token pricing, caching and batch discounts
- Chirp and AWS Transcribe Swahili accuracy and cost
- Free-tier limits for Cloud Run, Neon, Upstash and QStash
- App Store review times
- AdMob/AdSense policy on political content
- Kenyan defamation case law
- Current status of the CMCA 2025 amendments
- Rekognition vs GCP video AI

## Research round 2 (2026-10-03)

Four parallel research agents covered the gaps above. Their findings are appended to each affected ADR under "Research round 2". Tags: **[V2-PRIMARY]** means the agent fetched the vendor or court page directly. **[V2-SECONDARY]** means aggregator or news summaries, to be confirmed before relying on them.

**New hard blocker:**

8. **YouTube API terms prohibit downloading audio, or isolating it from video, without written approval [V2-PRIMARY].** Combined with #5, there is no compliant automated transcript path for third-party YouTube videos. TikTok's position is unconfirmed. See ADR-0002 round 2 for the options.

**Changes to earlier blockers:**
- #7 (X replies) is now **[V2-PRIMARY]**, from an @XDevelopers announcement.
- #1 (Play testing) may be avoidable with an organisation account, and personal-to-organisation conversion is reportedly possible **[V2-SECONDARY]**. **D-U-N-S is now the critical path:** up to 30 days for Google, 2-4 weeks for Apple org enrollment.

**Still open:**
- Kenya AdMob political-ad rules
- Apple review-time figure (sources conflict)
- TikTok's ToS on audio for transcription
- Threads App Review turnaround
- Neon pgvector on the free plan
- Cloud Run `africa-south1` pricing tier
- AWS Transcribe price
- Swahili, Sheng and code-switched WER
- The primary texts of the 2026 CMCA judgments

## Red-team review (2026-10-03)

A red-team pass read the README plus ADR-0001 through ADR-0019 in full and produced a report with use-case coverage, contradictions, 16 edge-case REDs and 15 amendments. The amendments were applied additively to the owning ADRs (see each ADR's own "Red-team amendments (2026-10-03)" section). This section summarises the review for the set as a whole.

### Use-case coverage (U1-U11)

| U | Use case | Verdict |
|---|---|---|
| U1 | Check creator/politician claims | Partial — works for text platforms (X, Threads); unsafe for video until quote attribution is editor-verified (ADR-0002, ADR-0004) |
| U2 | Near-real-time on live streams and speech | Redefined — live mode shows existing published checks beside licensed embeds; it never publishes a new named-person verdict live (ADR-0001, ADR-0005, ADR-0008) |
| U3 | Maandamano tracker | Partial, honestly descoped — editor-curated, ward-level, delayed; gaps in advisory staleness and kill-switch mechanism now closed (ADR-0007) |
| U4 | Deepfakes | Partial, contradicted by ADR-0002 — detection works only on user uploads/owner-authorized media until a licensed media path exists (ADR-0006) |
| U5 | Comments, likes, sharing corrections | Deferred, no design — blocked on the forthcoming Identity and Trust & safety ADRs (0020, 0024) |
| U6 | Counter-truth bots | Partial, honestly descoped — own-timeline only, human-gated, X plus Threads; TikTok/YouTube publishing unaddressed (ADR-0003) |
| U7 | Founder content funnel | Gap — no conflict-of-interest rule; blocked on the forthcoming Creator funnel ADR (0030) |
| U8 | Monetization and runway | Partial — no cost or runway model; blocked on the forthcoming Cost model ADR (0029) |
| U9 | OSS, stores, PWA, SPA, launch soon | Partial — D-U-N-S is the critical path (3-4 weeks); no OSS licence decision yet (ADR-0010, ADR-0013, ADR-0016; forthcoming 0026) |
| U10 | Near-zero cost, EDA, multi-tenant | Partial, with arithmetic errors now corrected — QStash/Neon budgets fixed (ADR-0009, ADR-0016, ADR-0017); "multi-tenant" is really "single-tenant, tenant-ready" |
| U11 | Authoritative and legally compliant | Partial — drafts shown to the submitter are now excluded from publication (ADR-0004, ADR-0008); data residency and law-enforcement policy deferred to the forthcoming Data protection ADR (0021) |

### The 16 edge-case REDs

All sixteen scenarios below got at least one Acceptance-test row with `Status: RED` added to their owning ADR's Acceptance tests table.

| # | Scenario | Owner ADR(s) |
|---|---|---|
| C-1 | Fabricated quote attributed to a named person | ADR-0004, ADR-0008 |
| C-2 | A draft treated as published for defamation purposes | ADR-0004, ADR-0008 |
| C-3 | QStash quota exhausted during a viral event | ADR-0009, ADR-0017, ADR-0011 |
| C-4 | Neon never actually scales to zero | ADR-0016, ADR-0017 |
| C-5 | Inline outbox relay throttled by Cloud Run request-based CPU | ADR-0017 |
| C-6 | Hallucinated or misquoted citation | ADR-0004 |
| C-7 | Kill switch is leaky (CDN/SW keep serving) | ADR-0007, ADR-0018 |
| C-8 | Protest-viewer exposure via logs, EXIF, coarsening defeat | ADR-0007 (data-protection pieces deferred to forthcoming ADR-0021) |
| C-9 | CGNAT false positives on per-IP limits | ADR-0018, ADR-0011 |
| C-10 | Dedup negation collision / stale statistic reuse | ADR-0004 |
| C-11 | Sheng opinion misrated as claim, or the reverse | ADR-0004, ADR-0011 |
| C-12 | OSS repo is the attack surface (fork-PR, WIF, CI off) | ADR-0013, ADR-0016 |
| C-13 | Politician's lawyers after a "False" verdict | ADR-0008 |
| C-14 | Creator gaming (self-submission, mass-submission of rivals) | ADR-0008, ADR-0003 |
| C-15 | Vercel commercial-use breach (sponsors/grants/incorporation) | ADR-0015 |
| C-16 | Cloud Run custom domain in `africa-south1` may force a global LB | ADR-0016 |

### Missing decisions: ADRs 0020-0030

The amendments above close the sharpest edge cases but do not substitute for full decisions on eleven areas the current set has no ADR for. ADRs 0020 through 0030 are being added separately (by other agents; this ADR set's owner does not create them) to cover:

- **0020** Identity, auth & roles
- **0021** Data protection lifecycle
- **0022** Observability & incident response
- **0023** Adversarial AI & abuse resistance
- **0024** Trust & safety / moderation
- **0025** Editorial operations & capacity
- **0026** Open-source boundary & licence
- **0027** User media uploads
- **0028** Client UX baseline (i18n, a11y, low-bandwidth, offline)
- **0029** Cost model & runway
- **0030** Creator funnel & conflict of interest
