"""Live smoke test: a 2-sentence Swahili claim through the analyze hop with
the real Anthropic Haiku-4.5-class model. Marked `@pytest.mark.live` so it
is skipped (with a stated reason) when ANTHROPIC_API_KEY is absent from the
environment, and only runs for real when the key is present.

Verified empirically (task brief instruction): `gcloud secrets versions
access latest --secret=fact-checker-ke-anthropic-api-key
--project=master-crossing-435409-r1` returned NOT_FOUND at the time this
change was authored (no version of that secret exists yet in GCP Secret
Manager), so ANTHROPIC_API_KEY is also absent from this process's
environment. This test is therefore skipped in this environment; nothing
about its pass/fail here is asserted or faked.
"""

from __future__ import annotations

import os

import pytest

from app.clients.llm_anthropic import AnthropicClient
from app.models.hop_requests import AnalyzeHopRequest, HopContent
from app.stages.analyze import run_analyze_hop
from app.stages.idempotency import InMemoryIdempotencyStore

pytestmark = pytest.mark.live

_SKIP_REASON = (
    "ANTHROPIC_API_KEY not set (gcloud secrets versions access for "
    "fact-checker-ke-anthropic-api-key returned NOT_FOUND at authoring time) "
    "-- live Anthropic smoke test skipped, all other tests run on fakes."
)


@pytest.mark.skipif(not os.environ.get("ANTHROPIC_API_KEY"), reason=_SKIP_REASON)
async def test_live_analyze_hop_with_real_haiku_on_swahili_claim() -> None:
    req = AnalyzeHopRequest(
        submission_id="live-smoke-1",
        org_id="live-smoke",
        content=HopContent(
            text="Serikali imesema bei ya mafuta itapungua mwezi ujao. Hii ni habari njema kwa wananchi."
        ),
    )
    result = await run_analyze_hop(
        req, llm=AnthropicClient(is_sonnet=False), store=InMemoryIdempotencyStore()
    )
    assert result.claims  # structured output parsed into at least one claim
    assert result.usage.input_tokens > 0
    assert result.usage.output_tokens > 0
    assert result.usage.usd > 0
    assert result.usage.usd < 0.01  # cost ceiling per the task brief
    print(f"\nLIVE SMOKE RESULT: {result.model_dump()}")
