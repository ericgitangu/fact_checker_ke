"""ADR-0005 RealChirp2Transcriber wiring: the activate-on-config factory and the
dedicated "stt" cost-breaker lane metering.

The google-cloud-speech SDK is MOCKED throughout (a fake module injected into
sys.modules) — no real Speech-to-Text call is ever made, and the tests pass with
or without the real SDK installed.
"""

from __future__ import annotations

import sys
import types as pytypes
from dataclasses import dataclass, field

import pytest

from app.fakes.fake_transcriber import FakeTranscriber
from app.protocols.transcriber import TranscriptionError
from app.stores.engine_breaker import InMemoryEngineCostBreaker


@dataclass
class _FakeAlternative:
    transcript: str


@dataclass
class _FakeResult:
    alternatives: list[_FakeAlternative]
    language_code: str


@dataclass
class _FakeMetadata:
    # google-cloud-speech v2 exposes total_billed_duration as a timedelta;
    # _duration_seconds() calls .total_seconds() on it.
    total_billed_duration: object


@dataclass
class _FakeResponse:
    results: list[_FakeResult]
    metadata: _FakeMetadata


@dataclass
class _RecognizeSpy:
    """Captures whether (and with what) recognize() was called."""

    calls: list[object] = field(default_factory=list)
    transcript: str = "habari ya leo ni muhimu"
    language: str = "sw-KE"
    billed_seconds: float = 30.0

    def response(self) -> _FakeResponse:
        import datetime

        return _FakeResponse(
            results=[
                _FakeResult(
                    alternatives=[_FakeAlternative(transcript=self.transcript)],
                    language_code=self.language,
                )
            ],
            metadata=_FakeMetadata(
                total_billed_duration=datetime.timedelta(seconds=self.billed_seconds)
            ),
        )


def _install_fake_sdk(monkeypatch: pytest.MonkeyPatch, spy: _RecognizeSpy) -> dict[str, object]:
    """Inject a fake `google.cloud.speech_v2` (+ .types.cloud_speech) into
    sys.modules so RealChirp2Transcriber's lazy import resolves to our doubles.
    Returns the captured client_options so the regional-endpoint assertion can
    check them."""
    captured: dict[str, object] = {}

    class _FakeSpeechClient:
        def __init__(self, *, client_options: object = None) -> None:
            captured["client_options"] = client_options

        def recognize(self, *, request: object) -> _FakeResponse:
            spy.calls.append(request)
            return spy.response()

    def _mk(**kwargs: object) -> dict[str, object]:
        return dict(kwargs)

    cloud_speech = pytypes.SimpleNamespace(
        RecognitionConfig=_mk,
        AutoDetectDecodingConfig=_mk,
        RecognizeRequest=_mk,
    )
    types_mod = pytypes.ModuleType("google.cloud.speech_v2.types")
    types_mod.cloud_speech = cloud_speech  # type: ignore[attr-defined]
    speech_v2_mod = pytypes.ModuleType("google.cloud.speech_v2")
    speech_v2_mod.SpeechClient = _FakeSpeechClient  # type: ignore[attr-defined]
    speech_v2_mod.types = types_mod  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "google.cloud.speech_v2", speech_v2_mod)
    monkeypatch.setitem(sys.modules, "google.cloud.speech_v2.types", types_mod)
    return captured


# --- factory selection -----------------------------------------------------


def test_factory_off_by_default_returns_fake(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUBMISSION_STT_ENABLED", raising=False)
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "fact-checker-ke")
    from app.clients.transcriber_factory import make_transcriber

    assert isinstance(make_transcriber(), FakeTranscriber)


