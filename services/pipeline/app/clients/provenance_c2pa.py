"""Real ProvenanceChecker: local C2PA manifest read via the `c2pa` python
lib (c2pa-python, MIT/Apache-2.0 per ADR-0006 round-2 evidence).

This is NOT a "live vendor call" under the task's HARD RULES: `c2pa.Reader`
parses an embedded JUMBF manifest out of already-in-process media bytes —
no network request, no API key, no vendor account. It installed cleanly
(`uv add c2pa-python`, verified 2026-10-03: resolved/built/installed with
no native-toolchain failures), so per the task brief ("via the `c2pa`
python lib if it installs cleanly, else a documented stub") this is the
real implementation, wired as the default (see provenance_factory.py) —
`FakeProvenanceChecker` remains available for fully offline/deterministic
tests.

Empirically verified behaviour (2026-10-03, local only, no network):
- A PNG with no embedded manifest raises `c2pa.c2pa.C2paError` with a
  `ManifestNotFound` subtype ("no JUMBF data found") — NOT "no manifest",
  which would be ambiguous with a read failure. This is the common case
  (ADR-0006: most reposted/screenshotted media carries none) and maps to
  `ProvenanceResult(present=False, ...)`, never an exception bubbling to
  the caller.
- Any other `C2paError` (corrupt manifest, unsupported container) is
  re-raised as `ProvenanceCheckError` — an expected failure mode distinct
  from "no manifest".
"""

from __future__ import annotations

import io
import json
from typing import Any

from app.protocols.provenance import ProvenanceChecker, ProvenanceCheckError, ProvenanceResult


class C2paProvenanceChecker(ProvenanceChecker):
    def check(self, media_bytes: bytes, *, mime_type: str) -> ProvenanceResult:
        import c2pa  # local import: keeps the (optional, if absent) dependency

        try:
            reader = c2pa.Reader(mime_type, io.BytesIO(media_bytes))
        except c2pa.C2paError as exc:
            if "ManifestNotFound" in type(exc).__name__ or "no JUMBF data found" in str(exc):
                return ProvenanceResult(present=False, validated=False, ai_generated=False)
            raise ProvenanceCheckError(f"C2PA manifest read failed: {exc}") from exc
        except Exception as exc:  # pragma: no cover - defensive, not expected in practice
            raise ProvenanceCheckError(f"C2PA manifest read failed: {exc}") from exc

        try:
            manifest_json = reader.json()
            manifest: dict[str, Any] = json.loads(manifest_json) if manifest_json else {}
            validation_state = reader.get_validation_state()
        except Exception as exc:
            raise ProvenanceCheckError(f"C2PA manifest parse failed: {exc}") from exc
        finally:
            reader.close()

        validated = str(validation_state).lower() in ("valid", "c2pavalidationstate.valid")
        ai_generated = _manifest_claims_ai_generated(manifest)
        return ProvenanceResult(present=True, validated=validated, ai_generated=ai_generated)


def _manifest_claims_ai_generated(manifest: dict[str, Any]) -> bool:
    """Best-effort read of the C2PA `digitalSourceType` assertion
    (c2pa.org/specifications): a trainedAlgorithmicMedia /
    compositeWithTrainedAlgorithmicMedia source type is the manifest's own
    declaration of AI generation/editing — this is signal #1 in ADR-0006's
    ordered list, distinct from (and higher-confidence than) any detector
    score (signal #4)."""
    manifests = manifest.get("manifests", {})
    active_id = manifest.get("active_manifest")
    active = manifests.get(active_id, {}) if active_id else next(iter(manifests.values()), {})
    for assertion in active.get("assertions", []):
        label = assertion.get("label", "")
        if "actions" not in label:
            continue
        data = assertion.get("data", {})
        for action in data.get("actions", []):
            source_type = str(action.get("digitalSourceType", ""))
            if "trainedAlgorithmicMedia" in source_type:
                return True
    return False
