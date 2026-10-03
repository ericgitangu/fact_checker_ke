# ADR-0006: Synthetic media and deepfake handling — provenance first, detectors as triage

**Status:** Proposed · **Date:** 2026-10-03

## Problem
The brief asks us to flag unattributed AI-generated content and deepfakes. A false "deepfake" label on a real video of a politician, or a false "authentic" label on a fake, is the highest-impact error the product can make.

## Evidence
- On real-world 2024 deepfakes, open-source state-of-the-art detectors lose about half their AUC (video 50%, audio 48%, image 45%). Their AUCs land around 0.43-0.63, close to chance **[V]**.
- Commercial detectors and detectors fine-tuned on in-the-wild data do better (best AUC: video 0.79, audio 0.93, image 0.90) but still fall short of human forensic analysts **[V]**.
- C2PA metadata gets stripped by screenshots and most re-encoding, so reposted social media mostly carries none **[U]**. It can be checked client-side for free with WASM **[U]**.
- SynthID detection is proprietary, and the Detector is waitlist-only for journalists and researchers **[U]**. A missing watermark does not prove content is authentic **[U]**.
- AWS Rekognition and GCP Vision/Video Intelligence are **not deepfake detectors** and were not evaluated **[GAP]**. The brief's "Rekognition vs GCP" choice is the wrong question **[I]**.

## Decision (proposed)
- **Signals, in order:**
  1. C2PA manifest present or valid
  2. SynthID, if we get journalist access (apply now)
  3. reverse-image and keyframe search for earlier copies (often the strongest real-world evidence)
  4. detector score from one commercial or fine-tuned audio detector (audio gave the best AUC **[V]**)
  5. human forensic review
- **Labels allowed:** "Content credentials: AI-generated (per C2PA)", "Earlier copy found: <date/source>", "Synthetic-media signals detected — under review".
- **"Deepfake" is never shown on detector output alone.**
- Rekognition and Vision are used only for utility jobs such as keyframe OCR, face count and safe-search on uploads, not for authenticity.

## Trade-offs accepted
Slower and less "magical" than an instant deepfake meter, but defensible.

## Review trigger
Revisit if an independent benchmark shows a detector above 0.95 AUC in the wild on African-language audio or video.

---
## Research round 2 (2026-10-03): amendments for grooming

- **Neither cloud vendor has a deepfake-detection API.** AWS Rekognition only offers Face Liveness, which is identity-verification anti-spoofing and not content classification. **Google Cloud Video Intelligence is deprecated (Sept 2026) and shuts down in Sept 2027** **[V2-SECONDARY]**. The brief's "Rekognition vs GCP" question is closed: neither one. Don't build on Video Intelligence at all.
- Detector vendors (Reality Defender, Hive, etc.) are commercial and not evaluated. Pricing is **[GAP]**.
- C2PA libraries: **c2pa-rs is MIT or Apache-2.0, c2pa-js is MIT** **[V2-SECONDARY]**. They are commercially usable for the client-side provenance check.
- C2PA support by platform **[V2-SECONDARY, not confirmed on c2pa.org]**:
  - TikTok reads and attaches Content Credentials, and joined the C2PA steering committee (Jul 2026).
  - Instagram reads them but strips them on processing.
  - YouTube video credentials are not fully shipped.
- SynthID Detector is a waitlist portal (reported 1-2 week review). There is no public API **[V2-SECONDARY]**. Apply now as a journalist or researcher.

## Red-team amendments (2026-10-03)

Source: fact_checker_ke ADR set red-team report, Section D #14 (medium severity).

- **Detection applies only to user uploads or owner-authorized media.** Signal #4 (detector score) needs media bytes, and ADR-0002's accepted decision forbids fetching audio/video from third-party YouTube/TikTok (red-team contradiction: signal #4 vs ADR-0002). In practice, detector-based triage only runs on content the user uploaded or that an owner authorized — this scopes U4 (deepfakes) to "upload-only until a licensed media path exists."
- **Uploads are deleted within 24h after analysis**, are scanned for NCII/CSAM before processing, and are never re-hosted. This is a stopgap pending a dedicated media-uploads ADR (see README pointer list, "User media uploads"); it does not replace that future ADR's full intake/consent/retention design.
