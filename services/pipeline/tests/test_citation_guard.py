"""AT-0004-C / AT-0023-2 / AT-0023-3: citation integrity."""

from __future__ import annotations

import pytest

from app.models.pipeline_io import Citation
from app.stages.citation_guard import CitationIntegrityError, RetrievedDoc, verify_citations


def test_valid_citation_passes() -> None:
    retrieved = [RetrievedDoc(doc_id="doc-1", text="KNBS reports inflation at 7% in 2026.")]
    citations = [Citation(doc_id="doc-1", quoted_span="inflation at 7%")]
    verify_citations(citations, retrieved)  # must not raise


def test_empty_citations_pass() -> None:
    verify_citations([], [RetrievedDoc(doc_id="doc-1", text="anything")])


def test_citation_to_unretrieved_doc_id_rejected_at_0023_2() -> None:
    retrieved = [RetrievedDoc(doc_id="doc-1", text="KNBS reports inflation at 7% in 2026.")]
    citations = [Citation(doc_id="kenya.go.ke/fabricated", quoted_span="anything")]
    with pytest.raises(CitationIntegrityError) as exc_info:
        verify_citations(citations, retrieved)
    assert "not in the retrieved set" in str(exc_info.value)
    assert exc_info.value.doc_id == "kenya.go.ke/fabricated"


def test_misquoted_span_rejected_at_0023_3() -> None:
    retrieved = [RetrievedDoc(doc_id="doc-1", text="KNBS reports inflation at 7% in 2026.")]
    citations = [Citation(doc_id="doc-1", quoted_span="inflation at 99%")]
    with pytest.raises(CitationIntegrityError) as exc_info:
        verify_citations(citations, retrieved)
    assert "does not substring-match" in str(exc_info.value)
    assert exc_info.value.doc_id == "doc-1"


def test_first_violation_is_reported_among_multiple() -> None:
    retrieved = [RetrievedDoc(doc_id="doc-1", text="real text")]
    citations = [
        Citation(doc_id="doc-1", quoted_span="real text"),
        Citation(doc_id="doc-missing", quoted_span="anything"),
    ]
    with pytest.raises(CitationIntegrityError) as exc_info:
        verify_citations(citations, retrieved)
    assert exc_info.value.doc_id == "doc-missing"
