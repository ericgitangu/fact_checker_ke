from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_normalize_is_idempotent() -> None:
    payload = {"content": "  Hello World  "}
    first = client.post("/stages/normalize", json=payload)
    second = client.post("/stages/normalize", json=payload)
    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json()["normalized_text"] == "hello world"


def test_transcribe_happy_path() -> None:
    res = client.post("/stages/transcribe", json={"audio_url": "https://example.com/clip.mp3"})
    assert res.status_code == 200
    assert "fake transcript" in res.json()["text"]


def test_transcribe_failure_mode_returns_422() -> None:
    res = client.post("/stages/transcribe", json={"audio_url": "https://example.com/clip.unsupported"})
    assert res.status_code == 422
