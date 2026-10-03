# ADR-0005: Speech-to-text and translation (Swahili, Sheng, English, code-switched)

**Status:** Proposed · **Date:** 2026-10-03

## Problem
Political speech and creator content in Kenya is heavily code-switched (English, Swahili and Sheng), often noisy, and sometimes live. The STT layer has to be commercially licensable and close to free.

## Evidence (FLEURS sw_ke: clean, read, standard Swahili)

| Model | WER | Licence |
|---|---|---|
| Gemini 2.5 Flash (n=20) | 13.1% | Hosted API |
| Meta MMS-1b-all | 13.5–13.7% | **CC-BY-NC 4.0: can't be used commercially** **[V]** |
| thinkKenya wav2vec2-xls-r-300m-sw | 23.2–27.7% | Apache 2.0, Swahili only **[V]** |
| Whisper large-v3 | 31.0–32.4% | MIT |

These figures come from a single non-peer-reviewed Ushahidi PR with small samples **[V, medium]**. **There is no data on Sheng, code-switching or noisy livestream audio [GAP].** Chirp and AWS Transcribe sw-KE were not benchmarked **[GAP]**.

## Options
1. **Self-host MMS.** Rejected: the licence forbids commercial use **[V]**.
2. **Self-host Whisper or XLS-R on Cloud Run with a GPU.** Rejected for now: worst accuracy (Whisper) or Swahili only (XLS-R), and GPU instances break the cost target **[I]**.
3. **Hosted multimodal or STT API behind an interface.** Recommended. Gemini audio is the provisional default and Chirp is the candidate to compare against.

## Decision (proposed): Option 3
- Define a `Transcriber` interface with a provider per implementation. Output is `{segments[{start,end,text,lang,confidence}]}`.
- **This weekend: build a 30-clip Kenyan eval set** (Bunge speeches, Citizen TV clips, creator TikToks with Sheng). Run Gemini and Chirp against it before locking the provider.
- **Translation:** keep the original language as the source of truth. Store machine translation (English) alongside it for claim extraction. Show both in the UI, and quote the original in the verdict.
- **Live streams:** take segmented ingest (30-60s chunks) of a stream we're permitted to access. Claims show with a lag of a minute or two, which we label "near-real-time".
- Collect corrections from editors as future fine-tuning data for the Apache XLS-R model, which would be our own Sheng model and a moat **[I]**.

## Trade-offs accepted
We depend on a vendor for our most important input. Cost per audio hour is unknown until pricing is verified **[GAP]**. Hard-cap audio minutes per user per day.

## Review trigger
Revisit if our eval set shows the open Apache model within 5 points of WER of the hosted one, or if monthly STT spend passes a set threshold.

---
## Research round 2 (2026-10-03): amendments for grooming

- **Scope change from ADR-0002 round 2:** we cannot pull audio from third-party YouTube videos (and probably not TikTok) under their API terms. STT inputs become:
  - live streams we are permitted to capture
  - partner broadcaster content (owner-authorized)
  - our own uploads and media
  - Bunge and official audio published under open terms **[GAP: licence per source]**
- Provider facts **[V2-SECONDARY]**:
  - Google STT v2 Chirp 3 lists sw-KE (Preview). Price is about $0.016/min. The v2 recurring free tier may not exist (sources conflict).
  - AWS Transcribe supports sw-KE for batch and streaming. Its price and free tier are unverified.
  - Gemini audio input is about 25 tokens per second of audio.
- **Budget for paid STT from day one.** Don't assume a free tier.
- Still no Swahili, Sheng or code-switched WER data beyond FLEURS. The 30-clip eval set remains the deciding test.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #9 (also applied to ADR-0001).

- **U2 redefined.** "Near-real-time" checking of live streams/speech does not mean a new named-person "False" verdict shipping live. ADR-0008 §3's right-of-reply window (fixed at 48h by that ADR's amendments) applies regardless of stream latency. Live mode's job is to show **existing published checks** and context cards beside licensed embeds with a lag of a minute or two, not to publish new verdicts in near-real-time. STT inputs remain scoped to live streams we're permitted to capture, partner/broadcaster content, our own uploads, and openly-licensed official audio (Bunge) — this was already correct above and is unchanged; the correction is to the *publishing* claim, not the *transcription* claim.

---
## ASR/translation amendments (2026-10-03, owner pushback)

