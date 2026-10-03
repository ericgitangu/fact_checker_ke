import pytest

from app.fakes.fake_abuse_scan import FakeAbuseScan
from app.fakes.fake_llm_client import FakeLlmClient
from app.fakes.fake_reverse_image import FakeReverseImageSearch
from app.protocols.llm_client import LlmCompletionError
from app.protocols.reverse_image import EarlierCopyMatch


async def test_fake_llm_client_happy_path() -> None:
    client = FakeLlmClient()
    result = await client.complete("summarize this")
    assert "stubbed response" in result


async def test_fake_llm_client_failure_mode() -> None:
    client = FakeLlmClient()
    with pytest.raises(LlmCompletionError):
        await client.complete("TRIGGER_FAILURE please")


def test_fake_reverse_image_search_default_no_match() -> None:
    search = FakeReverseImageSearch()
    assert search.find_earlier_copy("some-hash") is None


def test_fake_reverse_image_search_seeded_match() -> None:
    search = FakeReverseImageSearch()
    match = EarlierCopyMatch(source_url="https://example.com/x", found_at="2023-05-01")
    search.seed_match("some-hash", match)
    found = search.find_earlier_copy("some-hash")
    assert found is not None
    assert found.source_url == "https://example.com/x"


def test_fake_abuse_scan_no_match_by_default() -> None:
    scanner = FakeAbuseScan()
    result = scanner.scan("content-hash", "perceptual-hash")
    assert result.known_hash_match is False
    assert result.requires_quarantine is False


def test_fake_abuse_scan_known_hash_triggers_quarantine() -> None:
    scanner = FakeAbuseScan(known_bad_hashes=frozenset({"bad-hash"}))
    result = scanner.scan("bad-hash", "perceptual-hash")
    assert result.known_hash_match is True
    assert result.requires_quarantine is True
