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

import os

from app.protocols.corroboration import Corroboration

GEMINI_API_KEY_ENV = "GEMINI_API_KEY"


def make_corroboration_client() -> Corroboration:
    if os.environ.get(GEMINI_API_KEY_ENV):
        from app.clients.corroboration_gemini import RealGeminiCorroboration

        return RealGeminiCorroboration()
    from app.fakes.fake_corroboration import FakeCorroboration

    return FakeCorroboration()


__all__ = ["GEMINI_API_KEY_ENV", "make_corroboration_client"]
