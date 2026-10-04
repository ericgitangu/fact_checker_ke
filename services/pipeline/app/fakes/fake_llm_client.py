from __future__ import annotations

import json

from app.models.pipeline_io import UsageRecord
from app.protocols.llm_client import LlmClient, LlmCompletionError

_FAKE_MODEL_NAME = "fake-llm-v0"

# Negation/Sheng/Swahili cues the fixture uses to decide `language` for the
# analyze-prompt fixture below. Deliberately simple keyword matching (this
# is a test fixture, not a classifier) — see app/stages/dedup_guard.py for
# the comment on why "uncertain -> code-switched" is the chosen bias.
_SHENG_MARKERS = ("niaje", "buda", "msee", "fiti", "sawa sawa", "noma")
_SWAHILI_MARKERS = ("habari", "serikali", "bei", "mafuta", "kodi", "waziri")

# ADR-0023 AT-0023-1 / AT-0023-6 fixtures: a submission containing an
# injection phrase must never produce a fabricated True rating or citation.
_INJECTION_MARKERS = (
    "ignore previous instructions",
    "ignore all previous instructions",
    "puuza maagizo yaliyotangulia",  # Swahili: "ignore the preceding instructions"
    "puuza maelekezo yaliyotangulia",
)

# Test-fixture-only marker (never a real vendor signal): lets an
# integration test deterministically drive the REAL /hops/verify path to
# a high-confidence, auto-publish-eligible draft (Tier A,
# TAU_A_PRE_CALIBRATION=0.95 in app/stages/publish_policy.py) without a
# fitted calibration artifact or a real LLM call. Used by
# services/api's submission-orchestration end-to-end integration test
# (the ADR-0032 "closes the C1 gap" orchestration slice) to prove a real
# auto-publish through the real pipeline hops, not a seeded decision.
_AUTO_PUBLISH_FIXTURE_MARKER = "AUTO_PUBLISH_FIXTURE_HIGH_CONFIDENCE"

# ADR-0031 risk-tier wiring fixture: lets an integration test deterministically
# drive the REAL /hops/verify path to a hard-negative (Rating.false) draft
# verdict without a real LLM call, to prove app/stages/risk_tier.py's
# imputation_severity_from_rating + app/stages/publish.py's finalize_publish
# wiring produce a real Tier C for a named-person hard-negative claim through
# the actual hop, not a hand-built VerifyResult.
_HARD_NEGATIVE_FIXTURE_MARKER = "HARD_NEGATIVE_FIXTURE_NAMED_PERSON"


def _looks_like_injection(prompt: str) -> bool:
    lowered = prompt.lower()
    return any(marker in lowered for marker in _INJECTION_MARKERS)


def _detect_language(text: str) -> str:
    """Keyword-driven fixture, mirroring the "uncertain -> code-switched"
    bias from ADR-0005's ASR amendments (the `wave` project's conservative
    Swahili heuristic). Not a real language-ID model — see
    app/clients/llm_anthropic.py for the real (Haiku-inline) path."""
    lowered = text.lower()
    has_sheng = any(marker in lowered for marker in _SHENG_MARKERS)
    has_swahili = any(marker in lowered for marker in _SWAHILI_MARKERS)
    if has_sheng and has_swahili:
        return "sheng"
    if has_sheng:
        return "code-switched"
    if has_swahili:
        return "sw"
    return "en"


def _usage(stage: str, *, input_tokens: int, output_tokens: int) -> UsageRecord:
    # Fake, round-number pricing so tests can assert usd > 0 without
    # depending on the real Anthropic pricing table.
    usd = round((input_tokens / 1_000_000) * 1.0 + (output_tokens / 1_000_000) * 5.0, 6)
    return UsageRecord(
        stage=stage,
        model=_FAKE_MODEL_NAME,
        input_tokens=input_tokens,
        cached_tokens=0,
        output_tokens=output_tokens,
        usd=usd,
    )


