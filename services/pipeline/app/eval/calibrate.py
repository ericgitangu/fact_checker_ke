"""ADR-0031: the calibration harness -- "the first ML engine, not the
last". Raw LLM confidence is NOT calibrated (ADR-0031's decision
section): before any tau gates auto-publish, confidence must be mapped
to true correctness probability via isotonic regression fit on a
held-out eval set, reported as a reliability curve + ECE (Expected
Calibration Error).

Deliberately pure Python (no sklearn/numpy dependency pulled in just for
this): isotonic regression is implemented via the textbook Pool Adjacent
Violators Algorithm (PAVA), which is the exact algorithm sklearn's
`IsotonicRegression` itself uses under the hood. This keeps the harness
network-free and dependency-light, consistent with the task's "no
billable/external calls, rule-based/lightweight" scaffolding rule.

Uses ONLY the committed fixtures in app/eval/fixtures/calibration.jsonl
(21 hand-labeled (raw_confidence, correct) pairs) -- no network, no live
LLM call. A real production re-fit (ADR-0031's "quarterly threshold +
calibration review") would read from the `training_eval_labels` flywheel
table instead (packages/db/src/schema.ts) -- that wiring is a follow-on,
out of scope for this scaffold (see PR description's explicit deviation
note).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

CALIBRATION_FIXTURES_PATH = Path(__file__).resolve().parent / "fixtures" / "calibration.jsonl"


@dataclass(frozen=True)
class ReliabilityBin:
    """One bucket of a reliability curve: among samples whose raw
    confidence fell in this bucket, what fraction were actually correct?
    A well-calibrated model has `mean_predicted_confidence ≈
    empirical_accuracy` in every bucket."""

    bucket_lo: float
    bucket_hi: float
    mean_predicted_confidence: float
    empirical_accuracy: float
    count: int


@dataclass(frozen=True)
class CalibrationArtifact:
    """The calibration artifact `decide_publish_policy` (app/stages/
    publish_policy.py) gates Tier B auto-publish on the PRESENCE of
    (ADR-0031 hard constraint 1). `fitted_points` is the isotonic
    regression's step function, as (raw_confidence, calibrated_confidence)
    knot pairs, sorted by raw_confidence ascending."""

    fitted_points: list[tuple[float, float]]
    reliability_curve: list[ReliabilityBin]
    ece: float
    n_samples: int
    fitted_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())


def _pool_adjacent_violators(xs: list[float], ys: list[float]) -> list[tuple[float, float]]:
    """Isotonic regression via PAVA: fit a monotonically non-decreasing
    step function minimizing squared error against (xs, ys), xs already
    sorted ascending. Returns (x, fitted_y) knot pairs, one per input
    point (adjacent equal-y points belong to the same pooled block).

    Textbook algorithm: maintain a stack of blocks, each block
    `{sum, weight, start_idx, end_idx}` holding a weighted mean. Pool a
    new point into the previous block whenever doing so would otherwise
    produce a decrease (the previous block's mean would exceed the new
    point's value)."""
    blocks: list[dict[str, float]] = []
    for y in ys:
        new_block = {"sum": y, "weight": 1.0, "n": 1}
        blocks.append(new_block)
        while len(blocks) > 1 and (blocks[-2]["sum"] / blocks[-2]["weight"]) > (blocks[-1]["sum"] / blocks[-1]["weight"]):
            prev = blocks.pop()
            blocks[-1]["sum"] += prev["sum"]
            blocks[-1]["weight"] += prev["weight"]
            blocks[-1]["n"] += prev["n"]

    fitted: list[tuple[float, float]] = []
    xi = 0
    for block in blocks:
        mean = block["sum"] / block["weight"]
        n = int(block["n"])
        for _ in range(n):
            fitted.append((xs[xi], mean))
            xi += 1
    return fitted


def _load_fixture_samples(path: Path) -> list[tuple[float, bool]]:
    samples: list[tuple[float, bool]] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            samples.append((float(row["raw_confidence"]), bool(row["correct"])))
    return samples


def fit_isotonic_calibration(samples: list[tuple[float, bool]]) -> list[tuple[float, float]]:
    """Fit isotonic regression mapping raw_confidence -> P(correct),
    returning sorted (raw_confidence, calibrated_confidence) knot pairs."""
    if not samples:
        raise ValueError("fit_isotonic_calibration: samples must be non-empty")
    ordered = sorted(samples, key=lambda s: s[0])
    xs = [x for x, _ in ordered]
    ys = [1.0 if correct else 0.0 for _, correct in ordered]
    return _pool_adjacent_violators(xs, ys)


def apply_calibration(artifact: CalibrationArtifact, raw_confidence: float) -> float:
    """Maps a raw confidence to its calibrated value via the fitted step
    function: the calibrated value at the largest fitted knot <=
    raw_confidence (step-function / right-continuous-from-the-left
    extrapolation), clamped to the first/last knot outside the fitted
    range."""
    points = artifact.fitted_points
    if not points:
        return raw_confidence
    if raw_confidence <= points[0][0]:
        return points[0][1]
    calibrated = points[0][1]
    for x, y in points:
        if x > raw_confidence:
            break
        calibrated = y
    return calibrated


def compute_reliability_curve(samples: list[tuple[float, bool]], n_bins: int = 10) -> list[ReliabilityBin]:
    bins: list[list[tuple[float, bool]]] = [[] for _ in range(n_bins)]
    for confidence, correct in samples:
        idx = min(int(confidence * n_bins), n_bins - 1)
        bins[idx].append((confidence, correct))

    curve: list[ReliabilityBin] = []
    for i, bucket in enumerate(bins):
        if not bucket:
            continue
        mean_conf = sum(c for c, _ in bucket) / len(bucket)
        accuracy = sum(1.0 for _, correct in bucket if correct) / len(bucket)
        curve.append(
            ReliabilityBin(
                bucket_lo=i / n_bins,
                bucket_hi=(i + 1) / n_bins,
                mean_predicted_confidence=mean_conf,
                empirical_accuracy=accuracy,
                count=len(bucket),
            )
        )
    return curve


def compute_ece(samples: list[tuple[float, bool]], n_bins: int = 10) -> float:
    """Expected Calibration Error: the sample-weighted average absolute
    gap between predicted confidence and empirical accuracy across bins
    (standard ECE definition, Guo et al. 2017)."""
    curve = compute_reliability_curve(samples, n_bins=n_bins)
    total = sum(bucket.count for bucket in curve)
    if total == 0:
        return 0.0
    weighted_gap = sum(
        bucket.count * abs(bucket.mean_predicted_confidence - bucket.empirical_accuracy) for bucket in curve
    )
    return weighted_gap / total


def fit_calibration_from_fixtures(path: Path = CALIBRATION_FIXTURES_PATH) -> CalibrationArtifact:
    samples = _load_fixture_samples(path)
    fitted_points = fit_isotonic_calibration(samples)
    reliability_curve = compute_reliability_curve(samples)
    ece = compute_ece(samples)
    return CalibrationArtifact(
        fitted_points=fitted_points,
        reliability_curve=reliability_curve,
        ece=ece,
        n_samples=len(samples),
    )


def write_calibration_artifact(artifact: CalibrationArtifact, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = asdict(artifact)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_calibration_artifact(path: Path) -> CalibrationArtifact | None:
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    return CalibrationArtifact(
        fitted_points=[tuple(p) for p in payload["fitted_points"]],
        reliability_curve=[ReliabilityBin(**b) for b in payload["reliability_curve"]],
        ece=payload["ece"],
        n_samples=payload["n_samples"],
        fitted_at=payload["fitted_at"],
    )


# ADR-0031 amendment (two-engine pivot) / AT-0031-9, AT-0025-7: the
# human-audit sampling rate is a FUNCTION of measured calibration (an
# output), not a hardcoded constant. No calibration artifact at all
# (brand-new pilot) samples EVERYTHING that auto-published; as ECE
# (Expected Calibration Error) falls, the sampled fraction shrinks
# linearly down to a floor; a calibration artifact that REGRESSES
# (degrading ECE) raises the rate back up, symmetrically with the same
# function -- there is no separate "ratchet" that only ever lowers it.
PILOT_AUDIT_SAMPLE_RATE = 1.0
MIN_AUDIT_SAMPLE_RATE = 0.05
MAX_AUDIT_SAMPLE_RATE = 1.0
# ECE at/above this is treated as "pilot-grade" (sample everything);
# placeholder starting value, same tech-debt note as TAU_A/TAU_B in
# app/stages/publish_policy.py -- the real reference point is a
# calibration-harness output from production data, not a number chosen
# here.
AUDIT_SAMPLE_RATE_ECE_REFERENCE = 0.10


def compute_audit_sample_rate(artifact: CalibrationArtifact | None) -> float:
    """Maps a calibration artifact's ECE to a human-audit sampling rate
    in [MIN_AUDIT_SAMPLE_RATE, MAX_AUDIT_SAMPLE_RATE]. `artifact=None`
    (no calibration measured yet) returns `PILOT_AUDIT_SAMPLE_RATE`
    (everything). Monotonic non-decreasing in ECE: a LOWER (better) ECE
    always yields a rate <= a HIGHER (worse) ECE's rate for the same
    function -- "shrinks as calibration proves out, rises as it
    degrades" (AT-0031-9), evaluated fresh against whatever artifact is
    current, not a one-way ratchet.
    """
    if artifact is None or artifact.n_samples == 0:
        return PILOT_AUDIT_SAMPLE_RATE
    normalized_ece = min(artifact.ece / AUDIT_SAMPLE_RATE_ECE_REFERENCE, 1.0)
    rate = MIN_AUDIT_SAMPLE_RATE + (MAX_AUDIT_SAMPLE_RATE - MIN_AUDIT_SAMPLE_RATE) * normalized_ece
    return max(MIN_AUDIT_SAMPLE_RATE, min(MAX_AUDIT_SAMPLE_RATE, rate))


def calibration_artifact_exists(path: Path) -> bool:
    """ADR-0031 hard constraint 1's gate: `decide_publish_policy`
    (app/stages/publish_policy.py) is handed the result of this check as
    its `calibration_present` argument. No artifact on disk at the
    configured path ⇒ Tier B auto-publish is disabled (Tier C is always
    disabled regardless, see publish_policy.py)."""
    return path.exists() and path.stat().st_size > 0


__all__ = [
    "AUDIT_SAMPLE_RATE_ECE_REFERENCE",
    "CALIBRATION_FIXTURES_PATH",
    "MAX_AUDIT_SAMPLE_RATE",
    "MIN_AUDIT_SAMPLE_RATE",
    "PILOT_AUDIT_SAMPLE_RATE",
    "CalibrationArtifact",
    "ReliabilityBin",
    "apply_calibration",
    "calibration_artifact_exists",
    "compute_audit_sample_rate",
    "compute_ece",
    "compute_reliability_curve",
    "fit_calibration_from_fixtures",
    "fit_isotonic_calibration",
    "load_calibration_artifact",
    "write_calibration_artifact",
]
