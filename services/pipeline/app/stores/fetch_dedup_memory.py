"""In-memory FetchDedupStore implementation — dict-backed, no new
dependency. Mirrors InMemoryCheckStore's role: a real deployment swaps
this for a Postgres-backed store reading/writing `fetch_candidates` /
`fetch_observations` (db/migrations/0013) without changing any call
site, since app/stages/fetch_hop.py depends on the Protocol.

TECH DEBT (explicit, not buried): this store is process-lifetime only.
A Cloud Run instance recycling between QStash-triggered polls loses all
dedup state, which would re-emit a claim that was already emitted by a
prior instance — unacceptable for AT-0032-3 in a real deployment. The
real fix is the Postgres-backed FetchDedupStore wired to
db/migrations/0013's tables; tracked as deferred wiring, not fixed here
(this slice's scope is the dedup *logic* and its tested Protocol, not
the Postgres plumbing — see task brief's bounded-slice note).
"""

from __future__ import annotations

from datetime import datetime

from app.protocols.fetch_dedup_store import (
    FetchCandidateRecord,
    FetchCandidateStatus,
    FetchDedupStore,
    FetchObservationHistory,
)


class _MutableRecord:
    __slots__ = (
        "claim_text",
        "content_hash",
        "first_observed_at",
        "last_observed_at",
        "platforms_seen",
        "score",
        "status",
        "submission_id",
        "trend_count",
    )

    def __init__(self, *, content_hash: str, claim_text: str, score: float, platform: str, observed_at: datetime) -> None:
        self.content_hash = content_hash
        self.claim_text = claim_text
        self.score = score
        self.status: FetchCandidateStatus = "pending"
        self.submission_id: str | None = None
        self.trend_count = 1
        self.platforms_seen: set[str] = {platform}
        self.first_observed_at = observed_at
        self.last_observed_at = observed_at

    def to_record(self) -> FetchCandidateRecord:
        return FetchCandidateRecord(
            content_hash=self.content_hash,
            claim_text=self.claim_text,
            score=self.score,
            status=self.status,
            submission_id=self.submission_id,
            trend_count=self.trend_count,
            platforms_seen=frozenset(self.platforms_seen),
            first_observed_at=self.first_observed_at,
            last_observed_at=self.last_observed_at,
        )


class InMemoryFetchDedupStore(FetchDedupStore):
    def __init__(self) -> None:
        self._seen_platform_items: set[tuple[str, str]] = set()
        self._candidates: dict[str, _MutableRecord] = {}
        # ADR-0037: the engagement time-series per (platform, native_id),
        # mirroring the Postgres `fetch_observations` rows the
        # FETCH_VELOCITY_REOBSERVE path appends. Only written by
        # `record_engagement_snapshot`; the pre-ADR-0037 `record_observation`
        # path leaves this empty (it only needs the layer-1 "seen" set).
        self._snapshots: dict[tuple[str, str], list[tuple[datetime, dict[str, int]]]] = {}

    def seen_platform_item(self, platform: str, native_id: str) -> bool:
        return (platform, native_id) in self._seen_platform_items

    def record_observation(
        self, *, platform: str, native_id: str, content_hash: str, observed_at: datetime
    ) -> None:
        self._seen_platform_items.add((platform, native_id))

    def record_engagement_snapshot(
        self,
        *,
        platform: str,
        native_id: str,
        content_hash: str,
        observed_at: datetime,
        engagement: dict[str, int],
    ) -> None:
        self._seen_platform_items.add((platform, native_id))
        self._snapshots.setdefault((platform, native_id), []).append((observed_at, dict(engagement)))

    def observation_history(self, platform: str, native_id: str) -> FetchObservationHistory:
        snaps = self._snapshots.get((platform, native_id))
        if not snaps:
            return FetchObservationHistory(
                count=0, first_observed_at=None, latest_observed_at=None, latest_engagement={}
            )
        ordered = sorted(snaps, key=lambda s: s[0])
        latest_at, latest_engagement = ordered[-1]
        return FetchObservationHistory(
            count=len(ordered),
            first_observed_at=ordered[0][0],
            latest_observed_at=latest_at,
            latest_engagement=dict(latest_engagement),
        )

    def upsert_candidate(
        self, *, content_hash: str, claim_text: str, score: float, platform: str, observed_at: datetime
    ) -> tuple[FetchCandidateRecord, bool]:
        existing = self._candidates.get(content_hash)
        if existing is None:
            record = _MutableRecord(
                content_hash=content_hash,
                claim_text=claim_text,
                score=score,
                platform=platform,
                observed_at=observed_at,
            )
            self._candidates[content_hash] = record
            return record.to_record(), True

        existing.trend_count += 1
        existing.platforms_seen.add(platform)
        existing.last_observed_at = observed_at
        # A later, lower-scoring re-poll must never silently downgrade an
        # already-trending claim (see Protocol docstring).
        existing.score = max(existing.score, score)
        return existing.to_record(), False

    def mark_emitted(self, content_hash: str, *, submission_id: str) -> None:
        record = self._candidates[content_hash]
        record.status = "emitted"
        record.submission_id = submission_id

    def mark_dropped(self, content_hash: str) -> None:
        record = self._candidates[content_hash]
        if record.status == "pending":
            record.status = "dropped"


__all__ = ["InMemoryFetchDedupStore"]
