# fact_checker_ke — Architecture Decision Records

Status of all ADRs: **Proposed**, for grooming. None are accepted yet.

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
| [0002](0002-content-ingestion.md) | Content ingestion: user-submitted links, no bulk scraping | yes |
| [0003](0003-outbound-publishing-bots.md) | Outbound publishing and the "counter-truth" bot | no (deferred) |
| [0004](0004-verification-pipeline.md) | Claim verification pipeline (RAG + human verdicts) | yes |
| [0005](0005-speech-and-language.md) | Speech-to-text and translation (Swahili/Sheng/English) | yes |
| [0006](0006-synthetic-media.md) | Synthetic media and deepfake handling | no (triage only) |
| [0007](0007-maandamano-tracker.md) | Maandamano tracker: safety, legal and data model | partial |
| [0008](0008-legal-compliance.md) | Legal entity, ODPC registration and editorial policy | yes (gates accounts and comments) |
| [0009](0009-runtime-topology.md) | Runtime topology, data stores and event flow | yes |
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
