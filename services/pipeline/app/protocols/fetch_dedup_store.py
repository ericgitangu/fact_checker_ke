"""FetchDedupStore Protocol: structural typing boundary for ADR-0032 §3's
three-layer dedup.

Layer 1 (platform-item identity) and layer 2/3 (content-hash / claim
identity, collapsing cross-posts and repeat observations) are both
served by this one Protocol so app/stages/fetch_hop.py depends on an
abstraction, not a concrete store. The real Postgres-backed
implementation (db/migrations/0013, `fetch_candidates` +
`fetch_observations`) lands at a later wave's DB wiring — packages/db
wiring beyond the migration itself is out of scope for this slice (see
task's file-ownership boundary); InMemoryFetchDedupStore
(app/stores/fetch_dedup_memory.py) is the one Protocol implementation
this slice wires up, same pattern as InMemoryCheckStore.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

FetchCandidateStatus = Literal["pending", "emitted", "dropped"]


@dataclass(frozen=True, slots=True)
class FetchCandidateRecord:
    """A durable, deduped claim candidate — the layer-2/3 identity that
    collapses "same claim, N platforms, M re-polls" into one row."""

    content_hash: str
    claim_text: str
    score: float
    status: FetchCandidateStatus
    submission_id: str | None
    trend_count: int
    platforms_seen: frozenset[str]
    first_observed_at: datetime
    last_observed_at: datetime


@dataclass(frozen=True, slots=True)
class FetchObservationHistory:
    """ADR-0037: a summary of the engagement snapshots already recorded for
    one (platform, native_id) — the inputs the velocity scorer needs to turn
    a static engagement snapshot into a real Δengagement/Δtime rate.

    `count` is how many prior snapshots exist; `first_observed_at` /
    `latest_observed_at` / `latest_engagement` describe the earliest and most
    recent of them. All three are None/empty when `count == 0` (the first-ever
    observation of this item — velocity is then 0, not an error). Only read on
    the FETCH_VELOCITY_REOBSERVE path."""

    count: int
    first_observed_at: datetime | None
    latest_observed_at: datetime | None
    latest_engagement: dict[str, int]


class FetchDedupStore(Protocol):
    def seen_platform_item(self, platform: str, native_id: str) -> bool:
        """Layer 1: has this exact (platform, native_id) already been
        recorded as an observation? True means "drop immediately, no
        scoring" (ADR-0032 §3)."""
        ...

    def record_observation(
        self,
        *,
        platform: str,
        native_id: str,
        content_hash: str,
        observed_at: datetime,
    ) -> None:
        """Record that (platform, native_id) has now been seen, tied to
        the claim identity `content_hash` it belongs to. Idempotent:
        recording the same (platform, native_id) twice is a no-op for
        layer-1 purposes (it was already "seen" after the first call)."""
        ...

    def upsert_candidate(
        self, *, content_hash: str, claim_text: str, score: float, platform: str, observed_at: datetime
    ) -> tuple[FetchCandidateRecord, bool]:
        """Layer 2/3: find-or-create the candidate for `content_hash`.
        Returns (record, is_new). On an existing record, bumps
        `trend_count`, adds `platform` to `platforms_seen`, refreshes
        `last_observed_at`, and keeps the HIGHER of the stored/new score
        (a later, lower-scoring re-poll must never silently downgrade an
        already-trending claim) — the status/submission_id already on
        the record are left untouched (whether it has already been
        emitted is a fact about the past, not something a re-poll
        revisits)."""
        ...

    def record_engagement_snapshot(
        self,
        *,
        platform: str,
        native_id: str,
        content_hash: str,
        observed_at: datetime,
        engagement: dict[str, int],
    ) -> None:
        """ADR-0037: append a NEW engagement observation of (platform,
        native_id). Unlike `record_observation` (which keeps a single
        layer-1 "seen" marker per item, idempotent on repeat), this stores
        a time-series row on EVERY call, so velocity can be measured across
        re-polls. Called only on the FETCH_VELOCITY_REOBSERVE path; it must
        also mark the item as seen so `seen_platform_item` stays consistent."""
        ...

    def observation_history(self, platform: str, native_id: str) -> FetchObservationHistory:
        """ADR-0037: summarize the engagement snapshots recorded for this
        item BEFORE the current observation (see `FetchObservationHistory`).
        Read only on the FETCH_VELOCITY_REOBSERVE path, to compute the real
        velocity deltas that replace the pre-ADR-0037 constant placeholders."""
        ...

    def mark_emitted(self, content_hash: str, *, submission_id: str) -> None:
        """Record that this candidate has produced its one
        submission.received emission (ADR-0032 §3/AT-0032-3) — a future
        re-poll of the same or a cross-platform duplicate must only
        attach an observation / bump trend counters, never emit again."""
        ...

    def mark_dropped(self, content_hash: str) -> None:
        """Record that this candidate was scored below τ_fetch and will
        not be emitted (distinct from "pending": a dropped candidate
        that later re-trends is free to be re-scored and re-considered,
        unlike an emitted one)."""
        ...


__all__ = [
    "FetchCandidateRecord",
    "FetchCandidateStatus",
    "FetchDedupStore",
    "FetchObservationHistory",
]
