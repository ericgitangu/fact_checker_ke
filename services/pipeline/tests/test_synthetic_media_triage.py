"""AT-0006: the ADR-0006 label allowlist is enforced in code. These tests
assert both the positive behaviour (each signal produces its documented
label) and the negative invariant the acceptance test cares about most:
"deepfake" never appears anywhere in the output, including when a detector
score alone is the only signal that fired.
"""

from __future__ import annotations

import io

from PIL import Image

from app.fakes.fake_provenance import FakeProvenanceChecker
from app.fakes.fake_reverse_image import FakeReverseImageSearch
from app.fakes.fake_synthetic_media import FakeSyntheticMediaDetector
from app.protocols.reverse_image import EarlierCopyMatch
from app.stages.synthetic_media_triage import TriageLabel, run_synthetic_media_triage


def _png_bytes(fill: str = "green") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), fill).save(buf, format="PNG")
    return buf.getvalue()


def test_no_signal_label_has_no_deepfake_wording() -> None:
    media = _png_bytes()
    result = run_synthetic_media_triage(
        media,
        mime_type="image/png",
        media_hash="hash-1",
        provenance_checker=FakeProvenanceChecker(),
        reverse_image_search=FakeReverseImageSearch(),
        detector=FakeSyntheticMediaDetector(),
    )
    assert "deepfake" not in result.label.value.lower()


def test_ai_generated_c2pa_signal_wins_and_is_labelled_content_credentials() -> None:
    checker = FakeProvenanceChecker()
    media = checker._AI_GENERATED_MARKER + _png_bytes()
    result = run_synthetic_media_triage(
        media,
        mime_type="image/png",
        media_hash="hash-2",
        provenance_checker=checker,
        reverse_image_search=FakeReverseImageSearch(),
        detector=FakeSyntheticMediaDetector(),
    )
    assert result.label == TriageLabel.CONTENT_CREDENTIALS_AI_GENERATED
    assert "deepfake" not in result.label.value.lower()


def test_earlier_copy_signal_wins_over_detector_score() -> None:
    reverse_image = FakeReverseImageSearch()
    media_hash = "hash-3"
    reverse_image.seed_match(
        media_hash, EarlierCopyMatch(source_url="https://example.com/original", found_at="2024-01-01")
    )
    result = run_synthetic_media_triage(
        _png_bytes(),
        mime_type="image/png",
        media_hash=media_hash,
        provenance_checker=FakeProvenanceChecker(),
        reverse_image_search=reverse_image,
        detector=FakeSyntheticMediaDetector(),
    )
    assert result.label == TriageLabel.EARLIER_COPY_FOUND
    assert result.earlier_copy_source_url == "https://example.com/original"
    assert "deepfake" not in result.label.value.lower()


def test_detector_score_alone_never_produces_deepfake_label() -> None:
    """AT-0006's core assertion: scan a range of fixture bytes through the
    real triage orchestration with a real (fake-backed, but real
    orchestration code) detector-score path, and confirm the word
    "deepfake" is categorically absent from every possible label the
    enum can produce — not just the one this fixture happens to hit."""
    for label in TriageLabel:
        assert "deepfake" not in label.value.lower()

    # Drive several distinct byte payloads through the real score->label
    # mapping to also exercise the mid/high detector-score bands directly.
    for fill in ("red", "green", "blue", "yellow", "white", "black"):
        result = run_synthetic_media_triage(
            _png_bytes(fill),
            mime_type="image/png",
            media_hash=f"hash-{fill}",
            provenance_checker=FakeProvenanceChecker(),
            reverse_image_search=FakeReverseImageSearch(),
            detector=FakeSyntheticMediaDetector(),
        )
        assert result.label in (TriageLabel.NO_SIGNAL, TriageLabel.SYNTHETIC_MEDIA_SIGNALS_UNDER_REVIEW)
        assert "deepfake" not in result.label.value.lower()


def test_high_detector_score_label_is_hedged_under_review() -> None:
    """Force the detector-score branch deterministically: FakeSyntheticMediaDetector
    is a hash-derived heuristic, so search byte payloads for one that lands
    above DETECTOR_SIGNAL_THRESHOLD to exercise the SYNTHETIC_MEDIA_SIGNALS_UNDER_REVIEW
    branch specifically (not just NO_SIGNAL)."""
    detector = FakeSyntheticMediaDetector()
    found_high = False
    for i in range(200):
        media = _png_bytes() + str(i).encode()
        score = detector.score(media, mime_type="image/png")
        if score.score >= 0.6:
            found_high = True
            result = run_synthetic_media_triage(
                media,
                mime_type="image/png",
                media_hash=f"hash-{i}",
                provenance_checker=FakeProvenanceChecker(),
                reverse_image_search=FakeReverseImageSearch(),
                detector=detector,
            )
            assert result.label == TriageLabel.SYNTHETIC_MEDIA_SIGNALS_UNDER_REVIEW
            assert result.label.value == "synthetic-media signals — under review"
            break
    assert found_high, "expected at least one of 200 sampled payloads to score >= 0.6"
