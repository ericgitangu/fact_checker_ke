"""Transcriber selection by env, mirroring make_corroboration_client: the real
GCP Speech-to-Text v2 Chirp_2 backend activates ONLY when SUBMISSION_STT_ENABLED
is true AND GOOGLE_CLOUD_PROJECT is set (activate-on-config, ADR-0005); otherwise
the deterministic FakeTranscriber.

Importing this module makes no network call and does NOT import the
google-cloud-speech SDK; only a constructed RealChirp2Transcriber touches it
(lazy import inside its __init__), and it is only ever constructed on the
activate path. Shipping with SUBMISSION_STT_ENABLED unset (the default) is a pure
no-op: Fake -> the STT compliance gate (app/stages/stt_gate.py) still never
fabricates a transcript, and no real vendor call is ever made.

Note on the compliance fence: the flag here is a SECOND, independent gate on top
of the stt_gate's `stt_eligible` check — this never widens what may be
transcribed, it only decides whether the real backend is wired at all.
"""

from __future__ import annotations

import logging
import os

from app.protocols.transcriber import Transcriber
from app.stores.engine_breaker import EngineCostBreaker

STT_ENABLED_ENV = "SUBMISSION_STT_ENABLED"
PROJECT_ENV = "GOOGLE_CLOUD_PROJECT"

_logger = logging.getLogger(__name__)


def _stt_enabled() -> bool:
    return os.environ.get(STT_ENABLED_ENV, "").strip().lower() == "true"


def make_transcriber(*, breaker: EngineCostBreaker | None = None) -> Transcriber:
    # Activate the real Chirp_2 backend only when EXPLICITLY enabled AND a project
    # is configured for ADC. If the real client can't be constructed (SDK
    # missing, misconfig), degrade to the Fake so the pipeline still boots and the
    # STT gate still fails closed — activation must never take the service down.
    # The breaker is threaded in so the real client can meter the dedicated "stt"
    # daily-spend lane (the Transcriber protocol's transcribe(audio_url) carries
    # no breaker, so it is held on the instance).
    if _stt_enabled() and os.environ.get(PROJECT_ENV):
        try:
            from app.clients.transcriber_chirp2 import RealChirp2Transcriber

            return RealChirp2Transcriber(breaker=breaker)
        except Exception:
            _logger.warning("stt: real transcriber unavailable, falling back to Fake", exc_info=True)

    from app.fakes.fake_transcriber import FakeTranscriber

    return FakeTranscriber()


__all__ = ["PROJECT_ENV", "STT_ENABLED_ENV", "make_transcriber"]
