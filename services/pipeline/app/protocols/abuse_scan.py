"""AbuseScan Protocol: structural typing boundary for the CSAM/NCII
pre-processing scan (ADR-0027 §"Scanning, in order").

**No free tool reliably detects novel CSAM/NCII** (ADR-0027's evidence
section: PhotoDNA/StopNCII only match *known, previously-hashed* material
via NCMEC/participating-platform databases; Cloud Vision SafeSearch is a
general explicit-content classifier, not CSAM-specific). This is the single
most load-bearing GAP in ADR-0027: **human review before any upload reaches
a shared/public queue stays the real control, not automated screening** —
this Protocol and its fake implementation exist to model the pipeline shape
(hash-match against a known-bad set, auto-quarantine on a hit) without
overstating what it can catch. Never claim or imply novel-content detection
in a docstring, label, or log line anywhere this Protocol is used.

No PhotoDNA/StopNCII vendor credentials are wired (HARD RULE: no billable/
live calls). The only implementation is
`app.fakes.fake_abuse_scan.FakeAbuseScan`, a deterministic local hash-set
match against a small in-memory "known-bad" hash set, seedable in tests.
"""

from __future__ import annotations

from typing import Protocol


class AbuseScanError(Exception):
    """Raised by AbuseScan implementations for expected failure modes
    (backend unavailable, corrupt bytes)."""


class AbuseScanResult:
    """`known_hash_match` is True only when the perceptual/cryptographic
    hash matches an entry in a known-bad hash set (PhotoDNA/StopNCII-style
    matching) — it is never a claim of novel-content classification. See
    this module's docstring GAP note."""

    __slots__ = ("known_hash_match", "requires_quarantine")

    def __init__(self, *, known_hash_match: bool, requires_quarantine: bool) -> None:
        self.known_hash_match = known_hash_match
        self.requires_quarantine = requires_quarantine


class AbuseScan(Protocol):
    def scan(self, content_hash: str, perceptual_hash: str) -> AbuseScanResult:
        """Check `content_hash`/`perceptual_hash` against a known-bad hash
        set (PhotoDNA/StopNCII-style matching only — see module docstring
        for what this does NOT catch).

        Must raise AbuseScanError (not a bare exception) on an expected
        failure mode.
        """
        ...
