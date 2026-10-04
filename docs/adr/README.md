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

| # | Title | Blocks weekend? | Status (2026-10-03) |
|---|---|---|---|
| [0001](0001-scope-and-phasing.md) | Product scope and delivery phasing | defines it | Proposed |
| [0002](0002-content-ingestion.md) | Content ingestion: user-submitted links, no bulk scraping **(Accepted)** | yes | Accepted |
| [0003](0003-outbound-publishing-bots.md) | Outbound publishing and the "counter-truth" bot | no (deferred) | Proposed |
| [0004](0004-verification-pipeline.md) | Claim verification pipeline (RAG + human verdicts) | yes | Proposed (implementation notes on file) |
| [0005](0005-speech-and-language.md) | Speech-to-text and translation (Swahili/Sheng/English) | yes | Proposed (Round A ASR benchmark run; Chirp_2 provisional winner) |
| [0006](0006-synthetic-media.md) | Synthetic media and deepfake handling | no (triage only) | Proposed |
| [0007](0007-maandamano-tracker.md) | Maandamano tracker: safety, legal and data model | partial | Proposed |
| [0008](0008-legal-compliance.md) | Legal entity, ODPC registration and editorial policy | yes (gates accounts and comments) | Proposed — pending advocate sign-off |
| [0009](0009-runtime-topology.md) | Runtime topology, data stores and event flow **(Accepted)** | yes | Accepted |
| [0010](0010-client-strategy.md) | Client strategy: PWA first, Expo monorepo for stores | yes | Proposed |
| [0011](0011-ai-cost-controls.md) | LLM routing and cost controls | yes | Proposed — pricing figures [GAP] |
| [0012](0012-monetization.md) | Monetization sequencing | no (deferred) | Proposed |
| [0013](0013-git-workflow.md) | Git workflow and branch hygiene | process | Accepted — implemented (lefthook, commitlint, branch ruleset) |
| [0014](0014-monorepo-tooling-moon.md) | Monorepo tooling: moonrepo replaces Turborepo | tooling | Accepted — implemented |
| [0015](0015-deployment-topology.md) | Deployment topology: Cloud Run backend, Vercel frontends and BFF | yes | Accepted — implemented (Vercel rail; see `docs/runbooks/vercel-deploy.md`) |
| [0016](0016-deploy-rail-iac.md) | Atomic deploy rail and IaC (Terraform), scale-to-zero only | yes | Accepted — implemented |
| [0017](0017-event-driven-core.md) | Event-driven core: outbox, idempotency, ACID | yes | Accepted — implemented |
| [0018](0018-realtime-and-caching.md) | Near-real-time status (SSE) and caching | no (poll fallback) | Accepted — implemented |
| [0019](0019-test-strategy-redteam.md) | Test strategy: ADR-derived TDD and red-team gates | process | Accepted — process set; reference doc at `docs/architecture/testing-strategy.md` |
| [0020](0020-identity-auth-roles.md) | Identity, auth and roles | red-team gap | Accepted — anonymous-token slice implemented; editor/admin RBAC wave not yet implemented |
| [0021](0021-data-protection-lifecycle.md) | Data protection lifecycle | red-team gap | Proposed — pending advocate sign-off |
| [0022](0022-observability-incident-response.md) | Observability and incident response | red-team gap | Proposed — runbooks at `docs/runbooks/**` now in place (AT-0022-4); alerting/code still open |
| [0023](0023-adversarial-ai-abuse.md) | Adversarial AI and abuse | red-team gap | Proposed — implementation notes on file |
| [0024](0024-trust-safety-moderation.md) | Trust and safety, and moderation | red-team gap | Proposed |
| [0025](0025-editorial-operations-capacity.md) | Editorial operations and capacity | red-team gap | Accepted |
| [0026](0026-open-source-boundary-licence.md) | Open-source boundary and licence | red-team gap | Accepted — LICENSE/SECURITY.md/CONTRIBUTING.md/CODE_OF_CONDUCT.md/TRADEMARKS.md landed (AT-0026-1); CI/infra ATs still open |
| [0027](0027-user-media-uploads.md) | User media uploads | red-team gap | Proposed |
| [0028](0028-client-ux-baseline.md) | Client UX baseline — i18n, accessibility, low bandwidth, offline | red-team gap | Proposed |
| [0029](0029-cost-model-runway.md) | Cost model and runway | red-team gap | Accepted — STT line corrected to Chirp_2 post Round-A |
| [0030](0030-creator-funnel-conflict-of-interest.md) | Creator funnel and conflict-of-interest firewall | red-team gap | Proposed — process doc at `docs/architecture/creator-funnel-firewall.md`; code/audit-table ATs still open |
| [0031](0031-confidence-weighted-guidance.md) | Confidence-weighted guidance & data-flywheel threshold evolution | model direction |

