"""Citation integrity (ADR-0004 amendment #7, ADR-0023 §1/§2, AT-0004-C,
AT-0023-2, AT-0023-3).

Every `citations[].doc_id` must be in the set of documents actually
retrieved for that call, checked in code — never trusted from the model —
and every `quoted_span` must substring-match the stored/archived text of
that document. A citation failing either check rejects the draft (typed
error below), the caller retries once, then fails the hop (routed to
editor review) rather than silently dropping the bad citation and auto-
publishing the rest.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.pipeline_io import Citation


class CitationIntegrityError(Exception):
    """Raised when a draft verdict's citations fail integrity checks.
    Never raised for "model declined to cite" (an empty citations list is
    valid, e.g. for a NotCheckable rating)."""

    def __init__(self, reason: str, *, doc_id: str | None = None) -> None:
        self.reason = reason
        self.doc_id = doc_id
        super().__init__(reason)


@dataclass(frozen=True)
class RetrievedDoc:
    doc_id: str
    text: str


def verify_citations(citations: list[Citation], retrieved: list[RetrievedDoc]) -> None:
    """Raises CitationIntegrityError on the first violation found. Returns
    None (no exception) when every citation is valid, including the empty
    list."""
    retrieved_by_id = {doc.doc_id: doc.text for doc in retrieved}
    for citation in citations:
        if citation.doc_id not in retrieved_by_id:
            raise CitationIntegrityError(
                f"doc_id {citation.doc_id!r} is not in the retrieved set for this call "
                "(possible hallucinated citation)",
                doc_id=citation.doc_id,
            )
        archived_text = retrieved_by_id[citation.doc_id]
        if citation.quoted_span not in archived_text:
            raise CitationIntegrityError(
                f"quoted_span for doc_id {citation.doc_id!r} does not substring-match "
                "the archived snapshot (possible misquote)",
                doc_id=citation.doc_id,
            )
