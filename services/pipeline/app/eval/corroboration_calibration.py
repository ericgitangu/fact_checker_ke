"""ADR-0036 Phase-2: fit the per-agreement-stratum calibration from a GOLDEN
set with independent ground truth, so the second-opinion lift is MEASURED (not
synthetic) before any draft is flipped — calibration-before-thresholds.

For each golden claim it runs the REAL path — a Claude draft over real Fact
Check Tools retrieval, plus a grounded Gemini second opinion — and records
`(raw_confidence, agreement_state, correct)` where `correct` compares the
draft's stance to the golden stance. It then fits one isotonic curve per
agreement stratum (reusing app/eval/calibrate.py), reports N + mean-correctness
+ ECE per stratum and the measured agree-vs-baseline lift, and writes the
stratified artifact ONLY when the (configurable) release gate clears.

Run:  uv run python -m app.eval.corroboration_calibration [--min-per-stratum N]
      [--golden PATH] [--out PATH] [--write]
Requires: ANTHROPIC_API_KEY (draft), GOOGLE_FACTCHECK_API_KEY (retrieval; the
fake is used if absent), and a grounded corroboration client (GEMINI key or
GOOGLE_GENAI_USE_VERTEXAI=true + ADC).
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.clients.corroboration_factory import make_corroboration_client
from app.clients.factcheck_api import make_factcheck_client
from app.clients.llm_anthropic import make_llm_client
from app.eval.calibrate import (
    CalibrationArtifact,
    StratifiedCalibrationArtifact,
    compute_ece,
    compute_reliability_curve,
    fit_isotonic_calibration,
    write_stratified_calibration_artifact,
)
from app.models.enums import Rating
from app.protocols.corroboration import CorroborationError
from app.stages.citation_guard import RetrievedDoc
from app.stages.corroboration import stance_from_rating
from app.stages.publish import STRATIFIED_CALIBRATION_ARTIFACT_PATH
from app.stages.publish_policy import TAU_A_PRE_CALIBRATION
from app.stages.verify import _draft_once

# Agreement-gated FLOOR model (ADR-0036 Phase-2). The draft's confidence is
# bimodal, so a full isotonic fit saturates; instead the agree stratum is a
# non-saturating STEP: below the floor -> 0 (runtime `max(baseline, .)` => no
# lift), at/above the floor -> the MEASURED correctness of the
# `agree AND conf >= floor` slice. That measured value must clear both the
# correctness bar AND the Tier-A auto threshold to flip a draft, and the slice
# must have enough samples (min_per_stratum). Disagreement is a flat low curve
# (runtime `min` => lowers). ECE is reported for transparency.
AGREEMENT_FLOOR = 0.90
CORRECTNESS_BAR = 0.95

GOLDEN_PATH = Path(__file__).resolve().parent / "fixtures" / "corroboration_golden.jsonl"


def _load_golden(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


async def _one_sample(
    item: dict[str, str], *, llm: object, factcheck: object, corroboration: object
) -> tuple[float, str, bool] | None:
    claim = item["claim_text"]
    lang = item.get("language", "en")
    golden_stance = stance_from_rating(Rating(item["golden_rating"]))

    try:
        hits = await factcheck.search(claim, language_code=lang[:2])  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001 - retrieval is best-effort; fall back to no sources
        hits = []
    retrieved = [RetrievedDoc(doc_id=h.doc_id, text=f"{h.text} — {h.publisher} ({h.review_date})") for h in hits]
    try:
        draft, _usage = await _draft_once(
            claim_text=claim, retrieved=retrieved, llm=llm, named_person_involved=False  # type: ignore[arg-type]
        )
    except Exception as exc:  # noqa: BLE001 - a draft failure drops the sample
        print(f"  [skip] draft failed for {claim[:44]!r}: {exc}", flush=True)
        return None
    if draft.rating is None:
        return None

    draft_stance = stance_from_rating(draft.rating)
    correct = draft_stance == golden_stance
    try:
        gem_stance, cites, _usd = await corroboration.assess(claim_text=claim, language=lang)  # type: ignore[attr-defined]
        agreement = "agree" if gem_stance == draft_stance else "disagree"
    except CorroborationError:
        agreement, cites = "no_second_opinion", []

    print(
        f"  conf={draft.confidence:.2f} draft={draft_stance:11} golden={golden_stance:11} "
        f"{'OK ' if correct else 'ERR'} agree={agreement:17} cites={len(cites)} | {claim[:38]}",
        flush=True,
    )
    return (round(draft.confidence, 4), agreement, correct)


async def collect_samples(
    golden: list[dict[str, str]], *, concurrency: int = 6
) -> list[tuple[float, str, bool]]:
    """(raw_confidence, agreement_state, correct) per golden claim, via the REAL
    draft + grounded corroboration — run with bounded concurrency for speed."""
    llm = make_llm_client(is_sonnet=True)
    factcheck = make_factcheck_client()
    corroboration = make_corroboration_client()
    sem = asyncio.Semaphore(concurrency)

    async def _guarded(item: dict[str, str]) -> tuple[float, str, bool] | None:
        async with sem:
            return await _one_sample(item, llm=llm, factcheck=factcheck, corroboration=corroboration)

    results = await asyncio.gather(*(_guarded(it) for it in golden))
    return [r for r in results if r is not None]


def _stratum_report(samples: list[tuple[float, bool]]) -> str:
    if not samples:
        return "n=0"
    acc = sum(1 for _, c in samples if c) / len(samples)
    ece = compute_ece(samples)
    return f"n={len(samples):3d}  mean_correct={acc:.2f}  ece={ece:.3f}"


def calibrate_and_gate(
    samples: list[tuple[float, str, bool]], *, min_per_stratum: int, floor: float = AGREEMENT_FLOOR
) -> tuple[StratifiedCalibrationArtifact, dict[str, object], bool]:
    by_stratum: dict[str, list[tuple[float, bool]]] = {"agree": [], "disagree": [], "baseline": []}
    for conf, agreement, correct in samples:
        by_stratum["baseline"].append((conf, correct))
        if agreement in ("agree", "disagree"):
            by_stratum[agreement].append((conf, correct))

    by_art: dict[str, CalibrationArtifact] = {}

    # baseline: isotonic fallback (used for no_second_opinion).
    base = by_stratum["baseline"]
    if len(base) >= min_per_stratum:
        by_art["baseline"] = CalibrationArtifact(
            fitted_points=fit_isotonic_calibration(base),
            reliability_curve=compute_reliability_curve(base),
            ece=compute_ece(base),
            n_samples=len(base),
        )

    # agree: non-saturating FLOOR STEP. measured_high = correctness of the
    # flip-relevant slice (agree AND conf >= floor).
    agree_hi = [(c, ok) for c, ok in by_stratum["agree"] if c >= floor]
    measured_high = (sum(1 for _, ok in agree_hi if ok) / len(agree_hi)) if agree_hi else 0.0
    if len(agree_hi) >= min_per_stratum:
        by_art["agree"] = CalibrationArtifact(
            fitted_points=[(0.0, 0.0), (floor, round(measured_high, 4))],
            reliability_curve=[],
            ece=compute_ece(agree_hi),
            n_samples=len(agree_hi),
        )

    # disagree: flat low curve at measured correctness (runtime `min` lowers).
    dis = by_stratum["disagree"]
    dis_acc = (sum(1 for _, ok in dis if ok) / len(dis)) if dis else 0.0
    if len(dis) >= min_per_stratum:
        by_art["disagree"] = CalibrationArtifact(
            fitted_points=[(0.0, round(dis_acc, 4)), (1.0, round(dis_acc, 4))],
            reliability_curve=[],
            ece=compute_ece(dis),
            n_samples=len(dis),
        )

    artifact = StratifiedCalibrationArtifact(by_stratum=by_art)

    report = {
        "agree": _stratum_report(by_stratum["agree"]),
        "disagree": _stratum_report(by_stratum["disagree"]),
        "baseline": _stratum_report(by_stratum["baseline"]),
        "floor": floor,
        "agree_floor_n": len(agree_hi),
        "agree_floor_correct": round(measured_high, 3),
        "agree_floor_ece": round(compute_ece(agree_hi), 3) if agree_hi else 1.0,
    }
    # Release gate (ADR-0036 Phase-2 floor model): ALL must hold —
    #  (1) the flip-relevant slice (agree & conf>=floor) has >= min_per_stratum,
    #  (2) a baseline fallback exists,
    #  (3) that slice's MEASURED correctness clears the bar AND the Tier-A auto
    #      threshold (so it genuinely lifts a draft across) — never a chosen bonus.
    gate_clears = (
        len(agree_hi) >= min_per_stratum
        and "baseline" in by_art
        and measured_high >= CORRECTNESS_BAR
        and measured_high >= TAU_A_PRE_CALIBRATION
    )
    return artifact, report, gate_clears


async def _amain() -> int:
    parser = argparse.ArgumentParser(description="ADR-0036 Phase-2 golden-set corroboration calibration")
    parser.add_argument("--golden", type=Path, default=GOLDEN_PATH)
    parser.add_argument("--out", type=Path, default=STRATIFIED_CALIBRATION_ARTIFACT_PATH)
    parser.add_argument("--min-per-stratum", type=int, default=10, help="provisional pilot bar")
    parser.add_argument("--write", action="store_true", help="write the artifact if the gate clears")
    parser.add_argument("--samples-out", type=Path, default=None, help="save collected samples for free re-gating")
    parser.add_argument("--samples-in", type=Path, default=None, help="re-gate saved samples (no API calls)")
    args = parser.parse_args()

    if args.samples_in:
        samples = [tuple(json.loads(line)) for line in args.samples_in.read_text().splitlines() if line.strip()]
        print(f"Re-gating {len(samples)} saved samples (no API calls).\n")
    else:
        golden = _load_golden(args.golden)
        print(f"Golden set: {len(golden)} claims. Running real draft + grounded corroboration...\n")
        samples = await collect_samples(golden)
        print(f"\nCollected {len(samples)} usable samples.\n")
        if args.samples_out:
            args.samples_out.write_text("\n".join(json.dumps(list(s)) for s in samples), encoding="utf-8")
            print(f"Saved samples -> {args.samples_out}\n")

    artifact, report, gate_clears = calibrate_and_gate(samples, min_per_stratum=args.min_per_stratum)
    print("=== per-stratum ===")
    for k in ("agree", "disagree", "baseline"):
        print(f"  {k:9} {report[k]}")
    print(
        f"  FLIP SLICE  agree & conf>={report['floor']}:  n={report['agree_floor_n']}  "
        f"measured_correct={report['agree_floor_correct']}  ece={report['agree_floor_ece']}  "
        f"(need n>={args.min_per_stratum}, correct>={max(CORRECTNESS_BAR, TAU_A_PRE_CALIBRATION)})"
    )
    print(f"\nRELEASE GATE (min_per_stratum={args.min_per_stratum}): "
          f"{'CLEARS' if gate_clears else 'does NOT clear'}")

    if gate_clears and args.write:
        write_stratified_calibration_artifact(artifact, args.out)
        print(f"\nWROTE stratified artifact -> {args.out}")
        print("Next: deploy the artifact in the image + set CORROBORATION_SHADOW_MODE=false to flip.")
        return 0
    if gate_clears:
        print("\n(gate clears; re-run with --write to persist the artifact)")
        return 0
    print("\nGate did not clear -> NOT writing an artifact. Lift stays 0 (shadow). "
          "Accumulate more labelled samples (golden or live flywheel) and re-run.")
    return 0


def main() -> int:
    return asyncio.run(_amain())


if __name__ == "__main__":
    raise SystemExit(main())
