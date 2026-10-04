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
~~**LOCKED (provisional): Gemini Flash via Vertex AI, paid tier**~~ _(SUPERSEDED by Round A below — do not act on this line. Gemini lost: 18.4% WER vs Chirp_2's 7.8%, AND silently returned an empty transcript on a sensitive Bunge/FBI political clip, which is disqualifying for a political fact-checker where claims vanishing without an operator signal is a safety failure. **New provisional winner: GCP STT v2 Chirp_2**, pending Round B noisy/Sheng clips. Gemini remains a cheap secondary/fallback.)_ The original conditional lock-in text is kept below for the record — no-training Cloud terms, rides existing gcloud auth; it stayed locked only while it won or tied Round A WER (it did not) and cleared the ≤25% Round B gate; failing either unlocks it and the next-best qualifier takes over.

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

**Note on this section's own unlock condition, added when the Round A results below landed:** this lock-in states it "stays locked only while it wins or ties Round A WER on our harness." The Round A run immediately below has Gemini at 18.4% WER vs Chirp's 7.8% -- Gemini does not win or tie. Per this section's own rule, the lock is unlocked pending the owner's review; nothing above is edited to reflect that (out of scope for this append), but the condition and the result are now both on the record in the same document.

---
## WER Round A results (2026-10-03)

Harness: `eval/asr/` (self-contained `uv` project). Run with `uv run python -m asr_eval run` from `eval/asr/`; acceptance checks in `scripts/at/at-0005.sh`. Raw hypotheses, per-clip latency/cost and failure reasons are committed at `eval/asr/results/*.jsonl` + `results/summary.json` (audio itself is gitignored, never committed).

### Dataset and normaliser
- **google/fleurs, config `sw_ke`, split `test`** (487 rows total) — public read-speech, CC-BY-4.0, reference transcripts shipped by the dataset. Not user content, so eval use is compliant under this ADR's unpaid/paid split regardless; we ran it on paid endpoints anyway (see below).
- **Selection, corrected after a live bug catch:** FLEURS's `id` field is a **sentence id, not a unique row id** — verified empirically that 175/487 rows in this split share an `id` with another row (same sentence, different speaker recording). A first attempt at "sort by id, take first 30" silently collided clip_ids and overwrote 11 of 30 wav files before any provider read them (caught via a unique-id sanity check on the committed manifest, not assumed away). Fixed selection: first 30 **distinct** `id` values ascending, one row (lowest original dataset index) per id. `eval/asr/results/manifest.json` records the exact clip ids, reference text and durations used.
- **Normaliser** (`eval/asr/asr_eval/normalize.py`): lowercase, strip punctuation/quotes/brackets, collapse whitespace, NFC-normalise. Applied identically to every reference and every hypothesis before `jiwer.wer`.
- **Coverage gap, stated explicitly, not hidden:** Round A is clean, studio-quality read speech only — **0 Sheng/code-switched and 0 noisy/crowd clips**. This does NOT satisfy AT-0005-1 (`>=10` of each required). `results/manifest.json`'s `coverage_gap` field records this on every run.

### Provider endpoints and data-terms class
| Provider | Endpoint | Terms class |
|---|---|---|
| Gemini 2.5 Flash | Vertex AI `generateContent`, project `master-crossing-435409-r1`, region `us-central1` | **Vertex AI paid tier**, Google Cloud terms (no-train) — reached via `vertexai=True` in `google-genai`, never the public AI-Studio/unpaid endpoint. ADR-0005-compliant by construction. |
| GCP Chirp | Speech-to-Text v2 `recognize`, region `us-central1`, model `chirp_2` | Google Cloud STT v2, Cloud terms (no-train), paid per-use. |
| AWS Transcribe sw-KE | not invoked | n/a — scope cut, see below. |
| Whisper large-v3 | not invoked | n/a — scope cut, see below. |

**Correction to round-2's provider facts [V-OBSERVED, supersedes the `[V2-SECONDARY]` claim above]:** round 2 said "Google STT v2 Chirp 3 lists sw-KE (Preview)." Live-tested today against `master-crossing-435409-r1`: `chirp_3` returns `400 INVALID_ARGUMENT: model does not exist` in `us-central1`, `europe-west4`, and the `global` endpoint. **`chirp_2`** does accept language code `sw-KE` in `us-central1` (a recognizer was created and deleted there as a live check) and is what Round A actually used. Legacy `chirp` (v1-style) rejects `sw-KE` outright in `us-central1`. Chirp 3/sw-KE may exist for allowlisted projects or other regions, but was not reproducible here — re-check before relying on it.

**Auth note (operational, not a provider fact):** both Google SDK calls had to be pointed at explicit short-lived credentials from `gcloud auth print-access-token` (the active CLI account, `developer.ericgitangu@gmail.com`, authorized on this project) rather than this machine's `gcloud auth application-default` credentials, which are logged into a *different* Google account/quota project (`the.ace.guru@gmail.com` / `pawacloud-assessment`) and got `403 PERMISSION_DENIED` on both `aiplatform.endpoints.predict` and `speech.recognizers.create`. No global ADC config was changed; the fix is scoped to `eval/asr/asr_eval/providers/gemini_vertex.py::_gcloud_cli_credentials()`.

### Results table (live run, 2026-10-03)
| Provider | clips_ok | WER (full set) | median latency | est. cost | endpoint / terms |
|---|---|---|---|---|---|
| **gcp-stt-v2-chirp_2** | 30/30 | **7.8%** | 3.17s | $0.1720 | Cloud STT v2, paid, no-train |
| gemini-2.5-flash-vertex | 30/30 | 18.4% (range across 3 runs: 12.7–18.4%, LLM sampling is non-deterministic — temperature was not pinned) | 2.83s | $0.0066 | Vertex AI, paid, no-train |
| aws-transcribe-sw-ke | 0/30 | n/a | n/a | $0 | **skipped** |
| whisper-large-v3-local | 0/30 | n/a | n/a | $0 | **skipped** |

Mutual-success WER (all 30 clips succeeded for both live providers, so this equals the full-set number for each): Chirp 7.8%, Gemini 18.4%. No cherry-picking: both the full-set and mutual-success numbers are reported, and they're identical here because there were no failures on either provider.

**Total estimated spend across the whole Round A exercise (multiple harness runs while debugging the id-collision bug above): ~$0.55**, all on paid Vertex/Cloud endpoints. Single clean run: $0.1786. Both well under the $2 cap.

**Skips, with reasons (not silent):**
- **AWS Transcribe sw-KE:** `aws sts get-caller-identity` succeeded non-interactively (auth confirmed working), but the batch API's per-clip S3 upload/poll/fetch/cleanup round-trip exceeded the 15-minute plumbing budget set for this round. Scope cut, not a failure.
- **faster-whisper large-v3 (local anchor):** skipped to avoid the ~3GB model download plus CPU inference time on 30 clips within this round's time budget. This ADR already holds a published FLEURS sw_ke Whisper large-v3 number (31.0–32.4% WER, `[V]`) as the anchor.

### A finding worth flagging: Gemini silent empty-transcript on sensitive-but-legal content
Clip `fleurs_sw_ke_01671` (reference: *"...FBI lazima itoe makachero kumi kwa ponografia ya watu wazima"* — Bunge-committee language about FBI anti-pornography investigators, entirely legitimate policy speech) came back from Gemini as `ok: true`, **empty transcript**, 28.4s latency, no error surfaced. GCP Chirp transcribed the same clip correctly. This looks like a silent safety-filter drop on a legal-but-sensitive topic, not a transcription failure in the normal sense — and it is exactly the failure mode ADR-0005's "machine transcription invents or omits claims, which here is a defamation/omission hazard" language is about. **Risk for production:** a provider that silently returns nothing (rather than erroring) on politically sensitive Kenyan speech could cause real claims to vanish from the pipeline with no operator-visible signal. Recorded here as a provider-selection input, not yet mitigated; Round B should specifically include Bunge-style sensitive-topic clips to see if this reproduces.

### Provisional winner, per the gate, with caveats
**GCP STT v2 Chirp_2 is the provisional Round A winner** (7.8% WER vs Gemini's 18.4%, both far under the 25% disqualification gate). **Caveat, stated loudly: FLEURS is clean, studio-quality, single-sentence read speech.** It contains no Sheng, no code-switching, no crowd noise, and no live/compressed-stream artifacts — exactly the conditions ADR-0005's "no data on Sheng, code-switching or noisy livestream audio [GAP]" called out from day one. This result says nothing about performance on the content this product actually has to transcribe. Gemini's silent-empty-transcript behavior on sensitive content (above) is also a material input the WER number alone doesn't capture, and Gemini's non-deterministic output (temperature unpinned) makes its WER number noisier run-to-run than Chirp's.

**What Round B still requires (unchanged from before, now with a concrete harness to run it through):** >=10 Sheng/code-switched and >=10 noisy/crowd clips (Bunge, Citizen TV, creator TikTok), each with reference transcript + reference translation, scored through this same `eval/asr/` harness. Until Round B runs, the provider decision here is provisional, not locked.

### Acceptance test updates
- **AT-0005-1 stays RED.** `eval/asr/results/manifest.json`'s `coverage_gap` field explicitly records the Round A/B gap (0 Sheng/code-switched, 0 noisy clips) every run; `scripts/at/at-0005.sh` asserts this field is present rather than silently passing.
- **AT-0005-2 is NOT flipped to GREEN here.** A winner at 7.8% WER (<=25% gate) exists, but AT-0005-2 as written requires the noisy-subset number specifically, which Round A cannot produce (no noisy clips exist in FLEURS). This section records the clean-set numbers per the task; the row stays RED until Round B supplies a noisy-subset WER for the same provider.
- AT-0005-3 and AT-0005-4 are unaffected by this round and remain as before.

---
**See ADR-0031:** the custom-model roadmap (Sheng/Swahili STT fine-tune, claim/credibility classifiers) is the output of the data flywheel (checks + editor corrections + user signals → eval → fine-tune).

---
## Amendment (two-engine pivot, 2026-10-04) — STT now also powers the fetch engine, within the same compliance boundary

**Status:** Accepted direction (owner-approved pivot 2026-10-04). Additive; the provider gate (≤25% WER), the paid-tier-only rule (AT-0005-3), the Round A result (Chirp_2 provisional) and the two-tier triage/publication tolerance are all retained unchanged.

- **New consumer:** the autonomous **fetch engine** (ADR-0002/0032) transcribes video content via this same `Transcriber` interface — but **only on the compliant subset** already defined in Research round 2: owner-authorized/partner content, live-capture of permitted streams, our own uploads, and openly-licensed official audio (Bunge). **The ToS prohibition on downloading/isolating third-party YouTube/TikTok audio (ADR-0002 blockers #5/#8) binds the fetch engine exactly as it binds the submission engine.** The fetch engine does **not** expand the lawful STT input set — it expands *who triggers transcription* (a scheduler instead of a user), not *what may be transcribed*.
- **Autonomy sharpens the silent-empty-transcript risk** (the Round A Gemini finding on sensitive Bunge/FBI content): with no human in the submit loop, a provider silently returning an empty transcript on politically sensitive Kenyan speech could drop a real claim with no operator signal. This reinforces the Chirp_2-over-Gemini provisional call for the autonomous path and is a named fetch-engine input (ADR-0032 review trigger).
- **Paid-tier-only (AT-0005-3) still holds** — autonomous volume makes an accidental unpaid-tier call *more* likely, so the config/CI backstop (ADR-0023 AT-0005-3 backstop) is load-bearing for the fetch engine too.

### Acceptance tests (additive)
| ID | Behaviour | Status |
|---|---|---|
| AT-0005-5 | A fetch-engine video item triggers STT only when its source is in the compliant subset (owner-authorized/partner/open-licensed/live-capture); a third-party YouTube/TikTok item never triggers an audio download or transcription, hitting the `needs_quote` short-circuit instead. | RED |