### Production evidence from the owner's own project [V-OBSERVED]
`~/Development/pawa_assessment` (the pawacloud deploy) shipped multilingual document handling on **Gemini 2.5 Flash** (`google-generativeai==0.8.4`) with **translation done LLM-inline** — a "Translate → sw" document flow streamed over SSE, a prompt-level language policy (respond in the user's language; Swahili, Amharic, Yoruba, Hausa, Zulu, French; keep technical terms like "Cloud Run" in English), and a Protocol-shaped client built to swap Gemini for Claude/OpenAI (`backend/app/services/llm_service.py`). No dedicated Translation API, no separate STT. This makes **inline translation the default-to-beat**, not a hypothesis.

### Free-tier terms: verified, and prohibitive [V-PRIMARY]
Gemini API Data Usage terms (ai.google.dev/gemini-api/terms, updated 2026-03-23): unpaid tier — "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products", human reviewers may read submissions, and "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Paid tier — "Google doesn't use your prompts…or responses to improve our products."
**Decision:** the unpaid tier is **prohibited for any user-submitted or protest-related content** (ADR-0021/DPA 2019). It may be used only for building the eval set from owned/public-broadcast clips. Production STT/LLM calls run on paid tiers; the near-zero goal is met by the content-addressed result cache (ADR-0017 — a viral clip submitted 500× is paid once), on-demand-only transcription, and per-device audio caps — not by free tiers. This closes the round-2 "[GAP] free-tier training terms". Google Cloud Translation's free quota (recalled ~500K chars/month under no-training Cloud terms) remains **[GAP: verify]** and only matters if inline translation fails the eval.

### Translation decision (proposed)
Default: **inline** — the claim-detection call (Haiku 4.5, ADR-0011) emits the English working translation in the same structured output, near-zero marginal tokens, pawacloud-validated. The original language stays the source of truth; verdicts quote the original (unchanged from the main decision). A dedicated translation hop enters only if the eval set shows inline sw→en materially worse than Cloud Translation/Gemini-dedicated.

### WER commitment (closes "which WER are we committed to?")
- **Provider gate:** lowest WER on the 30-clip Kenyan eval set wins; **disqualify any provider >25% WER on the noisy subset** — beyond that, claim extraction invents claims, which here is a defamation hazard, not a UX blemish.
- **Two-tier tolerance, architecturally honest:** machine transcription is *triage* (tolerates ≤25%); *publication* tolerates 0% unverified — AT-0004-A already requires an editor to confirm any named-person quote against the source before a rating renders, so no published verdict ever rests on raw ASR.
- Eval set composition fixed: 30 clips (Bunge, Citizen TV, creator TikToks), **≥10 Sheng/code-switched, ≥10 noisy/crowd**, scoring both WER and sw→en translation quality across Gemini-paid, Chirp, and Haiku-inline.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0005-1 | The eval set exists: 30 Kenyan clips with ≥10 Sheng/code-switched and ≥10 noisy, each with reference transcript + reference translation | RED |
| AT-0005-2 | The chosen STT provider scores ≤25% WER on the noisy subset; the decision is recorded here with per-provider numbers | RED |
| AT-0005-3 | No production code path can call an unpaid-tier Gemini/AI-Studio endpoint: config test asserts paid-tier keys/billing project, and CI greps for AI-Studio free-tier usage | RED |
| AT-0005-4 | Inline sw→en translation quality is within the agreed threshold of the best dedicated option on the eval set, or a dedicated hop is added and this row updated | RED |

### Benchmark: the `wave` project (owner's prior art) [V-OBSERVED 2026-10-03]
`~/Development/wave` (Senior ML Engineer application, Rust+PyO3/Python/Next.js/CDK) contributes two verified lessons:
1. **Language-ID is an in-process stage, never a service.** wave replaced its always-on SageMaker XLM-RoBERTa endpoint (~$86/mo) with an in-process `langdetect` library call inside the existing Lambda ($0) — `backend/python/sagemaker_handler.py` documents the swap inline. **Decision for us:** language identification runs in-process in the `analyze` hop. Default: the claim-detection call (Haiku 4.5) emits `language` in the same structured output it already returns (consistent with the inline-translation decision above); a library fallback (lingua/fasttext-class) only if eval shows the LLM misrouting. Caveat carried over: library detectors are weak on short, code-switched and Sheng text — wave's own Rust heuristic (`backend/src/voice.rs`) is *deliberately conservative*, flagging Swahili only on unambiguous keywords; our claim-language router inherits that bias (uncertain → treat as code-switched, keep the original text primary).
2. **No WER harness exists in wave** — checked; the multilingual work there is language-ID and intent, not ASR. The 30-clip eval set remains the first WER instrument we'll own.

### Provider lock-in (owner, 2026-10-03) + cost model [V-PRIMARY pricing]
**LOCKED (provisional): Gemini Flash via Vertex AI, paid tier** — no-training Cloud terms, rides existing gcloud auth. Conditional: stays locked only while it (a) wins or ties Round A WER on our harness and (b) clears the ≤25% noisy-subset gate in Round B; failing either unlocks the decision and the next-best qualifier takes over. Round A is in flight; this section gets its results appended.

Cost math (ai.google.dev/gemini-api/docs/pricing, fetched 2026-10-03 — Vertex list prices to be confirmed at implementation, usually identical [GAP-minor]):
| Item | Figure |
|---|---|
| Gemini 2.5 Flash audio input | **$1.00 / MTok**; text in $0.30; output $2.50 |
| Audio token rate | ~25 tokens/sec → 1,500 tokens/min |
| **Transcription cost** | input $0.0015/min + output (~300 tok/min transcript) $0.00075/min ≈ **$0.00225/min ≈ $0.14/hour** |
| Chirp (GCP STT v2) comparator | ~$0.016/min ≈ $0.96/hour [V2-SECONDARY] → **Gemini ≈ 7× cheaper** |
| Worst-case daily exposure | 60 min/day audio cap → <$0.14/day before dedup; the ADR-0017 result cache amortises viral duplicates to one payment |
| Newer option noted | Gemini 3.8 Flash exists ($0.75/MTok promo input through 2026-12-31, $1.50 after; audio price not separately listed) — the eval harness tests whichever Flash generation Vertex serves; a model-generation bump re-runs Round A, it does not reopen the provider decision |

ADR-0029's variable-cost line for STT is corrected by this table: ~$0.00225/min (Gemini) not $0.016/min (Chirp assumption) — an ~86% reduction in the modelled STT unit cost.
