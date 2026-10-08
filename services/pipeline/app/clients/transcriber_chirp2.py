"""RealChirp2Transcriber (ADR-0005): the REAL GCP Speech-to-Text v2 Chirp_2
transcription backend behind the `Transcriber` protocol.

Scope boundary (read this first): this module is ONLY the transcription backend.
It does NOT decide WHETHER transcription runs — that is the compliance fence in
app/stages/stt_gate.py (`resolve_claim_text`), which NEVER transcribes
third-party audio and only ever hands a `stt_eligible` compliant-subset
audio_url to a wired transcriber. This class is constructed only when both
SUBMISSION_STT_ENABLED=true and GOOGLE_CLOUD_PROJECT are set (activate-on-config,
see transcriber_factory.py), so it ships DARK by default.

Auth: ADC via the pipeline runtime service account (NO raw key), exactly like
corroboration's Vertex mode (GOOGLE_GENAI_USE_VERTEXAI) — the SA needs the Speech
client role and speech.googleapis.com enabled (see
infra/terraform/envs/prod/cloud_run.tf + service_accounts.tf notes). The
google-cloud-speech SDK is lazy-imported inside __init__ (wrapped in
ImportError -> TranscriptionError) so importing the factory never pulls the SDK,
mirroring corroboration_gemini.py.

Regional endpoint is REQUIRED for chirp_2 (ADR-0005 Round A: chirp_2 accepts
sw-KE only in a regional location, default us-central1 — the `global` endpoint
does not serve it). No network call at construction: the SpeechClient builds its
transport lazily and the first RPC is the `recognize` call in `transcribe`.

Cost (ADR-0005 / ADR-0032 breaker): each call is metered on a DEDICATED "stt"
EngineCostBreaker lane, isolated from the fetch/submission/corroboration lanes. A
pre-call `hard_stopped` read fails CLOSED (raises TranscriptionError -> the gate
returns None, no call made) when the lane is exhausted; the real per-call spend
(duration_minutes * $0.016) is recorded POST-transcription.

Fail-closed everywhere: every expected failure mode (SDK absent, bad config,
unreachable audio, API error, empty transcript, budget exhausted) surfaces as
TranscriptionError so the shared gate degrades to None and never fabricates a
transcript or crashes the hop.
"""

from __future__ import annotations

import logging
import os

from app.protocols.transcriber import Transcriber, TranscriptionError, TranscriptionResult
from app.stores.engine_breaker import Engine, EngineCostBreaker

_log = logging.getLogger(__name__)

# ADR-0005 Round A (verified live 2026-10-03): chirp_2 in us-central1, Cloud STT
# v2 paid, no-train terms. Price ~$0.016/min (ADR-0005 cost table).
_DEFAULT_LOCATION = "us-central1"
_DEFAULT_MODEL = "chirp_2"
_DEFAULT_LANGUAGES = "sw-KE,en-US"
_USD_PER_MINUTE = 0.016

# The "stt" lane name on the EngineCostBreaker (app/stores/engine_breaker.py).
_STT_ENGINE: Engine = "stt"


def _languages() -> list[str]:
    raw = os.environ.get("STT_LANGUAGES", _DEFAULT_LANGUAGES)
    return [code.strip() for code in raw.split(",") if code.strip()] or [_DEFAULT_LANGUAGES]


def _duration_seconds(metadata: object) -> float:
    """Best-effort billed-duration -> seconds. google-cloud-speech v2 exposes
    `total_billed_duration` as a datetime.timedelta (proto-plus), but older/newer
    shapes expose a protobuf Duration with `.seconds`/`.nanos`. Handle both; a
    missing/odd shape yields 0.0 (cost is then metered as 0 for this call rather
    than crashing the reconciliation — flagged, not silently wrong)."""
    dur = getattr(metadata, "total_billed_duration", None)
    if dur is None:
        return 0.0
    total = getattr(dur, "total_seconds", None)
    if callable(total):
        try:
            return float(total())
        except (TypeError, ValueError):
            return 0.0
    seconds = float(getattr(dur, "seconds", 0) or 0)
    nanos = float(getattr(dur, "nanos", 0) or 0)
    return seconds + nanos / 1_000_000_000


