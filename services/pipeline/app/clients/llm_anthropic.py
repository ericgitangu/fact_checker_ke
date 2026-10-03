"""Real LlmClient implementation: Anthropic SDK, with prompt-caching
headers for the static prefix and per-call usage capture (ADR-0011).

Model selection, env-overridable (ADR-0011 pricing table, 2026-10-03
resolution: Haiku 4.5 for claim detection, Sonnet 5.5 for draft verdicts):
  ANTHROPIC_HAIKU_MODEL   default "claude-haiku-4-5"
  ANTHROPIC_SONNET_MODEL  default "claude-sonnet-5-5"

Prompt caching (ADR-0011 round-2 pricing): the static prefix of a prompt
(injection-containment system instruction + schema description) is marked
`cache_control: {"type": "ephemeral"}` so repeated calls within the TTL pay
the 0.1x cache-read rate on that prefix rather than full input price. The
untrusted/dynamic suffix (submission, retrieved sources, claim text) is
never cached, since it differs per call.
"""

from __future__ import annotations

import os
from typing import Any

from app.models.pipeline_io import UsageRecord
from app.protocols.llm_client import LlmClient, LlmCompletionError

_HAIKU_MODEL_ENV = "ANTHROPIC_HAIKU_MODEL"
_SONNET_MODEL_ENV = "ANTHROPIC_SONNET_MODEL"
_DEFAULT_HAIKU_MODEL = "claude-haiku-4-5"
_DEFAULT_SONNET_MODEL = "claude-sonnet-5-5"

# ADR-0011 round-2 pricing ($ per MTok, in/out). Opus/Fable intentionally
# omitted: not routed to by this pipeline (ADR-0011 tiered routing).
_PRICING_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    _DEFAULT_HAIKU_MODEL: (1.0, 5.0),
    _DEFAULT_SONNET_MODEL: (2.0, 10.0),
}


def _estimate_usd(model: str, *, input_tokens: int, cached_tokens: int, output_tokens: int) -> float:
    in_price, out_price = _PRICING_USD_PER_MTOK.get(model, (2.0, 10.0))
    # Cache reads are priced at 0.1x input (ADR-0011 round-2 table);
    # uncached input tokens are the remainder.
    uncached_input = max(0, input_tokens - cached_tokens)
    cost = (
        (uncached_input / 1_000_000) * in_price
        + (cached_tokens / 1_000_000) * (in_price * 0.1)
        + (output_tokens / 1_000_000) * out_price
    )
    return round(cost, 6)


class AnthropicClient(LlmClient):
    """Thin wrapper over `anthropic.AsyncAnthropic`. Lazily imports and
    constructs the SDK client so importing this module never requires
    ANTHROPIC_API_KEY to be set (only calling `complete`/`complete_with_usage`
    does)."""

    def __init__(self, *, model: str | None = None, is_sonnet: bool = False) -> None:
        self._model = model or (
            os.environ.get(_SONNET_MODEL_ENV, _DEFAULT_SONNET_MODEL)
            if is_sonnet
            else os.environ.get(_HAIKU_MODEL_ENV, _DEFAULT_HAIKU_MODEL)
        )
        self._client: Any = None

    def _ensure_client(self) -> Any:
        if self._client is None:
            try:
                from anthropic import AsyncAnthropic
            except ImportError as exc:  # pragma: no cover
                raise LlmCompletionError(
                    "anthropic SDK is not installed; add it to pyproject.toml dependencies"
                ) from exc
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                raise LlmCompletionError(
                    "ANTHROPIC_API_KEY is not set; use FakeLlmClient in dev/test"
                )
            self._client = AsyncAnthropic(api_key=api_key)
        return self._client

    async def complete(self, prompt: str, *, max_tokens: int = 1024) -> str:
        text, _usage = await self.complete_with_usage(prompt, stage="unspecified", max_tokens=max_tokens)
        return text

    async def complete_with_usage(
        self, prompt: str, *, stage: str, max_tokens: int = 1024
    ) -> tuple[str, UsageRecord]:
        client = self._ensure_client()
        # Static prefix (everything up to the first untrusted tag) is
        # marked cacheable; the rest is sent as a second, uncached block.
        # No tool access is granted (ADR-0023 §1): `tools=` is omitted.
        split_at = prompt.find("<untrusted_")
        static_prefix = prompt if split_at == -1 else prompt[:split_at]
        dynamic_suffix = "" if split_at == -1 else prompt[split_at:]

        content_blocks: list[dict[str, Any]] = [
            {"type": "text", "text": static_prefix, "cache_control": {"type": "ephemeral"}}
        ]
        if dynamic_suffix:
            content_blocks.append({"type": "text", "text": dynamic_suffix})

        try:
            response = await client.messages.create(
                model=self._model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": content_blocks}],
            )
        except Exception as exc:  # Anthropic SDK raises its own exception
            # hierarchy (APIError, RateLimitError, APITimeoutError, ...);
            # we normalize all of them to the typed LlmCompletionError so
            # callers never need to import the Anthropic SDK's exceptions.
            raise LlmCompletionError(f"Anthropic API call failed: {exc}") from exc

        text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text")
        usage = response.usage
        input_tokens = getattr(usage, "input_tokens", 0) or 0
        cached_tokens = getattr(usage, "cache_read_input_tokens", 0) or 0
        output_tokens = getattr(usage, "output_tokens", 0) or 0
        usage_record = UsageRecord(
            stage=stage,
            model=self._model,
            input_tokens=input_tokens,
            cached_tokens=cached_tokens,
            output_tokens=output_tokens,
            usd=_estimate_usd(
                self._model,
                input_tokens=input_tokens,
                cached_tokens=cached_tokens,
                output_tokens=output_tokens,
            ),
        )
        return text, usage_record


def make_llm_client(*, is_sonnet: bool = False) -> LlmClient:
    """Selection by env: a real ANTHROPIC_API_KEY picks AnthropicClient,
    otherwise the deterministic FakeLlmClient. is_sonnet picks the
    Sonnet-5.5-class model for draft-verdict calls vs. the Haiku-4.5-class
    model for analyze calls (ADR-0011 tiered routing)."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return AnthropicClient(is_sonnet=is_sonnet)
    from app.fakes.fake_llm_client import FakeLlmClient

    return FakeLlmClient()
