"""Media processing stage (ADR-0027): the post-upload step this service
owns. The signed-GCS-upload mechanics (ADR-0027's "Flow" section: signed
PUT URL issuance, rights attestation, size/type limits) belong to
services/api + apps/web (out of scope, file-ownership boundary) — this
module processes a provided file's bytes once they've arrived, exactly the
handoff ADR-0027 describes: "enqueues a scan job ... feeding ADR-0005/
ADR-0006".

Responsibilities, in order (mirrors ADR-0027's "Scanning, in order" list,
steps 1-2, plus the EXIF/GPS strip step that sits before any scan result is
trusted):
  1. Strip EXIF/GPS (AT-0027-3: no GPS*/camera-serial tags survive).
  2. Compute a content hash (sha256, cryptographic identity) and a
     perceptual hash (average-hash over an 8x8 grayscale thumbnail — a
     simple, dependency-free near-duplicate fingerprint; NOT a
     cryptographically secure hash, used only for perceptual-match /
     reverse-image-adjacent lookups, never for content-identity checks).
  3. Run the AbuseScan Protocol (CSAM/NCII known-hash match — see
     app/protocols/abuse_scan.py's GAP note: this catches known material
     only, never novel content; human review stays load-bearing).

**Never re-host (ADR-0027's "Never re-hosted" rule):** this stage returns
derived data only (hashes, stripped bytes for *immediate downstream
processing*, scan verdict) — it has no write path to any public bucket, no
CDN, no persistent object store client. The stripped bytes it returns are
for the caller (ADR-0005 STT / ADR-0006 triage) to consume transiently;
nothing in this module persists them. Storage lifecycle (`uploads/pending`
-> `uploads/scanned`, the 24h deletion rule) is services/api + infra
territory (GCS lifecycle rules, signed URLs) — out of scope here.
"""

from __future__ import annotations

import hashlib
import io

from PIL import ExifTags, Image

from app.protocols.abuse_scan import AbuseScan, AbuseScanError

# EXIF tag ids whose presence would indicate the strip failed (GPS IFD
# pointer, plus the common camera-serial tag). Used only by the stage's own
# post-strip assertion / tests, never trusted as the strip mechanism itself
# (the strip works by never copying EXIF into the re-encoded image at all —
# see _strip_exif below).
_GPS_TAG_ID = next(k for k, v in ExifTags.TAGS.items() if v == "GPSInfo")


def has_gps_or_camera_serial_exif(image_bytes: bytes) -> bool:
    """AT-0027-3 helper: True if `image_bytes` carries a GPSInfo IFD or a
    camera body/lens serial-number tag. Used by tests to assert the strip
    actually removed the device-identifying fields the ADR calls out by
    name, not just "some EXIF got dropped"."""
    serial_tag_ids = {k for k, v in ExifTags.TAGS.items() if "SerialNumber" in v}
    image = Image.open(io.BytesIO(image_bytes))
    exif = image.getexif()
    if _GPS_TAG_ID in exif:
        return True
    return any(tag_id in exif for tag_id in serial_tag_ids)


class MediaProcessingError(Exception):
    """Raised for expected failure modes (unreadable/corrupt image bytes,
    unsupported format)."""


class MediaProcessingResult:
    __slots__ = (
        "content_hash",
        "exif_gps_stripped",
        "perceptual_hash",
        "quarantined",
        "stripped_bytes",
    )

    def __init__(
        self,
        *,
        content_hash: str,
        perceptual_hash: str,
        stripped_bytes: bytes,
        exif_gps_stripped: bool,
        quarantined: bool,
    ) -> None:
        self.content_hash = content_hash
        self.perceptual_hash = perceptual_hash
        self.stripped_bytes = stripped_bytes
        self.exif_gps_stripped = exif_gps_stripped
        self.quarantined = quarantined


def _strip_exif(image: Image.Image) -> Image.Image:
    """Return a copy of `image` with zero metadata, including EXIF/GPS.

    Rebuilding a new Image from raw pixel data (rather than re-saving with
    `exif=` omitted) is the reliable strip: Pillow's `Image.info` dict can
    carry forward EXIF/ICC/XMP blobs across a naive re-save for some
    formats, but a freshly constructed Image with only pixel data copied in
    has no `.info` at all — there is nothing to carry forward.
    """
    clean = Image.new(image.mode, image.size)
    clean.putdata(list(image.getdata()))
    return clean


def _average_hash(image: Image.Image, *, hash_size: int = 8) -> str:
    """Dependency-free perceptual hash: resize to hash_size x hash_size
    grayscale, threshold each pixel against the mean, pack into a hex
    string. Standard "average hash" (aHash) algorithm — a near-duplicate
    fingerprint, not a cryptographic hash; small edits (recompression,
    minor crops) usually keep most bits unchanged, unlike content_hash."""
    small = image.convert("L").resize((hash_size, hash_size), Image.Resampling.LANCZOS)
    pixels = list(small.getdata())
    mean = sum(pixels) / len(pixels)
    bits = "".join("1" if p >= mean else "0" for p in pixels)
    return f"{int(bits, 2):0{hash_size * hash_size // 4}x}"


def process_media(
    media_bytes: bytes,
    *,
    mime_type: str,
    abuse_scanner: AbuseScan,
) -> MediaProcessingResult:
    if not mime_type.startswith("image/"):
        # Video EXIF/perceptual-hash handling needs a different (frame-
        # extraction) pipeline than Pillow provides; scoped out explicitly
        # rather than silently mishandled. Tracked as tech debt: video
        # support is a documented gap, not a crash-on-unknown-input bug.
        raise MediaProcessingError(
            f"unsupported mime_type for media processing: {mime_type!r} "
            "(image/* only in this change; video EXIF/perceptual-hash "
            "support is tracked as tech debt, not implemented)"
        )
    try:
        image = Image.open(io.BytesIO(media_bytes))
        image.load()
    except Exception as exc:
        raise MediaProcessingError(f"could not decode media bytes: {exc}") from exc

    cleaned = _strip_exif(image)
    perceptual_hash = _average_hash(cleaned)

    out = io.BytesIO()
    save_format = image.format or "PNG"
    cleaned.save(out, format=save_format)
    stripped_bytes = out.getvalue()

    content_hash = hashlib.sha256(stripped_bytes).hexdigest()

    try:
        scan_result = abuse_scanner.scan(content_hash, perceptual_hash)
    except AbuseScanError as exc:
        raise MediaProcessingError(f"abuse scan failed: {exc}") from exc

    # Post-strip assertion (defense in depth, AT-0027-3): the cleaned image
    # must carry no EXIF at all — verified by Pillow exposing an empty
    # getexif() on the freshly constructed Image.
    exif_gps_stripped = len(cleaned.getexif()) == 0

    return MediaProcessingResult(
        content_hash=content_hash,
        perceptual_hash=perceptual_hash,
        stripped_bytes=stripped_bytes,
        exif_gps_stripped=exif_gps_stripped,
        quarantined=scan_result.requires_quarantine,
    )
