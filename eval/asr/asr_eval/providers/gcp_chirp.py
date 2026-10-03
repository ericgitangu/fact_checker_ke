"""GCP Speech-to-Text v2, Chirp family, sw-KE.

Empirical region/model check done before writing this file (recorded in the
harness report and in the ADR append — not assumed from ADR-0005 round-2's
"[V2-SECONDARY]" claim, which this corrects):

  - `chirp_3` does NOT exist in us-central1, europe-west4, or the `global`
    endpoint for this project as of 2026-10-03 (400 INVALID_ARGUMENT,
    "model does not exist in the location"). ADR-0005 round 2 said "Chirp 3
    lists sw-KE (Preview)" — that may be true for allowlisted projects but
    was NOT reproducible here.
  - `chirp_2` DOES accept language code `sw-KE` in `us-central1` — a
    recognizer was created and deleted there as a live check.
  - legacy `chirp` (v1-style) rejects sw-KE in us-central1
    ("language ... is not supported by the model chirp").

Decision: this provider uses chirp_2 / us-central1, the best empirically
confirmed option, not chirp_3.
"""
from __future__ import annotations

import time

from google.api_core.client_options import ClientOptions
from google.cloud.speech_v2 import SpeechClient
from google.cloud.speech_v2.types import cloud_speech

from . import TranscriptResult
from .gemini_vertex import _gcloud_cli_credentials

PROJECT = "master-crossing-435409-r1"
LOCATION = "us-central1"
MODEL = "chirp_2"
RECOGNIZER_ID = "asr-eval-sw-ke-chirp2"

# Chirp pricing (standard, as published for Speech-to-Text v2 non-streaming
# recognition): billed per 15-second increment. Used here as an ESTIMATE for
# budget tracking only — see est_cost caveat in gemini_vertex.py.
_EST_PRICE_PER_15S_USD = 0.016 / 4  # ADR-0005 round-2: "~$0.016/min" -> /4 per 15s


def _estimate_cost(duration_s: float) -> float:
    increments = max(1, -(-int(duration_s) // 15))  # ceil div
    return increments * _EST_PRICE_PER_15S_USD


class GcpChirpProvider:
    name = "gcp-stt-v2-chirp_2"
    endpoint = f"speech.googleapis.com v2 recognize, region={LOCATION}, model={MODEL}"
    terms_class = "Google Cloud STT v2 (Cloud terms, no-train, paid per-use)"

    def __init__(self) -> None:
        client_options = ClientOptions(api_endpoint=f"{LOCATION}-speech.googleapis.com")
        self._client = SpeechClient(
            client_options=client_options,
            credentials=_gcloud_cli_credentials(),
        )
        self._recognizer_path = (
            f"projects/{PROJECT}/locations/{LOCATION}/recognizers/{RECOGNIZER_ID}"
        )
        self._ensure_recognizer()

    def _ensure_recognizer(self) -> None:
        try:
            self._client.get_recognizer(name=self._recognizer_path)
            return
        except Exception:
            pass
        op = self._client.create_recognizer(
            parent=f"projects/{PROJECT}/locations/{LOCATION}",
            recognizer_id=RECOGNIZER_ID,
            recognizer=cloud_speech.Recognizer(
                language_codes=["sw-KE"],
                model=MODEL,
                default_recognition_config=cloud_speech.RecognitionConfig(
                    auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
                ),
            ),
        )
        op.result(timeout=120)

    def transcribe(self, wav_path: str, duration_s: float) -> TranscriptResult:
        clip_id = wav_path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        with open(wav_path, "rb") as f:
            audio_bytes = f.read()

        t0 = time.monotonic()
        try:
            resp = self._client.recognize(
                recognizer=self._recognizer_path,
                config=cloud_speech.RecognitionConfig(
                    auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
                ),
                content=audio_bytes,
            )
            latency_s = time.monotonic() - t0
            text = " ".join(
                result.alternatives[0].transcript
                for result in resp.results
                if result.alternatives
            ).strip()
            return TranscriptResult(
                clip_id=clip_id,
                ok=True,
                transcript=text,
                latency_s=round(latency_s, 3),
                est_cost_usd=round(_estimate_cost(duration_s), 6),
            )
        except Exception as exc:  # noqa: BLE001
            latency_s = time.monotonic() - t0
            return TranscriptResult(
                clip_id=clip_id,
                ok=False,
                latency_s=round(latency_s, 3),
                error=f"{type(exc).__name__}: {exc}",
            )