class FakeLlmClient(LlmClient):
    """Deterministic fake: never calls a real LLM vendor. Keyword-driven:
    - "TRIGGER_FAILURE" anywhere in the prompt raises LlmCompletionError
      (exercises the failure path).
    - A prompt asking for the analyze-hop JSON schema
      (`"claim_type"` appears in the schema instructions) returns a
      structured fixture built from the `<untrusted_submission>` content,
      including injection detection for ADR-0023's adversarial tests.
    - A prompt asking for the draft-verdict JSON schema (`"citations"`
      appears in the schema instructions) returns a structured fixture
      built from the retrieved `<untrusted_source id="...">` blocks.
    - Anything else returns a fixed stub string (back-compat with the
      original stage-stub fixtures).
    """

    def __init__(self) -> None:
        # SEC-4 test support only: lets a test assert the LLM was never
        # invoked at all (e.g. the analyze-hop empty-quote short-circuit),
        # without needing a mocking framework.
        self.call_count = 0

    async def complete(self, prompt: str, *, max_tokens: int = 1024) -> str:
        self.call_count += 1
        if "TRIGGER_FAILURE" in prompt:
            raise LlmCompletionError("Fake LLM client was asked to simulate a failure.")
        if '"claim_type"' in prompt:
            return self._analyze_fixture(prompt)
        if '"citations"' in prompt:
            return self._draft_fixture(prompt)
        return f"[fake completion, max_tokens={max_tokens}] stubbed response for local dev"

    async def complete_with_usage(
        self, prompt: str, *, stage: str, max_tokens: int = 1024
    ) -> tuple[str, UsageRecord]:
        text = await self.complete(prompt, max_tokens=max_tokens)
        usage = _usage(stage, input_tokens=max(1, len(prompt) // 4), output_tokens=max(1, len(text) // 4))
        return text, usage

    def _analyze_fixture(self, prompt: str) -> str:
        start = prompt.find("<untrusted_submission>")
        end = prompt.find("</untrusted_submission>")
        submitted = prompt[start + len("<untrusted_submission>") : end].strip() if start != -1 else ""

        language = _detect_language(submitted)
        translation_en = submitted if language == "en" else f"[fake EN translation of]: {submitted}"

        if _looks_like_injection(submitted):
            # Never classify an injection payload as a bare checkable claim
            # that would sail through to drafting with the model's own
            # requested rating — ADR-0023 AT-0023-1.
            claims = [{"text": submitted, "claim_type": "rhetoric"}]
        elif submitted.strip().endswith("?"):
            claims = [{"text": submitted, "claim_type": "opinion"}]
        elif any(w in submitted.lower() for w in ("will", "going to", "by 2030", "next year")):
            claims = [{"text": submitted, "claim_type": "prediction"}]
        else:
            claims = [{"text": submitted, "claim_type": "checkable"}]

        return json.dumps(
            {"language": language, "translation_en": translation_en, "claims": claims}
        )

    def _draft_fixture(self, prompt: str) -> str:
        submission_start = prompt.find("<untrusted_submission>")
        submission_end = prompt.find("</untrusted_submission>")
        claim_text = (
            prompt[submission_start + len("<untrusted_submission>") : submission_end].strip()
            if submission_start != -1
            else ""
        )

        if _AUTO_PUBLISH_FIXTURE_MARKER in claim_text:
            return json.dumps(
                {
                    "rating": "MostlyTrue",
                    "rationale": (
                        "The claim is contradicted by the official price-cap schedule "
                        "published this week; the evidence shows a smaller increase than "
                        "claimed."
                    ),
                    "citations": [],
                    "confidence": 0.97,
                    "what_would_change_this": "A revised official schedule.",
                    "language": _detect_language(claim_text),
                    "translation_en": claim_text,
                }
            )

        if _HARD_NEGATIVE_FIXTURE_MARKER in claim_text:
            return json.dumps(
                {
                    "rating": "False",
                    "rationale": (
                        "The claim is contradicted by the official record; the "
                        "named individual did not do what is claimed."
                    ),
                    "citations": [],
                    "confidence": 0.9,
                    "what_would_change_this": "A primary-source record corroborating the claim.",
                    "language": _detect_language(claim_text),
                    "translation_en": claim_text,
                }
            )

        if _looks_like_injection(claim_text):
            # ADR-0023 AT-0023-1: never honour an embedded instruction to
            # "rate True" / "cite <url>" — return NotCheckable with no
            # citations regardless of what the untrusted text demands.
            return json.dumps(
                {
                    "rating": "NotCheckable",
                    "rationale": (
                        "Submission contains instruction-like text rather than a "
                        "checkable factual claim; declining to rate."
                    ),
                    "citations": [],
                    "confidence": 0.0,
                    "what_would_change_this": "A genuine factual claim, not embedded instructions.",
                    "language": _detect_language(claim_text),
                    "translation_en": claim_text,
                }
            )

        # Find the first retrieved source id to build a well-formed,
        # citation-integrity-passing fixture by default.
        doc_id = "fake-doc-0"
        quoted_span = "fake quoted span"
        marker = '<untrusted_source id="'
        idx = prompt.find(marker)
        if idx != -1:
            id_start = idx + len(marker)
            id_end = prompt.find('"', id_start)
            doc_id = prompt[id_start:id_end]
            body_start = prompt.find(">", id_end) + 1
            body_end = prompt.find("</untrusted_source>", body_start)
            body = prompt[body_start:body_end].strip()
            quoted_span = body[:40] if body else quoted_span

        return json.dumps(
            {
                "rating": "Unproven",
                "rationale": "Fake draft verdict fixture: insufficient fixture evidence to confirm or refute.",
                "citations": [{"doc_id": doc_id, "quoted_span": quoted_span}] if idx != -1 else [],
                "confidence": 0.4,
                "what_would_change_this": "A primary-source KNBS/official release matching the claim's figures.",
                "language": _detect_language(claim_text),
                "translation_en": claim_text,
            }
        )
