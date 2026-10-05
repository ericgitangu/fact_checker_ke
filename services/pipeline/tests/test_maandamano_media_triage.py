"""ADR-0035 maandamano embed misinfo-triage — pipeline side.

Covers the pipeline half of AT-0035-3 (every embed routed through the
existing reverse-image/synthetic-media check; an earlier-dated copy →
flagged) and AT-0035-6 (the ingestion-boundary firewall: no pipeline/fetch
code path WRITES demonstrations / demonstration_media /
demonstration_status_events — enforced structurally by the absence of any
such SQL, the same "no such code exists" discipline as ADR-0030's funnel
firewall).
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.fakes.fake_reverse_image import FakeReverseImageSearch
from app.main import app
from app.protocols.reverse_image import EarlierCopyMatch
from app.stages.maandamano_media_triage import run_maandamano_media_triage

client = TestClient(app)

APP_DIR = Path(__file__).resolve().parents[1] / "app"
CURATED_TABLES = ("demonstrations", "demonstration_media", "demonstration_status_events")


def test_at_0035_3_flags_an_earlier_dated_copy() -> None:
    """A thumbnail/frame matching an earlier-dated copy → flagged, with an
    editor-facing earlier-copy note + the earlier URL surfaced."""
    rev = FakeReverseImageSearch()
    rev.seed_match(
        "thumb-hash-xyz",
        EarlierCopyMatch(source_url="https://example.com/old-clip", found_at="2019-01-01"),
    )
    result = run_maandamano_media_triage("thumb-hash-xyz", reverse_image_search=rev)
    assert result.status == "flagged"
    assert result.earlier_url == "https://example.com/old-clip"
    assert "recycled/miscontextualized" in (result.note or "")
    assert "2019-01-01" in (result.note or "")


def test_at_0035_3_clears_when_no_earlier_copy() -> None:
    rev = FakeReverseImageSearch()
    result = run_maandamano_media_triage("thumb-hash-unseen", reverse_image_search=rev)
    assert result.status == "clear"
    assert result.note is None
    assert result.earlier_url is None


def test_at_0035_3_hop_routes_embed_through_reverse_image_check() -> None:
    """The /hops/media-triage route runs the check and returns the result;
    with no API_BASE_URL/PIPELINE_CALLBACK_SECRET configured in the test env
    the write-back is skipped (callback_delivered=False) but the result is
    still returned — the embed is still ROUTED through the check."""
    res = client.post(
        "/hops/media-triage",
        json={
            "media_id": "11111111-1111-4111-8111-111111111111",
            "platform": "youtube",
            "embed_url": "https://www.youtube.com/embed/abc",
            "thumbnail_ref": "thumb-hash-unseen",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "clear"
    assert body["callback_delivered"] is False
    # Never re-hosted: the hop response carries no media bytes.
    assert "media_base64" not in body
    assert "thumbnail_bytes" not in body


def test_at_0035_3_hop_rejects_unknown_fields() -> None:
    res = client.post(
        "/hops/media-triage",
        json={
            "media_id": "x",
            "platform": "youtube",
            "embed_url": "https://www.youtube.com/embed/abc",
            "thumbnail_ref": "t",
            "media_base64": "AAAA",
        },
    )
    assert res.status_code == 422


def test_at_0035_6_no_pipeline_code_writes_the_curated_tables() -> None:
    """Ingestion-boundary firewall: advisories/media/status are human-
    curated. No pipeline/fetch code path issues an INSERT/UPDATE/DELETE
    against any of the three curated tables — scanned over the whole
    app/ source tree."""
    write_patterns = [
        re.compile(rf"insert\s+into\s+\"?{t}\"?", re.IGNORECASE) for t in CURATED_TABLES
    ]
    write_patterns += [re.compile(rf"update\s+\"?{t}\"?", re.IGNORECASE) for t in CURATED_TABLES]
    write_patterns += [
        re.compile(rf"delete\s+from\s+\"?{t}\"?", re.IGNORECASE) for t in CURATED_TABLES
    ]

    offenders: list[str] = []
    for py_file in APP_DIR.rglob("*.py"):
        text = py_file.read_text(encoding="utf-8")
        for pattern in write_patterns:
            if pattern.search(text):
                offenders.append(f"{py_file}: {pattern.pattern}")

    assert offenders == [], f"pipeline code writes a human-curated maandamano table: {offenders}"
