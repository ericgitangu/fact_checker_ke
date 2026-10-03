"""Round A dataset builder: 30 clips from google/fleurs `sw_ke` test split.

Deterministic selection: first 30 rows by dataset id (the `id` field FLEURS
assigns, stable across loads of the same split/revision). Clips are public
read-speech recordings with reference transcripts, released under CC-BY-4.0
by Google — not user content, so eval use is compliant per ADR-0005's
unpaid/eval-vs-production data-terms split.

Writes:
  eval/asr/.data/clips/<id>.wav   (gitignored — raw audio, not committed)
  eval/asr/.data/manifest.json    (gitignored — local working copy)
  eval/asr/results/manifest.json  (COMMITTED — ids, text, provenance; no audio)
"""
from __future__ import annotations

import io
import json
from dataclasses import dataclass, asdict
from pathlib import Path

import soundfile as sf

from .normalize import normalize

HERE = Path(__file__).resolve().parent.parent
DATA_DIR = HERE / ".data"
CLIPS_DIR = DATA_DIR / "clips"
RESULTS_DIR = HERE / "results"
N_CLIPS = 30


@dataclass
class Clip:
    clip_id: str
    index: int
    audio_path: str
    reference_raw: str
    reference_norm: str
    sampling_rate: int
    duration_s: float


def build_round_a(n: int = N_CLIPS) -> list[Clip]:
    """Load FLEURS sw_ke test split, take the first `n` rows by id, write
    wav files + manifest. Idempotent: skips re-download/re-write if the
    manifest already has n entries and every wav file exists.
    """
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = DATA_DIR / "manifest.json"

    if manifest_path.exists():
        existing = json.loads(manifest_path.read_text())
        if len(existing) >= n and all(
            (CLIPS_DIR / f"{c['clip_id']}.wav").exists() for c in existing[:n]
        ):
            return [Clip(**c) for c in existing[:n]]

    from datasets import load_dataset, Audio

    ds = load_dataset("google/fleurs", "sw_ke", split="test")
    # Decode=False: read raw audio bytes ourselves via soundfile instead of
    # the datasets library's audio decoder, which requires the heavy
    # torchcodec/torch stack (confirmed empirically: decode=True raises
    # `ImportError: please install 'torchcodec'` on a bare `datasets` +
    # `soundfile` install). FLEURS ships WAV bytes directly, so this is a
    # lighter path with identical audio.
    ds = ds.cast_column("audio", Audio(decode=False))
    # FLEURS's `id` field is a SENTENCE id, not a unique row id -- verified
    # empirically: id=1662 has two rows with identical `raw_transcription`
    # but two different audio files (different speakers reading the same
    # sentence), and 175/487 ids in this split repeat this way. Naively
    # sorting-by-id and taking the first 30 rows collided on clip_id for 11
    # of them, which silently overwrote the first recording's wav file with
    # the second's before any provider read it -- caught by a WER sanity
    # check post-run, not assumed away.
    # Fix: take the first row (lowest original dataset index, so still
    # deterministic) for each DISTINCT id, ascending by id, first n ids.
    first_row_for_id: dict[int, int] = {}
    for i in range(len(ds)):
        rid = ds[i]["id"]
        if rid not in first_row_for_id:
            first_row_for_id[rid] = i
    ids_sorted = [first_row_for_id[rid] for rid in sorted(first_row_for_id)[:n]]

    clips: list[Clip] = []
    for rank, row_idx in enumerate(ids_sorted):
        row = ds[row_idx]
        clip_id = f"fleurs_sw_ke_{row['id']:05d}"
        audio_bytes = row["audio"]["bytes"]
        array, sampling_rate = sf.read(io.BytesIO(audio_bytes))
        wav_path = CLIPS_DIR / f"{clip_id}.wav"
        sf.write(str(wav_path), array, sampling_rate)
        # `raw_transcription` keeps real capitalisation/punctuation (FLEURS's
        # own `transcription` field is already lowercased/depunctuated,
        # which would hide our normaliser's behaviour) -- we apply the
        # documented normalize() ourselves identically to every hypothesis.
        ref_raw = row["raw_transcription"]
        duration_s = len(array) / sampling_rate
        clips.append(
            Clip(
                clip_id=clip_id,
                index=rank,
                audio_path=str(wav_path.relative_to(HERE)),
                reference_raw=ref_raw,
                reference_norm=normalize(ref_raw),
                sampling_rate=sampling_rate,
                duration_s=round(duration_s, 3),
            )
        )

    manifest_path.write_text(json.dumps([asdict(c) for c in clips], indent=2, ensure_ascii=False))

    # Committed copy: ids + text + duration, no audio. Also records the
    # Round A/B gap explicitly (ADR-0005 AT-0005-1 stays RED on this round).
    committed = {
        "round": "A",
        "dataset": "google/fleurs config=sw_ke split=test",
        "licence": "CC-BY-4.0 (public read-speech, reference transcripts; not user content)",
        "selection": (
            "first N distinct FLEURS `id` values (ascending), one row per id "
            "(lowest original dataset index on ties) -- `id` is a sentence id, "
            "not a unique row id: 175/487 ids in this split have >1 recording "
            "(different speakers reading the same sentence), confirmed "
            "empirically after an initial naive sort-by-id run silently "
            "collided clip_ids and overwrote wav files for 11 of 30 clips"
        ),
        "n_clips": len(clips),
        "normaliser": "lowercase, strip punctuation, collapse whitespace, NFC (asr_eval/normalize.py)",
        "coverage_gap": (
            "Round A is CLEAN READ SPEECH ONLY. It contains 0 Sheng/code-switched "
            "and 0 noisy/crowd clips. AT-0005-1 requires >=10 of each and stays RED "
            "until Round B (Bunge/Citizen TV/creator TikTok clips) is built."
        ),
        "clips": [
            {
                "clip_id": c.clip_id,
                "reference_raw": c.reference_raw,
                "reference_norm": c.reference_norm,
                "duration_s": c.duration_s,
            }
            for c in clips
        ],
    }
    (RESULTS_DIR / "manifest.json").write_text(
        json.dumps(committed, indent=2, ensure_ascii=False)
    )

    return clips


def load_clips(n: int = N_CLIPS) -> list[Clip]:
    manifest_path = DATA_DIR / "manifest.json"
    if not manifest_path.exists():
        return build_round_a(n)
    existing = json.loads(manifest_path.read_text())
    return [Clip(**c) for c in existing[:n]]
