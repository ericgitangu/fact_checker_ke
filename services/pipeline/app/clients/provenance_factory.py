"""ProvenanceChecker selection, mirroring embedder_factory.py's pattern.

Unlike the LLM/embedder factories, the real implementation here
(C2paProvenanceChecker) performs NO network call and downloads NO model —
it is a pure local parse of in-process bytes — so it is the default with
no env-gate. `PIPELINE_USE_FAKE_PROVENANCE=1` forces the deterministic fake
(useful for fully hermetic test runs that want to avoid the native c2pa
extension entirely, e.g. in a constrained CI sandbox).
"""

from __future__ import annotations

import os

from app.protocols.provenance import ProvenanceChecker


def make_provenance_checker() -> ProvenanceChecker:
    if os.environ.get("PIPELINE_USE_FAKE_PROVENANCE") == "1":
        from app.fakes.fake_provenance import FakeProvenanceChecker

        return FakeProvenanceChecker()
    from app.clients.provenance_c2pa import C2paProvenanceChecker

    return C2paProvenanceChecker()
