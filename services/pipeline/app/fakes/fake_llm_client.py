from __future__ import annotations

from app.protocols.llm_client import LlmClient, LlmCompletionError


class FakeLlmClient(LlmClient):
    """Deterministic fake: never calls a real LLM vendor. Returns a fixed
    completion unless the prompt contains the literal string
    "TRIGGER_FAILURE", which exercises the failure path in tests."""

    async def complete(self, prompt: str, *, max_tokens: int = 1024) -> str:
        if "TRIGGER_FAILURE" in prompt:
            raise LlmCompletionError("Fake LLM client was asked to simulate a failure.")
        return f"[fake completion, max_tokens={max_tokens}] stubbed response for local dev"
