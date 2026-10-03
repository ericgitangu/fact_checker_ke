"""ADR-0027: EXIF/GPS strip, content/perceptual hash, abuse-scan gating.

AT-0027-3 (pipeline-owned slice): every processed object has no GPS*/
camera-serial EXIF tags remaining.
"""

from __future__ import annotations

import io

import piexif
import pytest
from PIL import Image

from app.fakes.fake_abuse_scan import FakeAbuseScan
from app.stages.media_processing import (
    MediaProcessingError,
    has_gps_or_camera_serial_exif,
    process_media,
)


def _jpeg_with_gps_exif() -> bytes:
    gps_ifd = {
        piexif.GPSIFD.GPSLatitudeRef: "N",
        piexif.GPSIFD.GPSLatitude: ((1, 1), (2, 1), (3, 1)),
    }
    zeroth_ifd = {piexif.ImageIFD.CameraSerialNumber: "SN123456"}
    exif_bytes = piexif.dump({"0th": zeroth_ifd, "GPS": gps_ifd})
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), "red").save(buf, format="JPEG", exif=exif_bytes)
    return buf.getvalue()


def test_input_fixture_actually_carries_gps_and_serial_exif() -> None:
    """Sanity check on the test fixture itself: if this fails, the "strip"
    assertions below would be vacuously true."""
    assert has_gps_or_camera_serial_exif(_jpeg_with_gps_exif()) is True


def test_process_media_strips_gps_and_camera_serial_exif_at_0027_3() -> None:
    result = process_media(_jpeg_with_gps_exif(), mime_type="image/jpeg", abuse_scanner=FakeAbuseScan())
    assert result.exif_gps_stripped is True
    assert has_gps_or_camera_serial_exif(result.stripped_bytes) is False


def test_process_media_content_hash_is_deterministic_sha256() -> None:
    media = _jpeg_with_gps_exif()
    r1 = process_media(media, mime_type="image/jpeg", abuse_scanner=FakeAbuseScan())
    r2 = process_media(media, mime_type="image/jpeg", abuse_scanner=FakeAbuseScan())
    assert r1.content_hash == r2.content_hash
    assert len(r1.content_hash) == 64  # hex sha256


def test_process_media_perceptual_hash_is_stable_across_identical_input() -> None:
    media = _jpeg_with_gps_exif()
    r1 = process_media(media, mime_type="image/jpeg", abuse_scanner=FakeAbuseScan())
    r2 = process_media(media, mime_type="image/jpeg", abuse_scanner=FakeAbuseScan())
    assert r1.perceptual_hash == r2.perceptual_hash


def test_process_media_quarantines_on_known_hash_match() -> None:
    media = _jpeg_with_gps_exif()
    # First pass with no seeded match to learn the real content_hash.
    baseline = process_media(media, mime_type="image/jpeg", abuse_scanner=FakeAbuseScan())
    scanner = FakeAbuseScan(known_bad_hashes=frozenset({baseline.content_hash}))
    result = process_media(media, mime_type="image/jpeg", abuse_scanner=scanner)
    assert result.quarantined is True


def test_process_media_rejects_corrupt_bytes() -> None:
    with pytest.raises(MediaProcessingError):
        process_media(b"not an image", mime_type="image/jpeg", abuse_scanner=FakeAbuseScan())


def test_process_media_rejects_non_image_mime_type_as_documented_gap() -> None:
    with pytest.raises(MediaProcessingError):
        process_media(b"whatever", mime_type="video/mp4", abuse_scanner=FakeAbuseScan())
