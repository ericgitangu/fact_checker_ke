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
    StratifiedCalibrationArtifact,
    apply_calibration,
    compute_ece,
    fit_stratified_calibration,
    write_stratified_calibration_artifact,
)
from app.models.enums import Rating
from app.protocols.corroboration import CorroborationError
from app.stages.citation_guard import RetrievedDoc
from app.stages.corroboration import BOUNDARY_BAND, stance_from_rating
from app.stages.publish import STRATIFIED_CALIBRATION_ARTIFACT_PATH
from app.stages.publish_policy import TAU_A_PRE_CALIBRATION
from app.stages.verify import _draft_once

# Release-gate bars (ADR-0023 eval-gate discipline). ECE_MAX: the agree stratum
# must be reasonably calibrated. The non-saturation check below rejects a
# degenerate isotonic fit that maps the BOTTOM of the boundary band straight to
# ~1.0 (which would auto-publish any mid-confidence agreed draft, not only
# genuinely high-confidence ones) — a real failure mode on small, bimodally-
# distributed confidence data.
ECE_MAX = 0.15

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
    samples: list[tuple[float, str, bool]], *, min_per_stratum: int
) -> tuple[StratifiedCalibrationArtifact, dict[str, object], bool]:
    by_stratum: dict[str, list[tuple[float, bool]]] = {"agree": [], "disagree": [], "baseline": []}
    for conf, agreement, correct in samples:
        by_stratum["baseline"].append((conf, correct))
        if agreement in ("agree", "disagree"):
            by_stratum[agreement].append((conf, correct))

    artifact = fit_stratified_calibration(by_stratum, min_per_stratum=min_per_stratum)

    agree_acc = (
        sum(1 for _, c in by_stratum["agree"] if c) / len(by_stratum["agree"]) if by_stratum["agree"] else 0.0
    )
    base_acc = (
        sum(1 for _, c in by_stratum["baseline"] if c) / len(by_stratum["baseline"])
        if by_stratum["baseline"]
        else 0.0
    )
    agree_fitted = "agree" in artifact.by_stratum
    agree_ece = compute_ece(by_stratum["agree"]) if by_stratum["agree"] else 1.0
    # Non-saturation: the agree curve at the BOTTOM of the boundary band
    # (threshold - BOUNDARY_BAND) must stay BELOW the auto-publish threshold, so
    # only genuinely high-confidence agreed drafts can be lifted across — a
    # saturated "everything -> 1.0" curve is rejected.
    band_floor = TAU_A_PRE_CALIBRATION - BOUNDARY_BAND
    agree_at_floor = (
        apply_calibration(artifact.by_stratum["agree"], band_floor) if agree_fitted else 1.0
    )
    not_saturated = agree_at_floor < TAU_A_PRE_CALIBRATION

    report = {
        "agree": _stratum_report(by_stratum["agree"]),
        "disagree": _stratum_report(by_stratum["disagree"]),
        "baseline": _stratum_report(by_stratum["baseline"]),
        "agree_fitted": agree_fitted,
        "agree_ece": round(agree_ece, 3),
        "agree_cal_at_band_floor": round(agree_at_floor, 3),
        "agree_minus_baseline_correct": round(agree_acc - base_acc, 3),
    }
    # Release gate (ADR-0036 hybrid C, provisional pilot): ALL must hold —
    #  (1) agree fitted (>= min_per_stratum) and a baseline fallback exists,
    #  (2) a positive measured correctness lift over baseline,
    #  (3) agree stratum reasonably calibrated (ECE <= ECE_MAX),
    #  (4) the agree curve is NOT saturated (does not auto-credit mid-confidence).
    gate_clears = (
        agree_fitted
        and "baseline" in artifact.by_stratum
        and agree_acc > base_acc
        and agree_ece <= ECE_MAX
        and not_saturated
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
    print(f"  agree_fitted={report['agree_fitted']}  agree_ece={report['agree_ece']} "
          f"(max {ECE_MAX})  agree_cal@band_floor={report['agree_cal_at_band_floor']} "
          f"(must be < {TAU_A_PRE_CALIBRATION})  lift={report['agree_minus_baseline_correct']:+}")
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
