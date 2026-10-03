"""AT-0005-3: no production code path can call an unpaid-tier Gemini/
AI-Studio endpoint. Config test asserts the forbidden host is absent from
the loaded app modules; scripts/at/at-0005.sh additionally greps the whole
tree as a static, import-order-independent backstop."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from app.config import FORBIDDEN_UNPAID_HOST, assert_no_unpaid_gemini_usage


def test_forbidden_host_is_the_documented_ai_studio_free_tier_host() -> None:
    assert FORBIDDEN_UNPAID_HOST == "generativelanguage.googleapis.com"


def test_assert_no_unpaid_gemini_usage_passes_on_current_app_modules() -> None:
    # Every app.* module already imported by the test session (main.py,
    # clients, stages, ...) must not reference the forbidden host.
    assert_no_unpaid_gemini_usage()  # must not raise


def test_factcheck_client_host_is_not_the_forbidden_ai_studio_host() -> None:
    from app.clients import factcheck_api

    assert FORBIDDEN_UNPAID_HOST not in factcheck_api._BASE_URL
    assert "factchecktools.googleapis.com" in factcheck_api._BASE_URL


def test_static_grep_backstop_finds_no_forbidden_host_in_app_tree() -> None:
    # Mirrors scripts/at/at-0005.sh's CI-enforced grep, runnable from
    # pytest too so this specific AT has its own test, not only a shell
    # script. app/config.py is the one legitimate, allow-listed occurrence
    # (it defines the constant everything else imports and compares
    # against) — see its module docstring.
    app_dir = Path(__file__).resolve().parents[1] / "app"
    allowed_file = app_dir / "config.py"
    result = subprocess.run(
        ["grep", "-rl", "--include=*.py", FORBIDDEN_UNPAID_HOST, str(app_dir)],
        capture_output=True,
        text=True,
        check=False,  # grep's exit code 1 (no matches) is an expected, not erroneous, outcome
    )
    matched_files = {line for line in result.stdout.splitlines() if line}
    unexpected = matched_files - {str(allowed_file)}
    assert not unexpected, f"forbidden host found outside config.py in: {unexpected}"
    assert sys.version_info >= (3, 12)  # sanity: this test targets py3.12+
