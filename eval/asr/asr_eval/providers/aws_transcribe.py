"""AWS Transcribe sw-KE — OPTIONAL per the task brief: only run if it costs
no more than ~15 minutes of plumbing (temp S3 bucket, batch job polling).

Decision recorded at harness-build time: SKIPPED for Round A. Reason: AWS
Transcribe's batch API requires an S3 round-trip (upload each clip, start a
TranscriptionJob, poll, fetch JSON result from S3, then tear the bucket
down) per clip, which is materially more plumbing than the two Google paths
for 30 clips within the <15-minute/ <$2 budget guardrails set for this
round. `aws sts get-caller-identity` DID succeed non-interactively (verified
during setup), so this is a scope cut, not an auth failure — Round B can
revisit it if AWS is still in the provider shortlist after Round A.
"""
from __future__ import annotations

from . import TranscriptResult

SKIPPED_REASON = (
    "Round A scope cut: AWS Transcribe batch requires a per-clip S3 "
    "upload/poll/fetch/cleanup round-trip; skipped to stay inside the "
    "15-minute plumbing budget for this round. Auth itself was verified "
    "working (`aws sts get-caller-identity` succeeded)."
)


class AwsTranscribeProvider:
    name = "aws-transcribe-sw-ke"
    endpoint = "SKIPPED (not run this round)"
    terms_class = "n/a — not invoked"

    def transcribe(self, wav_path: str, duration_s: float) -> TranscriptResult:
        clip_id = wav_path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        return TranscriptResult(clip_id=clip_id, ok=False, error=SKIPPED_REASON)
