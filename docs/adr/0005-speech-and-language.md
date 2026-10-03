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
