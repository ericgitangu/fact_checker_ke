"""Extract a JSON object from an LLM response.

Claude Haiku/Sonnet wrap their JSON in markdown code fences
(```json\n{...}\n```) even when the prompt explicitly asks for "no
markdown fences" -- empirically confirmed 2026-10-05 against
claude-haiku-4-5 on the analyze/verify prompts. Naive `json.loads` on
that fails with "Expecting value: line 1 column 1 (char 0)" because the
first character is a backtick. Strip the fence before parsing.

The fake LLM client returns bare JSON, so `strip_code_fences` is a no-op
there -- existing tests are unaffected.
"""

from __future__ import annotations

import re

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*\n?(.*?)\n?```\s*$", re.DOTALL)


def strip_code_fences(raw: str) -> str:
    """Return the inside of a leading/trailing markdown code fence, if the
    whole string is fenced; otherwise the stripped input unchanged."""
    match = _FENCE_RE.match(raw)
    return match.group(1).strip() if match else raw.strip()
