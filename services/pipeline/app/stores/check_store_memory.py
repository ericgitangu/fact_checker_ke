"""In-memory CheckStore implementation (sqlite3 `:memory:` backing — stdlib
only, no new dependency). The real Postgres (Neon) read lands at wave-2
integration; packages/db is out of scope for this change (see task's file-
ownership boundary). Swapping to a PostgresCheckStore later requires only a
new class implementing app.protocols.check_store.CheckStore and a wiring
change — call sites depend on the Protocol.

Cosine similarity is computed in Python, not pushed into SQL (sqlite has no
pgvector equivalent) — fine at this scale (a handful of fixtures / dev
usage); real similarity search belongs to Postgres+pgvector in production.
"""

from __future__ import annotations

import math
import sqlite3
from datetime import date

from app.models.enums import Rating
from app.protocols.check_store import CheckStore, StoredCheck


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a)) or 1.0
    norm_b = math.sqrt(sum(x * x for x in b)) or 1.0
    return dot / (norm_a * norm_b)


class InMemoryCheckStore(CheckStore):
    def __init__(self) -> None:
        # sqlite is used for the non-vector fields (demonstrates the
        # "behind a Protocol, swappable for Postgres" story end to end,
        # including a real query path) — embeddings stay as Python lists
        # in a parallel dict since sqlite has no vector type.
        self._conn = sqlite3.connect(":memory:")
        self._conn.execute(
            """
            CREATE TABLE checks (
                check_id TEXT PRIMARY KEY,
                claim_text TEXT NOT NULL,
                rating TEXT,
                valid_as_of TEXT NOT NULL,
                numbers TEXT NOT NULL,
                dates TEXT NOT NULL,
                entities TEXT NOT NULL,
                negation_present INTEGER NOT NULL
            )
            """
        )
        self._embeddings: dict[str, list[float]] = {}

    def find_candidates(
        self, embedding: list[float], *, limit: int = 5
    ) -> list[tuple[float, StoredCheck]]:
        rows = self._conn.execute(
            "SELECT check_id, claim_text, rating, valid_as_of, numbers, dates, "
            "entities, negation_present FROM checks"
        ).fetchall()
        scored: list[tuple[float, StoredCheck]] = []
        for row in rows:
            check_id = row[0]
            stored_embedding = self._embeddings.get(check_id, [])
            similarity = _cosine(embedding, stored_embedding)
            scored.append(
                (
                    similarity,
                    StoredCheck(
                        check_id=check_id,
                        claim_text=row[1],
                        embedding=stored_embedding,
                        rating=Rating(row[2]) if row[2] else None,
                        valid_as_of=date.fromisoformat(row[3]),
                        numbers=frozenset(row[4].split("\x1f")) if row[4] else frozenset(),
                        dates=frozenset(row[5].split("\x1f")) if row[5] else frozenset(),
                        entities=frozenset(row[6].split("\x1f")) if row[6] else frozenset(),
                        negation_present=bool(row[7]),
                    ),
                )
            )
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return scored[:limit]

    def save(self, check: StoredCheck) -> None:
        self._embeddings[check.check_id] = check.embedding
        self._conn.execute(
            "INSERT OR REPLACE INTO checks VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                check.check_id,
                check.claim_text,
                check.rating.value if check.rating else None,
                check.valid_as_of.isoformat(),
                "\x1f".join(sorted(check.numbers)),
                "\x1f".join(sorted(check.dates)),
                "\x1f".join(sorted(check.entities)),
                int(check.negation_present),
            ),
        )
        self._conn.commit()
