# ADR-0027: User media uploads

**Status:** Proposed · **Date:** 2026-10-03

## Problem
ADR-0002 (no third-party audio download) and ADR-0006 (deepfake detection) both fall back to "user uploads of media they hold the rights to share" with no ADR governing that path. Red-team E8/U4 flags this as the main gap: no storage decision, no rights check, no abuse (NCII/CSAM) handling, no retention rule, and no EXIF/GPS stripping — on a product that will receive protest photos and politician voice clips, the two highest-harm upload categories that exist.

## Evidence
- Google Cloud Storage object lifecycle rules support an `age` condition in whole days; the minimum granularity is 1 day, and a changed lifecycle config can take up to 24h to take effect **[V: cloud.google.com/storage/docs/managing-lifecycles]**. A strict sub-24h SLA needs an explicit delete call in addition to the lifecycle rule.
- GCS V4 signed URLs are scoped to one bucket, one object and one HTTP verb, so a signed PUT URL cannot be replayed to read or delete other objects; signed URLs can expire in minutes **[V: cloud.google.com/storage/docs/access-control/signed-urls]**. This supports direct-to-GCS upload with no proxy through Cloud Run.
- Google Cloud Vision SafeSearch gives adult/violence/racy likelihood scores; the first 1,000 units/month are free, then free-with-Label-Detection up to 5M units, else $1.50/1,000 standalone **[V: cloud.google.com/vision/pricing, docs.cloud.google.com/vision/docs/detecting-safe-search]**. SafeSearch is a general-explicit-content classifier, **not** a CSAM-specific detector **[I]**.
- PhotoDNA Cloud Service is free for vetted qualifying organisations (nonprofits, businesses, law enforcement) after an application/approval process, and matches against NCMEC's known-CSAM hash database — it catches re-shared known material, not novel content **[V: microsoft.com/en-us/photodna]**.
- StopNCII.org (SWGfL, in partnership with Meta, Google, TikTok, Reddit and others) offers a free, participating-platform hash-matching service for non-consensual intimate imagery, hashing on-device with PhotoDNA/PDQ (images) and MD5 (video); the user hashes locally, nothing is uploaded for the match **[V: swgfl.org.uk, stopncii.org/partners/join]**. It is a *preventative check against known reported NCII*, not a classifier for new abuse.
- Net: there is no single free tool that reliably flags novel CSAM/NCII pre-publication. **[GAP]** — human review before any upload reaches a public check page is therefore load-bearing, not a nice-to-have.

## Options
1. **No uploads; embed-only forever.** Simplest, but forecloses U4 (deepfake triage on WhatsApp/photo evidence) and the Maandamano advisory-photo use case entirely.
2. **Proxy uploads through `services/api`.** Simpler client code, but the Cloud Run container now buffers large files on the request-based CPU budget (ADR-0015/0016 C-5 concern) and becomes a single point that must be hardened for file-upload attacks.
3. **Signed direct-to-GCS upload, server only mediates the signed URL and post-upload scan.** Recommended.

## Decision (proposed): Option 3
- **Flow:** client requests an upload slot from `services/api` → API validates size/type/rate limit and rights attestation checkbox state → API returns a short-lived (≤10 min) V4 signed PUT URL scoped to one object key under `uploads/pending/{uuid}` → client PUTs directly to GCS → client confirms completion to the API, which enqueues a scan job (QStash, feeding ADR-0005/ADR-0006).
- **Rights attestation:** a required, logged checkbox ("I own this media or have the right to share it; it is not of a minor; I consent to its use for fact-checking") stored with the object's metadata row (user/session id, timestamp, IP hash) — this is the primary legal control, since automated screening is incomplete (see GAP above).
- **Limits:** 1 image ≤10 MB (JPEG/PNG/WebP) or 1 video ≤200 MB (MP4/MOV, ≤3 min) per upload; enforced both client-side (fast feedback) and server-side via signed-URL `Content-Length-Range` condition (authoritative).
- **EXIF/GPS strip:** mandatory server-side pass (e.g. `exiftool`/`sharp` strip) before the object leaves `uploads/pending/` for `uploads/scanned/`; GPS and device-identifying EXIF never reach a check page or an editor's export — this closes the C-8 "photo keeps EXIF GPS" edge case shared with ADR-0007.
- **Scanning, in order, before any human sees the raw file in a shared queue:** (1) Cloud Vision SafeSearch for adult/violence/racy triage **[V, cited]**; (2) StopNCII/PhotoDNA hash match against known NCII/CSAM where we qualify as a participating/vetted org — apply now, tracked as a GAP-closing task, not a launch blocker given low initial volume; (3) anything flagging on either signal, or any video with a visible minor plus any sexual context, is auto-quarantined (never shown to the general editor queue) and routed to the founder/advocate for an NCMEC CyberTipline report where applicable, never stored longer than required for that report.
- **Deletion:** GCS lifecycle rule `age: 1` (day) scoped to `uploads/**`, plus an explicit delete call from the pipeline once a derived artifact (transcript, detector score) is persisted and the raw media is no longer needed — relying on the lifecycle rule alone risks the documented up-to-24h propagation delay **[V, cited]**, so "24h deletion" means "deleted by the pipeline immediately after processing, with the lifecycle rule as a backstop," not "guaranteed gone at hour 24."
- **Never re-hosted:** scanned/cleared media feeds ADR-0005 (STT) and ADR-0006 (detector input) as transient processing input only; a published check links to the *original* platform post or displays only the derived transcript/detector verdict, never a re-hosted copy of the user's raw upload (mirrors the ADR-0002 "never re-host third-party video" rule, extended to first-party uploads).

