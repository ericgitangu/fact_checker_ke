"""ProvenanceChecker Protocol: structural typing boundary for C2PA content-
credentials reads (ADR-0006 signal #1, the highest-priority, highest-
confidence signal in the ADR's ordered signal list).

This Protocol is implemented by `app.clients.provenance_c2pa.C2paProvenanceChecker`
(a real, local-only read of embedded C2PA JUMBF manifests via the `c2pa`
python lib — no network call, no vendor key: parsing an already-downloaded
byte blob is not a "live vendor call" under the task's HARD RULES) and by
`app.fakes.fake_provenance.FakeProvenanceChecker` (deterministic, for tests
and default wiring). Call sites depend on this Protocol, never the concrete
class, so a future swap (e.g. a different C2PA binding) needs no call-site
change.
"""

from __future__ import annotations

from typing import Protocol


class ProvenanceCheckError(Exception):
    """Raised by ProvenanceChecker implementations for expected failure
    modes (unreadable bytes, unsupported mime type) — never for "no
    manifest found", which is a normal, valid result (see ProvenanceResult)."""


class ProvenanceResult:
    """Outcome of a C2PA manifest read.

    `present` is False for "no manifest found" (the common case — most
    reposted/screenshotted media carries none, per ADR-0006's evidence
    section) as well as for a manifest that failed validation; those two
    cases are distinguished by `validated` so callers never conflate
    "no C2PA data" with "C2PA data present but invalid/tampered".
    """

    __slots__ = ("ai_generated", "present", "validated")

    def __init__(self, *, present: bool, validated: bool, ai_generated: bool) -> None:
        self.present = present
        self.validated = validated
        self.ai_generated = ai_generated


class ProvenanceChecker(Protocol):
    def check(self, media_bytes: bytes, *, mime_type: str) -> ProvenanceResult:
        """Read an embedded C2PA manifest from `media_bytes`, if any.

        Must raise ProvenanceCheckError (not a bare exception) on an
        expected failure mode. Must NOT raise merely because no manifest is
        present — that is a normal `ProvenanceResult(present=False, ...)`.
        """
        ...
