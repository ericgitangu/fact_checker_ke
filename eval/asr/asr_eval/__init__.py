"""ADR-0005 ASR WER benchmark harness — Round A (FLEURS sw_ke, clean read speech).

Self-contained uv project. See docs/adr/0005-speech-and-language.md,
section "WER Round A results (2026-10-03)" for the gate this harness serves:
lowest WER on the eval set wins; >25% WER on the noisy subset disqualifies.

Round A is the CLEAN benchmark only (FLEURS = read speech, studio quality).
It does NOT satisfy AT-0005-1 (which requires >=10 Sheng/code-switched and
>=10 noisy clips) — that gap is recorded explicitly in manifest.json and in
the ADR append, not hidden.
"""
