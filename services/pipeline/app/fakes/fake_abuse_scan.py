from __future__ import annotations

from app.protocols.abuse_scan import AbuseScan, AbuseScanResult


class FakeAbuseScan(AbuseScan):
    """Deterministic local hash-set match, never a vendor call (no
    PhotoDNA/StopNCII credentials). Seeded with a small "known-bad" hash
    set for tests; defaults to empty (no match -> no quarantine)."""

    def __init__(self, known_bad_hashes: frozenset[str] | None = None) -> None:
        self._known_bad = known_bad_hashes or frozenset()

    def scan(self, content_hash: str, perceptual_hash: str) -> AbuseScanResult:
        match = content_hash in self._known_bad or perceptual_hash in self._known_bad
        return AbuseScanResult(known_hash_match=match, requires_quarantine=match)
