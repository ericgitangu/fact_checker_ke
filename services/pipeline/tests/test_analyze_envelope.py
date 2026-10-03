"""Regression for code-review blocker #1: /hops/analyze must accept the
canonical submission.received event envelope the outbox relay posts (not a
bespoke hop-request shape), and thread the video quote through."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

_ENVELOPE = {
    "event_id": "11111111-1111-4111-8111-111111111111",
    "occurred_at": "2026-10-03T20:00:00Z",
    "submission_id": "22222222-2222-4222-8222-222222222222",
    "org_id": "00000000-0000-0000-0000-000000000001",
    "event_type": "submission.received",
    "schema_version": "v1",
    "payload": {
        "url": "https://youtube.com/watch?v=x",
        "text": None,
        "submitted_by": None,
        "quote": "Unemployment fell to 2% last year",
        "timestamp_sec": 754,
    },
}


def test_analyze_accepts_canonical_event_envelope() -> None:
    res = client.post("/hops/analyze", json=_ENVELOPE)
    assert res.status_code == 200, res.text


def test_analyze_accepts_text_submission_envelope() -> None:
    env = {**_ENVELOPE, "payload": {"url": None, "text": "A checkable claim.",
                                    "submitted_by": None, "quote": None, "timestamp_sec": None}}
    res = client.post("/hops/analyze", json=env)
    assert res.status_code == 200, res.text