Each row's status is copied verbatim from that ADR's own `**Status:**`
line (source of truth); "implemented"/"implementation notes" callouts
mean the ADR's own "Implementation notes" section exists, not that every
acceptance test in its table is green — check the ADR itself for the
real AT-by-AT status before relying on this summary for a release
decision.

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

## Implementation status ledger (2026-10-04)

Evidence-based state of every ADR after the weekend build merged to `main`. "Implemented" = code exists on `main` and was verified (moon ci + tests + integration). "Partial" = core landed, some acceptance tests still RED. "Proposed" = decision recorded, not yet built (reason given). No status is claimed without evidence.

| ADR | State | Evidence / what remains |
|---|---|---|
| 0001 scope & phasing | Accepted | Phasing drives the build; Phase-0 PWA + site shipped |
| 0002 content ingestion | Implemented | User-submitted links + quote/timestamp flow live (blocker-1/2 fixed) |
| 0003 outbound bots | Proposed | Blocked: platform API access + X automation approval |
| 0004 verification pipeline | Implemented | Human review gate live (AT-0004-A/B green); RAG/citation guards in pipeline; quote-less video URLs short-circuit before any LLM call (`needs_quote`), no fabricated empty analysis |
| 0005 speech & language | Partial | ASR Round A done (Chirp_2 7.8%); Round B needs human Sheng clips; STT not wired to live |
| 0006 synthetic media | Implemented | Triage (C2PA + detector-as-triage), never "deepfake" on score alone |
| 0007 maandamano | Partial | Tracker UI + night band live; kill-switch *mechanism* now GREEN (AT-0007-A: audited `maandamano_kill_switch` policy flag, `GET /v1/maandamano` server-side enforcement, ISR revalidation webhook — see docs/runbooks/nc4-kill-switch.md); AT-0007-B (log redaction, EXIF stripping, ongoing-event comment gating) remains RED/not implemented |
| 0008 legal compliance | Proposed | Blocked: Kenyan advocate sign-off; 7 questions logged |
| 0009 runtime topology | Accepted/Implemented | Two-runtime + polyglot roadmap; moon graph live |
| 0010 client strategy | Partial | PWA + Expo decision; mobile app not started (D-U-N-S gated) |
| 0011 AI cost controls | Accepted | Pricing verified; routing defined; telemetry table exists |
| 0012 monetization | Proposed | Deferred (billable-last); Vercel Pro gate documented |
| 0013 git workflow | Implemented | lefthook + ruleset + conventional/no-attribution enforced (5 AT green) |
| 0014 moonrepo | Implemented | moon v2 migration complete (AT green) |
| 0015 deployment topology | Implemented | Vercel web+site LIVE; Cloud Run defined, enable_services=false |
| 0016 deploy rail + IaC | Implemented | Terraform applied (free-tier), plan-guard, release rail (AT green) |
| 0017 event-driven core | Implemented | Outbox + 3-layer idempotency + state machine (AT green, 33/33 integ) |
| 0018 SSE + caching | Implemented | SSE live-verified, caching, device tokens (AT green) |
| 0019 test strategy | Implemented | AT suites + RED/GREEN + red-team gates in use |
| 0020 identity/auth/roles | Implemented | Self-hosted auth + MFA + audit log; security-hardening merged — bootstrap admin grant is self-target-only, TOTP codes single-use (replay-proof via `totp_used_codes`) |
| 0021 data protection | Partial | Retention sweep + TOTP replay-store pruning (migration 0011) + DSAR export now real for submissions/drafts (AT-0021-4 closed — `submissions.device_token_hash` added, published checks still excluded by design). AT-0021-2 (upload EXIF/GCS lifecycle), AT-0021-3 (log-sink IP redaction), AT-0021-5 (privacy-notice page) remain RED — pipeline/infra/web territory, out of this pass's scope. Cross-border transfer basis still needs advocate sign-off |
| 0022 observability | Partial | Infra alerts + 4 runbooks; app-emitted DLQ/quota metrics RED |
| 0023 adversarial AI | Implemented | Delimited untrusted blocks, citation integrity, injection fixtures |
| 0024 trust & safety | Implemented | Comments moderation; comment-on-draft gate merged (403 on unpublished/draft checks, before demonstration-state logic) |
| 0025 editorial ops | Implemented | Review queue/approve/correct/right-of-reply (AT green) |
| 0026 OSS boundary/licence | Implemented | Apache-2.0 LICENSE + SECURITY/CONTRIBUTING/COC; GitHub push-protection on |
| 0027 user media uploads | Partial | Processing (EXIF strip/hash/scan) done; signed GCS upload RED |
| 0028 client UX baseline | Implemented | EN/SW i18n live; a11y audit GREEN (axe on home/submit/check/maandamano/editor + independently-recomputed WCAG AA contrast across the verdict palette) + offline SW tests GREEN; visible keyboard focus restored on the dropzone. Residual: `@fact-checker-ke/brand` not independently a11y-audited; SW install/activate lifecycle not exercised e2e |
| 0029 cost model | Accepted | Doc complete; advocate retainer amount a GAP |
| 0030 creator funnel | Accepted | Firewall process doc; audit-table schema + write path now GREEN (AT-0030-1: migration 0011 `funnel_audit_log`, `services/api/src/lib/creator-funnel.ts#recordFunnelPost`, `POST /v1/editor/funnel-posts`, admin-only — enforces published-only source restriction at write time plus a DB CHECK constraint). AT-0030-2 (queue lint check), AT-0030-3 (manual spot-check), AT-0030-4 (funding-transparency page line item), AT-0030-5 (snapshot/regex test over rendered templates) remain RED — web/process territory, out of this pass's scope |
| 0031 confidence-weighted | Implemented (scaffold) | Contracts (`calibratedConfidence`/`whatWouldChangeThis`/`evidence`/`riskTier` + published-check framing refine), risk-tier classifier, calibration harness (PAVA isotonic + ECE on fixtures), publish-policy table, flywheel capture (migration 0010: `check_evidence`/`policy_flags`/`training_eval_labels`), threshold-change + advocate-signoff audit, and `check-card` surfacing — all GREEN (AT-0031-1..5). **Both hard constraints enforced in code** (Tier C never auto; calibration-before-thresholds) with **auto-publish OFF by default** and no billable keys. `training_eval_labels (check_id, actor_ref)` dedup (flywheel-poisoning guard) closed in migration 0011 — `captureUserSignal` now upserts last-signal-wins on that constraint. Residual: risk-tier not yet wired into the verify-hop draft prompt; τA/τB are placeholders, not fit from data |

**Billable/live surfaces deliberately deferred** (owner: "billable last"): the Cloud Run backend deploy (`enable_services=true`), real LLM/STT API keys, platform-posting bots, payments/ads, and app-store submission. The pipeline runs on fakes until a key lands.
