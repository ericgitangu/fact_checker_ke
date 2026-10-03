from __future__ import annotations

from app.protocols.provenance import ProvenanceChecker, ProvenanceResult


class FakeProvenanceChecker(ProvenanceChecker):
    """Deterministic fake: never reads real bytes. Returns "no manifest"
    unless `media_bytes` starts with one of two fixed sentinel markers used
    only in tests, so tests can exercise all three ProvenanceResult shapes
    without a real C2PA-embedded file."""

    _AI_GENERATED_MARKER = b"__FAKE_C2PA_AI_GENERATED__"
    _VALID_MARKER = b"__FAKE_C2PA_VALID__"

    def check(self, media_bytes: bytes, *, mime_type: str) -> ProvenanceResult:
        if media_bytes.startswith(self._AI_GENERATED_MARKER):
            return ProvenanceResult(present=True, validated=True, ai_generated=True)
        if media_bytes.startswith(self._VALID_MARKER):
            return ProvenanceResult(present=True, validated=True, ai_generated=False)
        return ProvenanceResult(present=False, validated=False, ai_generated=False)
