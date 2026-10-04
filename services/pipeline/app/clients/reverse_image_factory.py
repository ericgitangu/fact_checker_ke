"""ReverseImageSearch selection by env, mirroring make_llm_client /
make_fetch_sources / make_provenance_checker: a real credential picks the
real client, otherwise the deterministic FakeReverseImageSearch.

Importing this module makes no network call; only `find_earlier_copy()`
on a constructed RealReverseImageSearch does, and RealReverseImageSearch
is only ever constructed when REVERSE_IMAGE_API_KEY is present -- this
factory never constructs it unless that env var is set (mirrors AT-0032-1
for the fetch sources, applied to the reverse-image signal: ADR-0032
AT-0032-8 / ADR-0006 signal #3).
"""

from __future__ import annotations

import os

from app.protocols.reverse_image import ReverseImageSearch

REVERSE_IMAGE_API_KEY_ENV = "REVERSE_IMAGE_API_KEY"


def make_reverse_image_search() -> ReverseImageSearch:
    if os.environ.get(REVERSE_IMAGE_API_KEY_ENV):
        from app.clients.reverse_image_search import RealReverseImageSearch

        return RealReverseImageSearch()
    from app.fakes.fake_reverse_image import FakeReverseImageSearch

    return FakeReverseImageSearch()


__all__ = ["REVERSE_IMAGE_API_KEY_ENV", "make_reverse_image_search"]