def test_factory_enabled_but_no_project_returns_fake(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUBMISSION_STT_ENABLED", "true")
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    from app.clients.transcriber_factory import make_transcriber

    assert isinstance(make_transcriber(), FakeTranscriber)


def test_factory_enabled_and_configured_returns_real(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_sdk(monkeypatch, _RecognizeSpy())
    monkeypatch.setenv("SUBMISSION_STT_ENABLED", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "fact-checker-ke")
    from app.clients.transcriber_chirp2 import RealChirp2Transcriber
    from app.clients.transcriber_factory import make_transcriber

    assert isinstance(make_transcriber(), RealChirp2Transcriber)


def test_factory_degrades_to_fake_when_construction_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    # Enabled + project set, but GOOGLE_CLOUD_PROJECT is read inside __init__ as
    # empty via a forced raise: simulate by making the SDK import blow up.
    monkeypatch.setenv("SUBMISSION_STT_ENABLED", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "fact-checker-ke")
    bad = pytypes.ModuleType("google.cloud.speech_v2")

    def _boom(*_a: object, **_k: object) -> None:
        raise RuntimeError("transport build failed")

    bad.SpeechClient = _boom  # type: ignore[attr-defined]
    types_mod = pytypes.ModuleType("google.cloud.speech_v2.types")
    types_mod.cloud_speech = pytypes.SimpleNamespace()  # type: ignore[attr-defined]
    bad.types = types_mod  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "google.cloud.speech_v2", bad)
    monkeypatch.setitem(sys.modules, "google.cloud.speech_v2.types", types_mod)

    from app.clients.transcriber_factory import make_transcriber

    assert isinstance(make_transcriber(), FakeTranscriber)


# --- real client behaviour + regional endpoint -----------------------------


async def test_real_transcribe_returns_result_and_uses_regional_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spy = _RecognizeSpy(transcript="serikali imetangaza", language="sw-KE", billed_seconds=42.0)
    captured = _install_fake_sdk(monkeypatch, spy)
    monkeypatch.setenv("SUBMISSION_STT_ENABLED", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "fact-checker-ke")
    monkeypatch.setenv("STT_LOCATION", "us-central1")
    from app.clients.transcriber_chirp2 import RealChirp2Transcriber

    tx = RealChirp2Transcriber()
    result = await tx.transcribe("gs://bucket/clip.wav")

    assert result.text == "serikali imetangaza"
    assert result.language == "sw-KE"
    assert result.duration_seconds == 42.0
    # Regional endpoint is REQUIRED for chirp_2 (ADR-0005).
    assert captured["client_options"] == {"api_endpoint": "us-central1-speech.googleapis.com"}
    # gs:// uri passed straight through (no bytes fetch).
    assert spy.calls and spy.calls[0]["uri"] == "gs://bucket/clip.wav"


async def test_real_transcribe_empty_transcript_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    spy = _RecognizeSpy(transcript="", billed_seconds=5.0)
    _install_fake_sdk(monkeypatch, spy)
    monkeypatch.setenv("SUBMISSION_STT_ENABLED", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "fact-checker-ke")
    from app.clients.transcriber_chirp2 import RealChirp2Transcriber

    tx = RealChirp2Transcriber()
    with pytest.raises(TranscriptionError):
        await tx.transcribe("gs://bucket/silent.wav")


# --- dedicated "stt" breaker lane metering ----------------------------------


async def test_breaker_post_call_charges_stt_lane(monkeypatch: pytest.MonkeyPatch) -> None:
    spy = _RecognizeSpy(billed_seconds=60.0)  # exactly 1 minute -> $0.016
    _install_fake_sdk(monkeypatch, spy)
    monkeypatch.setenv("SUBMISSION_STT_ENABLED", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "fact-checker-ke")
    monkeypatch.setenv("STT_ENGINE_DAILY_BUDGET_USD", "0.50")
    from app.clients.transcriber_chirp2 import RealChirp2Transcriber

    breaker = InMemoryEngineCostBreaker()
    tx = RealChirp2Transcriber(breaker=breaker)
    await tx.transcribe("gs://bucket/clip.wav")

    # Only the "stt" lane is charged; fetch/submission/corroboration untouched.
    assert breaker.current_state("stt").usd_spent == pytest.approx(0.016)
    assert breaker.current_state("fetch").usd_spent == 0.0
    assert breaker.current_state("submission").usd_spent == 0.0
    assert breaker.current_state("corroboration").usd_spent == 0.0


async def test_breaker_pre_check_hard_stopped_skips_the_call(monkeypatch: pytest.MonkeyPatch) -> None:
    spy = _RecognizeSpy()
    _install_fake_sdk(monkeypatch, spy)
    monkeypatch.setenv("SUBMISSION_STT_ENABLED", "true")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "fact-checker-ke")
    monkeypatch.setenv("STT_ENGINE_DAILY_BUDGET_USD", "0.10")
    from app.clients.transcriber_chirp2 import RealChirp2Transcriber

    breaker = InMemoryEngineCostBreaker()
    breaker.record_spend("stt", 0.10)  # 100% of budget -> hard_stopped
    assert breaker.current_state("stt").hard_stopped is True

    tx = RealChirp2Transcriber(breaker=breaker)
    with pytest.raises(TranscriptionError):
        await tx.transcribe("gs://bucket/clip.wav")

    # Fail-closed: the SDK recognize() must NOT have been called.
    assert spy.calls == []
    # And no further spend was recorded beyond the pre-existing exhaustion.
    assert breaker.current_state("stt").usd_spent == pytest.approx(0.10)


def test_stt_lane_default_budget_present() -> None:
    from app.stores.engine_breaker import DEFAULT_DAILY_BUDGET_USD, configured_daily_budget_usd

    assert "stt" in DEFAULT_DAILY_BUDGET_USD
    assert configured_daily_budget_usd("stt") > 0
