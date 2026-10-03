"""Config assertions (ADR-0005 AT-0005-3): no production code path may call
an unpaid-tier Gemini/AI-Studio endpoint. `generativelanguage.googleapis.com`
is the AI-Studio free-tier host; this pipeline uses Anthropic (Claude) for
all LLM calls and the Fact Check Tools API
(`factchecktools.googleapis.com`, a distinct, paid/API-key-gated Google API)
for retrieval — never Gemini/AI-Studio.

`assert_no_unpaid_gemini_usage` is called at process startup (app/main.py)
so a future accidental import of a Gemini client fails fast instead of
silently incurring the free-tier's "we read your prompts" policy
(ADR-0005's "Free-tier terms: verified, and prohibitive" section).
scripts/at/at-0005.sh additionally greps the whole app/ tree for the
forbidden host as a static, CI-enforced backstop.
"""

from __future__ import annotations

import sys

FORBIDDEN_UNPAID_HOST = "generativelanguage.googleapis.com"


class UnpaidGeminiUsageError(Exception):
    """Raised if a forbidden unpaid-tier host is detected in a loaded
    module's source — see assert_no_unpaid_gemini_usage."""


def assert_no_unpaid_gemini_usage() -> None:
    """Runtime config assertion: scans already-imported `app.*` modules'
    source for the forbidden host string. This is a defense-in-depth
    backstop alongside the static grep in scripts/at/at-0023.sh — neither
    alone is sufficient (this one only catches modules already imported by
    the time it runs; the grep catches everything in the tree regardless
    of import order)."""
    for name, module in list(sys.modules.items()):
        if not name.startswith("app.") or name == __name__:
            # app.config itself is the one legitimate, documented
            # occurrence of the literal host string (the constant
            # everything else imports and compares against) — see this
            # module's docstring.
            continue
        source_file = getattr(module, "__file__", None)
        if not source_file:
            continue
        try:
            with open(source_file, encoding="utf-8") as f:
                contents = f.read()
        except OSError:
            continue
        if FORBIDDEN_UNPAID_HOST in contents:
            raise UnpaidGeminiUsageError(
                f"module {name} ({source_file}) references the forbidden unpaid-tier "
                f"host {FORBIDDEN_UNPAID_HOST!r} — see ADR-0005's free-tier terms section"
            )
