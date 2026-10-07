"""Corroboration client selection by env, mirroring
make_reverse_image_search / make_fetch_sources: a real GEMINI_API_KEY picks the
real grounded client, otherwise the deterministic FakeCorroboration.

Importing this module makes no network call and does NOT import the google-genai
SDK; only a constructed RealGeminiCorroboration touches it, and it is only ever
constructed when GEMINI_API_KEY is present (ADR-0036 activate-on-keys). Shipping
without the key is a pure no-op: Fake -> stage fails closed -> no_second_opinion
-> zero effect on the publish decision.
"""

from __future__ import annotations

import logging
import os

from app.protocols.corroboration import Corroboration

GEMINI_API_KEY_ENV = "GEMINI_API_KEY"
VERTEX_ENV = "GOOGLE_GENAI_USE_VERTEXAI"

_logger = logging.getLogger(__name__)


def _vertex_enabled() -> bool:
    return os.environ.get(VERTEX_ENV, "").strip().lower() == "true"


def make_corroboration_client() -> Corroboration:
    # Activate the real client on EITHER a Gemini Developer API key OR the Vertex
    # flag (GCP-native, authed by the Cloud Run SA via ADC — no raw key). If the
    # real client can't be constructed (SDK missing, misconfig), degrade to the
    # Fake so the pipeline still boots and the verify hop fails closed to
    # no_second_opinion — activation must never take the service down.
    if os.environ.get(GEMINI_API_KEY_ENV) or _vertex_enabled():
        try:
            from app.clients.corroboration_gemini import RealGeminiCorroboration

            return RealGeminiCorroboration()
        except Exception:
            _logger.warning("corroboration: real client unavailable, falling back to Fake", exc_info=True)

    from app.fakes.fake_corroboration import FakeCorroboration

    return FakeCorroboration()


__all__ = ["GEMINI_API_KEY_ENV", "VERTEX_ENV", "make_corroboration_client"]
