"""End-to-end test for POST /hops/fetch via the real FastAPI app wiring
(app/main.py) -- confirms the module-level `_fetch_sources` wiring (built
from env at import time, with no platform keys set in the test
environment) and the FETCH_ENGINE_ENABLED kill-switch, both through the
real HTTP route, not a unit call into run_fetch_hop directly."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_hop_fetch_runs_on_fakes_and_returns_zero_candidates_by_default() -> None:
    # No platform keys are set in the test environment, so app.main's
    # module-level _fetch_sources are all FakeFetchSource with empty
    # fixtures -- the real, safe-by-default endpoint behavior.
    res = client.post("/hops/fetch", json={"org_id": "org-1"})
    assert res.status_code == 200
    body = res.json()
    assert body["candidates_observed"] == 0
    assert body["emitted_submission_ids"] == []


def test_hop_fetch_kill_switch_short_circuits(monkeypatch) -> None:
    monkeypatch.setenv("FETCH_ENGINE_ENABLED", "false")
    res = client.post("/hops/fetch", json={"org_id": "org-1"})
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "candidates_observed": 0,
        "duplicate_platform_item_skipped": 0,
        "dropped_below_tau": 0,
        "attached_observation_only": 0,
        "capped_by_max_emissions": 0,
        "emitted_submission_ids": [],
    }


def test_hop_fetch_rejects_missing_org_id() -> None:
    res = client.post("/hops/fetch", json={})
    assert res.status_code == 422