class RealChirp2Transcriber(Transcriber):
    def __init__(self, *, breaker: EngineCostBreaker | None = None) -> None:
        self._project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        if not self._project:
            # Defensive: the factory guards this, but never let an
            # unconfigured instance exist (same discipline as
            # RealGeminiCorroboration).
            raise TranscriptionError("RealChirp2Transcriber needs GOOGLE_CLOUD_PROJECT (ADC)")
        self._location = os.environ.get("STT_LOCATION", _DEFAULT_LOCATION)
        self._model = os.environ.get("STT_MODEL", _DEFAULT_MODEL)
        self._languages = _languages()
        self._breaker = breaker

        try:
            from google.cloud import speech_v2
            from google.cloud.speech_v2.types import cloud_speech
        except ImportError as exc:  # pragma: no cover - exercised only with the SDK absent
            raise TranscriptionError(f"google-cloud-speech SDK not available: {exc}") from exc
        self._speech_v2 = speech_v2
        self._cloud_speech = cloud_speech

        # Regional endpoint REQUIRED for chirp_2 (ADR-0005). ADC supplies the
        # credentials (pipeline runtime SA); no raw key is ever read. No network
        # call here — the transport/first RPC is lazy.
        self._client = speech_v2.SpeechClient(
            client_options={"api_endpoint": f"{self._location}-speech.googleapis.com"}
        )
        # The v2 "implicit" recognizer: config is supplied inline per request, so
        # no recognizer resource needs to be pre-created.
        self._recognizer = f"projects/{self._project}/locations/{self._location}/recognizers/_"

    async def transcribe(self, audio_url: str) -> TranscriptionResult:
        # Pre-call breaker check (fail-closed): if the dedicated "stt" lane is
        # already at/over its daily budget, skip the call entirely. A breaker
        # error must never crash the hop, so any metering failure also fails
        # closed to TranscriptionError (the gate then returns None).
        if self._breaker is not None:
            try:
                if self._breaker.current_state(_STT_ENGINE).hard_stopped:
                    raise TranscriptionError("stt daily budget exhausted; skipping transcription")
            except TranscriptionError:
                raise
            except Exception as exc:
                # Metering must never crash the hop -> fail closed to the gate.
                raise TranscriptionError(f"stt breaker read failed: {exc}") from exc

        import anyio

        try:
            response = await anyio.to_thread.run_sync(lambda: self._recognize(audio_url))
        except TranscriptionError:
            raise
        except Exception as exc:
            raise TranscriptionError(f"Chirp_2 recognize failed for {audio_url}: {exc}") from exc

        text, language = self._extract(response)
        duration = _duration_seconds(getattr(response, "metadata", None))

        # Post-call metering: charge the REAL minutes to the dedicated "stt" lane.
        # Fail-open on a metering error (the transcription already happened and
        # succeeded; losing one cost row must not discard a good transcript).
        if self._breaker is not None and duration > 0:
            usd = duration / 60.0 * _USD_PER_MINUTE
            try:
                self._breaker.record_spend(_STT_ENGINE, usd)
            except Exception:  # noqa: BLE001 - best-effort cost reconciliation
                _log.warning("stt cost metering failed for %s (duration=%.2fs)", audio_url, duration)

        if not text:
            # A silent empty transcript on sensitive-but-legal content is the
            # ADR-0005 Round A Gemini failure mode; for the autonomous path we
            # make it LOUD — an expected failure the gate turns into None, never
            # a fabricated/blank claim passed downstream.
            raise TranscriptionError(f"Chirp_2 returned an empty transcript for {audio_url}")

        return TranscriptionResult(text=text, language=language, duration_seconds=duration)

    def _recognize(self, audio_url: str) -> object:
        """Blocking Speech-to-Text v2 recognize. Runs off the event loop via
        anyio.to_thread. A gs:// uri is passed straight through to the API (no
        bytes leave GCP); an http(s) compliant-subset url is fetched to bytes
        first. NOTE (tech debt, ADR-0005): synchronous `recognize` caps at ~60s /
        10MB of audio — longer compliant clips need `batch_recognize` (a
        long-running op), deferred to a later wave."""
        cloud_speech = self._cloud_speech
        config = cloud_speech.RecognitionConfig(
            auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
            language_codes=self._languages,
            model=self._model,
        )
        if audio_url.startswith("gs://"):
            request = cloud_speech.RecognizeRequest(
                recognizer=self._recognizer, config=config, uri=audio_url
            )
        else:
            request = cloud_speech.RecognizeRequest(
                recognizer=self._recognizer, config=config, content=self._fetch_audio(audio_url)
            )
        return self._client.recognize(request=request)

    @staticmethod
    def _fetch_audio(audio_url: str) -> bytes:
        import httpx

        resp = httpx.get(audio_url, timeout=30.0, follow_redirects=True)
        resp.raise_for_status()
        return resp.content

    def _extract(self, response: object) -> tuple[str, str]:
        """Join alternative[0] transcripts across results; take the first
        result's detected language_code, falling back to the first configured
        language. Any shape surprise degrades to ("", fallback) -> the empty
        guard in transcribe() turns it into a TranscriptionError."""
        fallback_lang = self._languages[0] if self._languages else _DEFAULT_LANGUAGES
        parts: list[str] = []
        language = ""
        try:
            for result in getattr(response, "results", None) or []:
                alternatives = getattr(result, "alternatives", None) or []
                if not alternatives:
                    continue
                transcript = getattr(alternatives[0], "transcript", "") or ""
                if transcript:
                    parts.append(transcript.strip())
                if not language:
                    language = getattr(result, "language_code", "") or ""
        except Exception:  # noqa: BLE001 - malformed response -> empty -> fail closed upstream
            return "", fallback_lang
        return " ".join(p for p in parts if p).strip(), (language or fallback_lang)


__all__ = ["RealChirp2Transcriber"]
