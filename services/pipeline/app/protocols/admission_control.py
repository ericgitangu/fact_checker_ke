"""AdmissionControl Protocol: the rate/dedup pre-check contract ADR-0023 §4
says sits in front of QStash/the LLM call chain.

Turnstile verification itself (AT-0023-5) is owned by services/api's
submission endpoint — out of scope for services/pipeline/** (see
docs/adr/0023's Implementation notes). What *is* in scope here is defining
the **interface** the API will call so both sides can develop against a
typed contract instead of an ad-hoc dict: a pre-check that takes a
submission fingerprint (session/device id, IP-hash ceiling, claim-text
hash) and returns an admit/reject decision with a reason, BEFORE any
QStash enqueue or LLM spend happens.

This module defines the Protocol and a deterministic in-memory reference
implementation (`InMemoryAdmissionControl`) suitable for pipeline-side
tests and local dev; it is not wired into any FastAPI route in this
service (admission control runs in services/api, ahead of the pipeline),
but is exported so services/api can depend on the same typed contract
once packages/core or a shared contracts package re-exports it (wave-2
integration concern, same pattern as app/models/hop_requests.py's
TEMPORARY note).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class AdmissionRequest:
    """Fingerprint of an inbound submission, pre-QStash/pre-LLM."""

    session_or_device_id: str
    ip_hash: str
    claim_text_hash: str


@dataclass(frozen=True)
class AdmissionDecision:
    admitted: bool
    reason: str
    # True when the rejection was a dedup hit (an identical claim_text_hash
    # was already admitted recently) rather than a rate-limit rejection —
    # ADR-0023 §4: "dedup hits keep returning instantly" even once a
    # session/device is otherwise rate-limited, so the API layer can still
    # serve a cached result during a degraded/breaker-tripped window.
    is_dedup_hit: bool = False


class AdmissionControl(Protocol):
    def check(self, request: AdmissionRequest) -> AdmissionDecision:
        """Return an admit/reject decision for `request`. Must be callable
        before any QStash enqueue or LLM API call — a rejected request must
        produce neither (AT-0023-5, enforced on the services/api side)."""
        ...


class InMemoryAdmissionControl:
    """Deterministic in-memory reference implementation: a per-
    session/device sliding window count plus a claim_text_hash dedup set.
    Process-lifetime only (same tech-debt class as InMemoryIdempotencyStore/
    InMemoryCheckStore) — a real deployment needs a shared store (Upstash
    Redis, per ADR-0009/0011) since this service scales to zero between
    requests and admission control must survive across instances."""

    def __init__(self, *, max_per_session: int = 20) -> None:
        self._max_per_session = max_per_session
        self._session_counts: dict[str, int] = {}
        self._seen_claim_hashes: set[str] = set()

    def check(self, request: AdmissionRequest) -> AdmissionDecision:
        if request.claim_text_hash in self._seen_claim_hashes:
            return AdmissionDecision(admitted=True, reason="dedup hit", is_dedup_hit=True)
        count = self._session_counts.get(request.session_or_device_id, 0)
        if count >= self._max_per_session:
            return AdmissionDecision(
                admitted=False,
                reason=f"session/device {request.session_or_device_id!r} exceeded "
                f"{self._max_per_session} submissions in window",
            )
        self._session_counts[request.session_or_device_id] = count + 1
        self._seen_claim_hashes.add(request.claim_text_hash)
        return AdmissionDecision(admitted=True, reason="admitted")
