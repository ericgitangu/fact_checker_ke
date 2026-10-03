"""ADR-0006 signal #1: C2PA provenance checks.

Covers both the deterministic fake (used by default in hop wiring tests
elsewhere) and the real `C2paProvenanceChecker`, which is exercised here
against locally-generated image bytes only — no network call, no vendor
key, consistent with the task's HARD RULE on billable/live calls.
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.clients.provenance_c2pa import C2paProvenanceChecker
from app.fakes.fake_provenance import FakeProvenanceChecker
from app.protocols.provenance import ProvenanceCheckError


def _png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "blue").save(buf, format="PNG")
    return buf.getvalue()


def test_fake_provenance_checker_default_is_no_manifest() -> None:
    result = FakeProvenanceChecker().check(_png_bytes(), mime_type="image/png")
    assert result.present is False
    assert result.validated is False
    assert result.ai_generated is False


def test_fake_provenance_checker_ai_generated_marker() -> None:
    checker = FakeProvenanceChecker()
    media = checker._AI_GENERATED_MARKER + b"rest-of-bytes"
    result = checker.check(media, mime_type="image/png")
    assert result.present is True
    assert result.validated is True
    assert result.ai_generated is True


def test_fake_provenance_checker_valid_non_ai_marker() -> None:
    checker = FakeProvenanceChecker()
    media = checker._VALID_MARKER + b"rest-of-bytes"
    result = checker.check(media, mime_type="image/png")
    assert result.present is True
    assert result.ai_generated is False


def test_real_c2pa_checker_no_manifest_is_present_false_not_an_error() -> None:
    """Empirically verified (2026-10-03, local only): a freshly-created PNG
    with no embedded C2PA manifest raises c2pa.C2paError(ManifestNotFound)
    internally — this must be translated to present=False, never bubble up
    as an exception, since "no manifest" is the overwhelmingly common case
    (ADR-0006 evidence: screenshots/re-encodes strip C2PA data)."""
    checker = C2paProvenanceChecker()
    result = checker.check(_png_bytes(), mime_type="image/png")
    assert result.present is False
    assert result.validated is False
    assert result.ai_generated is False


def test_real_c2pa_checker_corrupt_bytes_raise_provenance_check_error() -> None:
    checker = C2paProvenanceChecker()
    with pytest.raises(ProvenanceCheckError):
        checker.check(b"not an image at all", mime_type="image/png")
