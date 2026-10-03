"""Eval harness scaffold (ADR-0004/0023/0005).

`uv run python -m app.eval` runs the starter JSONL fixture set (20 claims:
8 en / 7 sw / 5 sheng-codeswitched, labelled checkable/opinion) through the
real claim-detection prompt path (FakeLlmClient backend by default, a real
Anthropic client if ANTHROPIC_API_KEY is set) and prints precision/recall/F1
per class.

This is a scaffold, not the full gate: ADR-0004 AT-0004-E and ADR-0023 §5
call for a 100-claim set with >=30 Sheng items and an agreed F1 threshold
before launch — that full set stays an explicit open AT (not faked here).
"""

from __future__ import annotations

import asyncio
import json
import sys
from collections import defaultdict
from pathlib import Path

from app.clients.llm_anthropic import make_llm_client
from app.models.hop_requests import AnalyzeHopRequest, HopContent
from app.stages.analyze import run_analyze_hop
from app.stages.idempotency import InMemoryIdempotencyStore

FIXTURES_PATH = Path(__file__).resolve().parent / "fixtures" / "claims.jsonl"

# Only classes the starter fixture set actually labels. ADR-0004's full
# taxonomy (checkable|opinion|prediction|rhetoric) is unchanged; precision/
# recall against predicted labels outside this set simply show up as
# false positives/negatives for whichever class they were predicted as.
LABELS = ("checkable", "opinion", "prediction", "rhetoric")


async def _classify(text: str, llm: object) -> str:
    req = AnalyzeHopRequest(
        submission_id="eval",
        org_id="eval",
        content=HopContent(text=text),
    )
    result = await run_analyze_hop(req, llm=llm, store=InMemoryIdempotencyStore())  # type: ignore[arg-type]
    if not result.claims:
        return "unknown"
    return result.claims[0].claim_type.value


def _load_fixtures() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with FIXTURES_PATH.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _prf1(true_positive: int, false_positive: int, false_negative: int) -> tuple[float, float, float]:
    precision = true_positive / (true_positive + false_positive) if (true_positive + false_positive) else 0.0
    recall = true_positive / (true_positive + false_negative) if (true_positive + false_negative) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return precision, recall, f1


async def main() -> int:
    llm = make_llm_client(is_sonnet=False)
    rows = _load_fixtures()

    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    lang_counts: dict[str, int] = defaultdict(int)
    correct = 0

    for row in rows:
        predicted = await _classify(row["text"], llm)
        actual = row["label"]
        lang_counts[row["lang"]] += 1
        if predicted == actual:
            counts[actual]["tp"] += 1
            correct += 1
        else:
            counts[predicted]["fp"] += 1
            counts[actual]["fn"] += 1

    print(f"Eval set: {len(rows)} claims ({dict(lang_counts)})")
    print(f"{'class':<12}{'precision':>10}{'recall':>10}{'f1':>10}")
    for label in LABELS:
        c = counts[label]
        precision, recall, f1 = _prf1(c["tp"], c["fp"], c["fn"])
        print(f"{label:<12}{precision:>10.2f}{recall:>10.2f}{f1:>10.2f}")
    print(f"\nOverall accuracy: {correct}/{len(rows)} = {correct / len(rows):.2%}")
    print(
        "\nNOTE: this is a 20-claim starter scaffold. ADR-0004 AT-0004-E / "
        "ADR-0023 §5 require a 100-claim set with >=30 Sheng items and an "
        "agreed F1 threshold before launch — that remains an open AT, not "
        "faked here."
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