## Trade-offs accepted
Direct-to-GCS upload adds a client-side upload SDK dependency and a signed-URL issuance endpoint instead of a single proxy route; accepted because it keeps large files off the request-based-CPU Cloud Run container (ADR-0015/0016). Automated CSAM/NCII screening is known-incomplete, so human judgment before wide release remains the real control — flagged explicitly, not silently assumed solved.

## Irreversible
Any image/video that reaches `uploads/scanned/` and is linked from a published check before deletion may already be cached by viewers' browsers or CDNs; the 24h-deletion promise covers our storage, not downstream caches.

## Review trigger
Revisit once upload volume justifies PhotoDNA/StopNCII application overhead, or after any NCII/CSAM false-negative incident.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0027-1 | An upload request with no rights-attestation flag set is rejected before a signed URL is issued | RED |
| AT-0027-2 | A signed PUT URL expires after 10 minutes and is scoped to exactly one object key; a second PUT to a different key with the same URL is rejected | RED |
| AT-0027-3 | Every object retrieved from `uploads/scanned/**` has no `GPS*` or camera-serial EXIF tags remaining | GREEN (pipeline-owned processing step; see Implementation notes — the `uploads/scanned/**` *bucket* lifecycle itself is infra/services/api, out of scope here) |
| AT-0027-4 | An object exceeding the per-type size/duration limit is rejected at the signed-URL `Content-Length-Range` condition, not only client-side | RED |
| AT-0027-5 | Any object in `uploads/**` older than 24h (by object creation time) is absent from a bucket listing in a scheduled soak test | RED |
| AT-0027-6 | A SafeSearch or hash-match flag on an uploaded object routes it to a quarantine queue distinct from the general editor review queue, and it never appears on a published check page | RED (pipeline's `AbuseScan` hash-match produces a `quarantined` flag — see Implementation notes — but queue routing/editor-UI separation is services/api + apps/web, out of scope here; still RED at the system level) |

## Implementation notes (services/pipeline media processing, 2026-10-03)

Implements the post-upload processing step this service owns (ADR-0027's
Decision section: "enqueues a scan job ... feeding ADR-0005/ADR-0006") —
NOT the signed-GCS-upload mechanics (Option 3's "Flow": signed URL
issuance, rights attestation, size/type limits), which stay a
services/api + apps/web concern.

`POST /hops/media-process` (`app/stages/media_processing.py:process_media`):

1. **EXIF/GPS strip (AT-0027-3)**: rebuilds a fresh Pillow `Image` from raw
   pixel data only (never re-saves the original with metadata merely
   omitted) so there is nothing left to carry forward — verified
   (`tests/test_media_processing.py`) against a fixture crafted with both
   a `GPSInfo` IFD and a `CameraSerialNumber` tag (via `piexif`, dev-only
   dependency), asserting both are gone post-strip via a dedicated
   `has_gps_or_camera_serial_exif` checker (not just "EXIF dict is empty",
   which could pass vacuously for an image with no EXIF to begin with).
2. **Content hash + perceptual hash**: sha256 (cryptographic identity) and
   a dependency-free 8x8-grayscale average-hash (near-duplicate
   fingerprint — not cryptographically secure, not a replacement for the
   content hash). Scope: `image/*` only in this change; video
   EXIF/perceptual-hash support needs a frame-extraction pipeline Pillow
   doesn't provide — documented gap (`MediaProcessingError` on a
   `video/*` mime type), not a silent mishandling.
3. **AbuseScan (CSAM/NCII)**: `app/protocols/abuse_scan.py` +
   `app/fakes/fake_abuse_scan.py` — a deterministic known-bad-hash-set
   match (PhotoDNA/StopNCII-shaped), no vendor credentials wired (HARD
   RULE). The module docstring states explicitly, every place it's
   referenced, that **this catches only previously-known material**: per
   this ADR's own evidence section, no free tool reliably detects novel
   CSAM/NCII, so human review before any upload reaches a shared queue
   remains the real, load-bearing control — never silently implied to be
   solved by this scan.

**Never re-hosted, enforced at the API boundary too**: `MediaProcessResult`
(the `/hops/media-process` response model) deliberately has no field for
the stripped bytes — only hashes and a `quarantined` flag. Returning
processed image bytes over this HTTP response would itself be a form of
re-serving the upload; downstream stages that need the stripped bytes
consume them in-process in the same stage chain, never via a round-trip
through this response. Verified: `tests/test_hops_media.py` asserts
`"stripped_bytes" not in body` and `"media_base64" not in body` on the
response.

**Deviations / tech debt (explicit, not buried):**
- Video media (EXIF/perceptual-hash) is out of scope — `process_media`
  raises `MediaProcessingError` on any non-`image/*` mime type rather than
  silently skipping steps.
- The AbuseScan Protocol's only implementation is a toy in-memory hash-set
  fake. A real PhotoDNA/StopNCII integration needs vetted-organization
  application/approval (this ADR's evidence section) — out of scope for
  this change, and intentionally not faked as if it were real detection.
- Signed-URL issuance, rights attestation, size/duration limits, GCS
  lifecycle rules, and quarantine-queue routing (AT-0027-1, -2, -4, -5,
  -6's queue-separation half) are services/api + infra concerns, left RED
  here per this change's file-ownership boundary
  (`services/pipeline/**` only).
