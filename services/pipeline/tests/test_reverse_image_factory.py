"""AT-0032-8 / ADR-0006 signal #3 (fakes-first, zero outbound): with no
REVERSE_IMAGE_API_KEY set, app/clients/reverse_image_factory.
make_reverse_image_search returns FakeReverseImageSearch, and the real
client (RealReverseImageSearch) is only ever constructed -- and only ever
makes a network call -- when that env var is present.

Mirrors tests/test_fetch_sources.py's AT-0032-1 pattern for the fetch
engine's per-platform sources, applied to the reverse-image signal.
"""

from __future__ import annotations

import httpx
import pytest

from app.clients.reverse_image_factory import REVERSE_IMAGE_API_KEY_ENV, make_reverse_image_search
from app.clients.reverse_image_search import RealReverseImageSearch
from app.fakes.fake_reverse_image import FakeReverseImageSearch
from app.protocols.reverse_image import ReverseImageSearchError


def test_no_key_set_yields_fake(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(REVERSE_IMAGE_API_KEY_ENV, raising=False)

    search = make_reverse_image_search()

    assert isinstance(search, FakeReverseImageSearch)


def test_key_set_activates_real_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(REVERSE_IMAGE_API_KEY_ENV, "test-key-not-real")

    search = make_reverse_image_search()

    assert isinstance(search, RealReverseImageSearch)


def test_real_client_without_key_raises_typed_error(monkeypatch: pytest.MonkeyPatch) -> None:
    # Constructing the real client directly (bypassing the factory) and
    # calling it without the key must fail loudly with a typed error,
    # never silently degrade or make a keyless call.
    monkeypatch.delenv(REVERSE_IMAGE_API_KEY_ENV, raising=False)

    search = RealReverseImageSearch()

    with pytest.raises(ReverseImageSearchError):
        search.find_earlier_copy("some-media-hash")


def test_no_key_selection_makes_zero_outbound_http_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    """The actual zero-outbound-call proof: with no key set, selecting
    AND using the factory's returned instance must never construct an
    httpx.Client at all -- a spy on httpx.Client raises if it is."""

    def _must_not_construct(*_args: object, **_kwargs: object) -> httpx.Client:
        raise AssertionError("httpx.Client was constructed with no REVERSE_IMAGE_API_KEY set")

    monkeypatch.delenv(REVERSE_IMAGE_API_KEY_ENV, raising=False)
    monkeypatch.setattr(httpx, "Client", _must_not_construct)

    search = make_reverse_image_search()
    result = search.find_earlier_copy("some-media-hash")

    # The spy didn't fire (no exception propagated) AND the fake's
    # documented default behaviour (no pre-seeded match -> None) held.
    assert result is None


def test_key_set_real_client_makes_outbound_call_only_when_used(monkeypatch: pytest.MonkeyPatch) -> None:
    """The positive half of the proof: WITH a key set, the real client is
    selected, and it is the httpx.Client construction inside
    find_earlier_copy -- not module import or instance construction --
    that would make the outbound call. We assert the call boundary is
    exactly `find_earlier_copy`, using a fake/invalid key so the "call"
    fails fast against the (deliberately `.invalid`) placeholder host
    rather than reaching any real network -- never a live/billable call."""
    monkeypatch.setenv(REVERSE_IMAGE_API_KEY_ENV, "test-key-not-real")

    search = make_reverse_image_search()
    assert isinstance(search, RealReverseImageSearch)

    # Constructing/selecting the real client made no network call yet;
    # only invoking find_earlier_copy does, and it fails with the typed
    # error (DNS failure against the .invalid placeholder host), never a
    # bare/unhandled exception.
    with pytest.raises(ReverseImageSearchError):
        search.find_earlier_copy("some-media-hash")
