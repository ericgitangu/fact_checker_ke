"""End-to-end tests for the new /hops/media-process and
/hops/synthetic-media-triage routes (ADR-0027/0006), via the real FastAPI
app wiring in app/main.py — only the detector/reverse-image/abuse-scan
backends are fakes (no vendor keys anywhere, see app/main.py's wiring
comment)."""

from __future__ import annotations

import base64
import io

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)


def _png_b64(fill: str = "red") -> str:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), fill).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_hop_media_process_strips_and_hashes() -> None:
    res = client.post(
        "/hops/media-process",
        json={"submission_id": "sub-1", "org_id": "org-1", "media_base64": _png_b64(), "mime_type": "image/png"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["exif_gps_stripped"] is True
    assert len(body["content_hash"]) == 64
    assert body["quarantined"] is False
    # Never re-hosted: the response must not echo back raw media bytes.
    assert "stripped_bytes" not in body
    assert "media_base64" not in body


def test_hop_media_process_rejects_corrupt_bytes() -> None:
    res = client.post(
        "/hops/media-process",
        json={
            "submission_id": "sub-1",
            "org_id": "org-1",
            "media_base64": base64.b64encode(b"not an image").decode(),
            "mime_type": "image/png",
        },
    )
    assert res.status_code == 422


def test_hop_synthetic_media_triage_no_signal_label_has_no_deepfake_wording() -> None:
    res = client.post(
        "/hops/synthetic-media-triage",
        json={
            "submission_id": "sub-1",
            "org_id": "org-1",
            "media_base64": _png_b64(),
            "mime_type": "image/png",
            "media_hash": "hash-abc",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert "deepfake" not in body["label"].lower()
