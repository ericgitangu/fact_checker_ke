"""Embedder selection by env, mirroring the LLM/FactCheck client factories.

Default is FakeEmbedder (deterministic, no model download) unless
PIPELINE_USE_REAL_EMBEDDER=1 is set, in which case FastEmbedEmbedder
(intfloat/multilingual-e5-small, see embedder_fastembed.py for the
justification) is used. This mirrors ANTHROPIC_API_KEY-gated selection for
the LLM client but is a separate flag rather than a key-presence check:
fastembed has no "key", just a one-time model download, so the explicit
opt-in flag keeps default `uv run pytest` / `uv sync` runs fast and
network-free (tech debt: real-embedder test coverage therefore only runs
when this flag is set; see docs/adr/0004's Implementation notes).
"""

from __future__ import annotations

import os

from app.protocols.embedder import Embedder


def make_embedder() -> Embedder:
    if os.environ.get("PIPELINE_USE_REAL_EMBEDDER") == "1":
        from app.clients.embedder_fastembed import FastEmbedEmbedder

        return FastEmbedEmbedder()
    from app.fakes.fake_embedder import FakeEmbedder

    return FakeEmbedder()
