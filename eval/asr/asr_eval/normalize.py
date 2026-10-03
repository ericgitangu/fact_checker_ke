"""Single normaliser applied identically to every reference and every
hypothesis before WER is computed. Keeping exactly one normalisation path
(rather than per-provider tweaks) is what makes the WER numbers comparable
across providers — see docs/adr/0019 empirical-evidence rules.
"""
from __future__ import annotations

import re
import unicodedata

# Punctuation/symbols to strip. FLEURS references already have no punctuation
# in the `transcription` field, but provider hypotheses (Gemini, Chirp) do
# emit punctuation, so this must run on both sides.
_PUNCT_RE = re.compile(r"[.,!?;:\"'`‘’“”()\[\]{}«»\-–—/\\]")
_WS_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace, NFC-normalise.

    Deliberately simple and documented: no stemming, no stopword removal.
    Applied identically to reference and hypothesis for every provider.
    """
    if text is None:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = text.lower()
    text = _PUNCT_RE.sub(" ", text)
    text = _WS_RE.sub(" ", text).strip()
    return text
