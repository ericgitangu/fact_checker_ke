import pytest

from app.fakes.fake_llm_client import FakeLlmClient
from app.protocols.llm_client import LlmCompletionError


async def test_fake_llm_client_happy_path() -> None:
    client = FakeLlmClient()
    result = await client.complete("summarize this")
    assert "stubbed response" in result


async def test_fake_llm_client_failure_mode() -> None:
    client = FakeLlmClient()
    with pytest.raises(LlmCompletionError):
        await client.complete("TRIGGER_FAILURE please")
