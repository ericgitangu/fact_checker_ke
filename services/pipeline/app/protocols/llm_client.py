"""LLM client Protocol: structural typing boundary for claim extraction and
drafting. Only a fake implementation exists in this skeleton — no real API
calls, no keys read or required. A real implementation (Anthropic, etc.)
is a follow-up, gated behind ANTHROPIC_API_KEY being present and valid.
"""

from __future__ import annotations

from typing import Protocol


class LlmCompletionError(Exception):
    """Raised by LlmClient implementations for expected failure modes
    (rate limit, invalid response schema, timeout)."""


class LlmClient(Protocol):
    async def complete(self, prompt: str, *, max_tokens: int = 1024) -> str:
        """Return a text completion for `prompt`.

        Must raise LlmCompletionError (not a bare exception) on an expected
        failure mode.
        """
        ...
