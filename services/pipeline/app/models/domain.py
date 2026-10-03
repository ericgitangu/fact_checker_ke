"""Pydantic v2 models for the pipeline, built on the generated contracts.

`Claim` and `Source` are re-exported as-is from app/models/generated.py
(itself generated from packages/core's zod schemas by `pnpm gen:contracts`)
— they need no pipeline-specific behaviour.

`SubmissionInput` is NOT re-exported as-is. JSON Schema (and therefore the
generated model) cannot express zod's `.refine()` calls — see the "KNOWN
GAP" comment in packages/core/scripts/export-json-schema.ts for the
empirical check that confirms refinements are silently dropped, never
errored, by `z.toJSONSchema`. The two refinements on
`SubmissionInputSchema` are load-bearing (they're the only thing stopping a
submission from being simultaneously empty and ambiguous), so they are
hand-mirrored here as Pydantic `model_validator`s on a subclass of the
generated model — NOT inside generated.py, which is overwritten on every
regeneration and must stay mechanical.

`WaitlistSignupInput` is also NOT re-exported as-is, but for a tooling bug
rather than an expressiveness gap: `source` is `z.enum([...]).default("site")`
in packages/core, and `datamodel-code-generator` resolves its `$ref` type
correctly (`WaitlistSource | None`) but emits the *raw JSON* default literal
(`= 'site'`) instead of the enum member (`= WaitlistSource.site`) — a type
mismatch mypy strict rejects. See the `stripRefSiblingDefaults` comment in
packages/core/scripts/export-json-schema.ts for the empirical check. The
export script strips the bogus default before it reaches
datamodel-code-generator (so generated.py's field is simply
`= None`, which mypy accepts); the real default is restored here, typed
correctly.

`DraftVerdict` has no zod/core equivalent: it is the pipeline's own
in-flight shape for a not-yet-persisted verdict (no `id`, no
`submissionId`, no `isDraft`/`publishedAt` — those only exist once a `Check`
row is created by services/api), so it stays hand-written, built out of the
same generated `Rating`/`Claim`/`Source` types as everything else.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.generated import Claim, Rating, Source, WaitlistSource
from app.models.generated import SubmissionInput as _GeneratedSubmissionInput
from app.models.generated import WaitlistSignupInput as _GeneratedWaitlistSignupInput

__all__ = [
    "Claim",
    "DraftVerdict",
    "Source",
    "SubmissionInput",
    "WaitlistSignupInput",
]


class SubmissionInput(_GeneratedSubmissionInput):
    """`SubmissionInput` with the two zod `.refine()` constraints restored.

    Mirrors packages/core/src/schemas/submission.ts exactly:
      1. Exactly one of `url` / `text` must be present.
      2. `quote` / `timestamp_sec` only apply to a `url` submission.
    """

    @model_validator(mode="after")
    def _check_exactly_one_of_url_or_text(self) -> SubmissionInput:
        if bool(self.url) == bool(self.text):
            raise ValueError("Provide exactly one of `url` or `text`.")
        if self.text and (self.quote or self.timestamp_sec is not None):
            raise ValueError("`quote`/`timestamp_sec` only apply to `url` submissions.")
        return self


class WaitlistSignupInput(_GeneratedWaitlistSignupInput):
    """`WaitlistSignupInput` with the real, correctly-typed `source` default.

    packages/core's `source: WaitlistSourceSchema.default("site")` means a
    caller may omit `source`; the generated model allows that (field is
    `WaitlistSource | None = None`) but doesn't know the *value* should be
    `"site"` when omitted — see the module docstring for why that default
    is stripped before code generation. This subclass restores it.
    """

    source: WaitlistSource = WaitlistSource.site


class DraftVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=4000)
    rating: Rating | None = None
    claims: list[Claim] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
