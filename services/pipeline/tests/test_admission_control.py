"""ADR-0023 section4: admission-control contract (rate/dedup pre-check)
the API will call ahead of any QStash enqueue / LLM spend. Turnstile
itself is services/api's concern (AT-0023-5, out of scope here) — this
tests the typed interface and its reference in-memory implementation."""

from __future__ import annotations

from app.protocols.admission_control import AdmissionRequest, InMemoryAdmissionControl


def test_first_submission_is_admitted() -> None:
    gate = InMemoryAdmissionControl()
    decision = gate.check(AdmissionRequest(session_or_device_id="dev-1", ip_hash="ip-1", claim_text_hash="c-1"))
    assert decision.admitted is True
    assert decision.is_dedup_hit is False


def test_duplicate_claim_text_hash_is_a_dedup_hit_not_a_rate_limit_rejection() -> None:
    gate = InMemoryAdmissionControl()
    gate.check(AdmissionRequest(session_or_device_id="dev-1", ip_hash="ip-1", claim_text_hash="c-1"))
    decision = gate.check(AdmissionRequest(session_or_device_id="dev-2", ip_hash="ip-2", claim_text_hash="c-1"))
    assert decision.admitted is True
    assert decision.is_dedup_hit is True


def test_session_exceeding_max_is_rejected() -> None:
    gate = InMemoryAdmissionControl(max_per_session=2)
    gate.check(AdmissionRequest(session_or_device_id="dev-1", ip_hash="ip-1", claim_text_hash="c-1"))
    gate.check(AdmissionRequest(session_or_device_id="dev-1", ip_hash="ip-1", claim_text_hash="c-2"))
    decision = gate.check(AdmissionRequest(session_or_device_id="dev-1", ip_hash="ip-1", claim_text_hash="c-3"))
    assert decision.admitted is False
    assert decision.is_dedup_hit is False


def test_dedup_hit_still_admits_even_once_session_is_otherwise_rate_limited() -> None:
    """ADR-0023 section4: 'dedup hits keep returning instantly' even during
    a degraded window — a repeat of an already-admitted claim_text_hash
    must not be blocked by the session's own rate limit."""
    gate = InMemoryAdmissionControl(max_per_session=1)
    gate.check(AdmissionRequest(session_or_device_id="dev-1", ip_hash="ip-1", claim_text_hash="c-1"))
    # dev-1 is now at its cap, but a *different* session repeating the same
    # claim text should still get the dedup-hit fast path.
    decision = gate.check(AdmissionRequest(session_or_device_id="dev-2", ip_hash="ip-2", claim_text_hash="c-1"))
    assert decision.admitted is True
    assert decision.is_dedup_hit is True
