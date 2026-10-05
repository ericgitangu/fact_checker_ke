"""ADR-0035 maandamano embed misinfo-triage stage.

The dominant maandamano misinformation vector is recycled / miscontextualized
footage — an old clip passed off as a current event (ADR-0032 §1b). This
stage runs the EXISTING reverse-image/earlier-copy search
(`app.protocols.reverse_image.ReverseImageSearch`, ADR-0006 signal #3) over a
platform thumbnail/frame reference — NEVER a downloaded copy of the
third-party media (ADR-0002: no re-hosting, no fetching third-party
video/audio bytes). The `thumbnail_ref` the caller passes IS the hash/key the
reverse-image backend is queried with; resolving a richer oEmbed thumbnail is
a caller concern, and no bytes cross this boundary either way.

Suggest-only / human-in-the-loop (ADR-0035 ingestion boundary): this stage
produces a STATUS + editor-facing note that the API writes back onto the
embed. It never creates or advances a demonstration, attaches an embed, or
publishes a location — those are human-curated editor/admin actions in
services/api. This module only classifies an already-attached embed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.protocols.reverse_image import ReverseImageSearch, ReverseImageSearchError


class MediaTriageError(Exception):
    """Raised for an expected reverse-image backend failure (unavailable,
    quota exhausted) — surfaced as a 422 by the hop route, never a 500."""


@dataclass(frozen=True, slots=True)
class MediaMisinfoTriageResult:
    """The misinfo-check outcome for one embed. `status` is the terminal
    `clear`/`flagged` the API persists as `demonstration_media.misinfo_status`
    (the `unchecked`/`checking` states are set API-side, never here)."""

    status: Literal["clear", "flagged"]
    note: str | None
    earlier_url: str | None


def run_maandamano_media_triage(
    thumbnail_ref: str,
    *,
    reverse_image_search: ReverseImageSearch,
) -> MediaMisinfoTriageResult:
    """Flag an embed whose thumbnail/frame matches an earlier-dated copy
    ("recycled footage"); otherwise mark it clear. Thumbnail/metadata only —
    no third-party bytes are downloaded (ADR-0002)."""
    try:
        earlier_copy = reverse_image_search.find_earlier_copy(thumbnail_ref)
    except ReverseImageSearchError as exc:
        raise MediaTriageError(f"reverse-image search failed: {exc}") from exc

    if earlier_copy is not None:
        note = (
            f"earlier copy seen {earlier_copy.source_url} {earlier_copy.found_at} "
            "— consistent with recycled/miscontextualized footage"
        )
        return MediaMisinfoTriageResult(status="flagged", note=note, earlier_url=earlier_copy.source_url)

    return MediaMisinfoTriageResult(status="clear", note=None, earlier_url=None)
