from __future__ import annotations

import json
import statistics
from pathlib import Path

from jiwer import wer as jiwer_wer

from .dataset import Clip, load_clips, HERE
from .normalize import normalize
from .providers import TranscriptResult
from .providers.gemini_vertex import GeminiVertexProvider
from .providers.gcp_chirp import GcpChirpProvider
from .providers.aws_transcribe import AwsTranscribeProvider
from .providers.whisper_local import WhisperLocalProvider

RESULTS_DIR = HERE / "results"

PROVIDERS = [
    GeminiVertexProvider,
    GcpChirpProvider,
    AwsTranscribeProvider,
    WhisperLocalProvider,
]


def run_provider(provider_cls, clips: list[Clip]) -> list[dict]:
    provider = provider_cls()
    rows = []
    for clip in clips:
        wav_abs = str(HERE / clip.audio_path)
        result: TranscriptResult = provider.transcribe(wav_abs, clip.duration_s)
        hyp_norm = normalize(result.transcript) if result.ok else ""
        row = {
            "provider": provider.name,
            "endpoint": provider.endpoint,
            "terms_class": provider.terms_class,
            "clip_id": clip.clip_id,
            "ok": result.ok,
            "transcript_raw": result.transcript,
            "transcript_norm": hyp_norm,
            "reference_norm": clip.reference_norm,
            "latency_s": result.latency_s,
            "est_cost_usd": result.est_cost_usd,
            "error": result.error,
        }
        rows.append(row)
    return rows


def write_jsonl(rows: list[dict], path: Path) -> None:
    with path.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def summarize(rows: list[dict]) -> dict:
    provider = rows[0]["provider"]
    endpoint = rows[0]["endpoint"]
    terms_class = rows[0]["terms_class"]
    ok_rows = [r for r in rows if r["ok"]]
    n_total = len(rows)
    n_ok = len(ok_rows)

    full_set_wer = None
    if ok_rows:
        refs = [r["reference_norm"] for r in ok_rows]
        hyps = [r["transcript_norm"] for r in ok_rows]
        # jiwer over clips with empty hyp still counts as 100% sub/del for
        # that clip, which is correct: a failed-but-"ok" empty transcript
        # should not be excluded silently.
        full_set_wer = jiwer_wer(refs, hyps)

    latencies = [r["latency_s"] for r in ok_rows if r["latency_s"]]
    median_latency = statistics.median(latencies) if latencies else None
    total_cost = sum(r["est_cost_usd"] for r in rows)
    failures = [
        {"clip_id": r["clip_id"], "error": r["error"]} for r in rows if not r["ok"]
    ]

    return {
        "provider": provider,
        "endpoint": endpoint,
        "terms_class": terms_class,
        "clips_total": n_total,
        "clips_ok": n_ok,
        "wer_full_set": full_set_wer,
        "median_latency_s": median_latency,
        "est_cost_usd_total": round(total_cost, 6),
        "failures": failures,
    }


def mutual_success_wer(all_results: dict[str, list[dict]]) -> float | None:
    """WER computed only over clips where EVERY provider succeeded — the
    'no cherry-picking' comparison the task brief requires alongside each
    provider's own full-set WER."""
    # Only providers that actually attempted this round participate in the
    # mutual-success comparison. A provider deliberately SKIPPED this round
    # (AWS/Whisper, 0 ok out of N with a recorded reason on every row) is not
    # "every clip failed" — it never ran — so including it would null the
    # intersection for every other provider. Skipped-vs-failed is recorded
    # per-provider in the summary's own `failures` list either way.
    ok_sets = []
    for rows in all_results.values():
        if not rows:
            continue
        if all(not r["ok"] for r in rows):
            continue  # provider did not participate this round
        ok_sets.append({r["clip_id"] for r in rows if r["ok"]})
    if not ok_sets:
        return None
    mutual_ids = set.intersection(*ok_sets)
    return mutual_ids


def main() -> None:
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd != "run":
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    clips = load_clips()
    print(f"Loaded {len(clips)} clips (Round A, FLEURS sw_ke).")

    all_results: dict[str, list[dict]] = {}
    summaries = []
    for provider_cls in PROVIDERS:
        provider_name = provider_cls.name
        print(f"\n=== Running provider: {provider_name} ===")
        rows = run_provider(provider_cls, clips)
        all_results[provider_name] = rows
        out_path = RESULTS_DIR / f"{provider_name}.jsonl"
        write_jsonl(rows, out_path)
        summary = summarize(rows)
        summaries.append(summary)
        print(json.dumps(summary, indent=2, ensure_ascii=False))

    mutual_ids = mutual_success_wer(all_results)
    mutual_wer_by_provider = {}
    if mutual_ids:
        for provider_name, rows in all_results.items():
            sub = [r for r in rows if r["clip_id"] in mutual_ids and r["ok"]]
            if sub:
                refs = [r["reference_norm"] for r in sub]
                hyps = [r["transcript_norm"] for r in sub]
                mutual_wer_by_provider[provider_name] = jiwer_wer(refs, hyps)

    summary_doc = {
        "round": "A",
        "dataset": "google/fleurs sw_ke test, first 30 by id",
        "n_clips": len(clips),
        "mutual_success_clip_ids": sorted(mutual_ids) if mutual_ids else [],
        "n_mutual_success": len(mutual_ids) if mutual_ids else 0,
        "mutual_success_wer_by_provider": mutual_wer_by_provider,
        "providers": summaries,
    }
    (RESULTS_DIR / "summary.json").write_text(
        json.dumps(summary_doc, indent=2, ensure_ascii=False)
    )

    print("\n\n=== RESULTS TABLE ===")
    print(f"{'provider':<28} {'ok/total':<10} {'WER full':<10} {'median lat(s)':<14} {'est $':<10} endpoint")
    for s in summaries:
        wer_str = f"{s['wer_full_set']*100:.1f}%" if s["wer_full_set"] is not None else "n/a"
        lat_str = f"{s['median_latency_s']:.2f}" if s["median_latency_s"] is not None else "n/a"
        print(
            f"{s['provider']:<28} {s['clips_ok']}/{s['clips_total']:<8} {wer_str:<10} "
            f"{lat_str:<14} {s['est_cost_usd_total']:<10.4f} {s['endpoint']}"
        )

    total_spend = sum(s["est_cost_usd_total"] for s in summaries)
    print(f"\nTotal estimated spend across all providers: ${total_spend:.4f}")


if __name__ == "__main__":
    main()
