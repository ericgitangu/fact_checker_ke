"""LLM client Protocol: structural typing boundary for claim extraction and
drafting. A real implementation (AnthropicClient, app/clients/llm_anthropic.py)
now exists alongside the deterministic FakeLlmClient; selection is by env
(see app/clients/llm_anthropic.py:make_llm_client).
"""

from __future__ import annotations

from typing import Protocol

from app.models.pipeline_io import UsageRecord


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

    async def complete_with_usage(
        self, prompt: str, *, stage: str, max_tokens: int = 1024
    ) -> tuple[str, UsageRecord]:
        """Like `complete`, but also returns per-call cost telemetry
        (ADR-0011 §7): `{stage, model, input_tokens, cached_tokens,
        output_tokens, usd}`. `stage` is the caller-supplied pipeline stage
        name (e.g. "analyze", "verify") for the telemetry record.
        """
        ...
