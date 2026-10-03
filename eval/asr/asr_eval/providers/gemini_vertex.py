"""Gemini via Vertex AI — PAID tier, Cloud terms (no-train on customer data).

ADR-0005 "Free-tier terms: verified, and prohibitive" forbids calling the
unpaid AI-Studio endpoint for anything except eval on public/broadcast data.
This provider deliberately uses `vertexai=True` (never `google.genai` against
the public generativelanguage.googleapis.com AI-Studio endpoint), which puts
every call on Cloud's paid, no-train terms even though Round A's FLEURS data
would itself be permitted on the unpaid tier too.

Model: empirically confirmed reachable on this project via a live
`generateContent` call before this file was written (see harness report) —
`gemini-2.5-flash`, region us-central1, project master-crossing-435409-r1.
"""
from __future__ import annotations

import subprocess
import time

from google import genai
from google.genai import types
from google.oauth2.credentials import Credentials

from . import TranscriptResult


def _gcloud_cli_credentials() -> Credentials:
    """Build credentials from the active `gcloud` CLI account rather than
    ADC (`gcloud auth application-default login`), which on this machine is
    logged into a *different* Google account/quota project than the one
    authorized on master-crossing-435409-r1 (verified empirically: ADC
    token -> 403 aiplatform.endpoints.predict; `gcloud auth print-access-token`
    -> 200). Short-lived (~1h) access token, fetched fresh per client init.
    """
    token = subprocess.run(
        ["gcloud", "auth", "print-access-token"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return Credentials(token=token)

PROJECT = "master-crossing-435409-r1"
LOCATION = "us-central1"
MODEL = "gemini-2.5-flash"

# Pricing (Vertex AI generative, audio input) as of 2026-10-03: Gemini 2.5
# Flash audio input is billed at the published per-second audio rate.
# We use the ADR-0005 round-2 approximation of ~25 tokens/sec of audio and
# the public per-token price as the est_cost basis; this is a cost ESTIMATE
# for budget tracking, not a billing reconciliation (unverified against the
# actual invoice line item for this feature — ADR-0011 still carries pricing
# GAPs). Flash input price used: $0.30 / 1M tokens (text-equivalent tier).
_EST_TOKENS_PER_SEC_AUDIO = 25
_EST_PRICE_PER_MTOK_INPUT_USD = 0.30
_EST_PRICE_PER_MTOK_OUTPUT_USD = 2.50


def _estimate_cost(duration_s: float, output_tokens: int) -> float:
    input_tokens = duration_s * _EST_TOKENS_PER_SEC_AUDIO
    cost = (input_tokens / 1_000_000) * _EST_PRICE_PER_MTOK_INPUT_USD
    cost += (output_tokens / 1_000_000) * _EST_PRICE_PER_MTOK_OUTPUT_USD
    return cost


class GeminiVertexProvider:
    name = "gemini-2.5-flash-vertex"
    endpoint = f"vertexai generateContent, project={PROJECT}, region={LOCATION}, model={MODEL}"
    terms_class = "Vertex AI paid tier (Google Cloud terms, no-train) — ADR-0005 compliant"

    def __init__(self) -> None:
        self._client = genai.Client(
            vertexai=True,
            project=PROJECT,
            location=LOCATION,
            credentials=_gcloud_cli_credentials(),
        )

    def transcribe(self, wav_path: str, duration_s: float) -> TranscriptResult:
        clip_id = wav_path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        with open(wav_path, "rb") as f:
            audio_bytes = f.read()

        prompt = (
            "Transcribe this audio verbatim in the language it is spoken in "
            "(Swahili, English, Sheng, or a code-switched mix). Output ONLY "
            "the transcript text, no commentary, no translation, no speaker "
            "labels, no timestamps."
        )
        t0 = time.monotonic()
        try:
            resp = self._client.models.generate_content(
                model=MODEL,
                contents=[
                    types.Part.from_bytes(data=audio_bytes, mime_type="audio/wav"),
                    prompt,
                ],
            )
            latency_s = time.monotonic() - t0
            text = (resp.text or "").strip()
            out_tokens = 0
            if resp.usage_metadata is not None:
                out_tokens = resp.usage_metadata.candidates_token_count or 0
            return TranscriptResult(
                clip_id=clip_id,
                ok=True,
                transcript=text,
                latency_s=round(latency_s, 3),
                est_cost_usd=round(_estimate_cost(duration_s, out_tokens), 6),
            )
        except Exception as exc:  # noqa: BLE001 — provider call, report failure not raise
            latency_s = time.monotonic() - t0
            return TranscriptResult(
                clip_id=clip_id,
                ok=False,
                latency_s=round(latency_s, 3),
                error=f"{type(exc).__name__}: {exc}",
            )
