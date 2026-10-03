# Trademark and badge-use policy

Per [ADR-0026](docs/adr/0026-open-source-boundary-licence.md), the Apache-2.0
licence on this repository covers **code only**. It grants no licence to the
project's name, logo, or verdict badges.

## Reserved

- The name **"fact_checker_ke"** (and any confusingly similar variant —
  `factcheckerke`, `fact-checker-ke`, etc.) as a product or service name.
- Any project logo or wordmark.
- The verdict badge/label set this project issues on a published check
  (e.g. "True" / "Misleading" / "False" / "Unproven" rendered with this
  project's styling, and any "checked by fact_checker_ke" / "verified by
  fact_checker_ke" attribution string).

## What a fork may do

- Fork, modify, and redistribute the **code** under Apache-2.0, including
  commercially, per the licence terms.
- Describe the fork as "based on fact_checker_ke" or "a fork of
  fact_checker_ke" in prose (nominative fair use).

## What a fork may not do

- Present a fork's output as issued by, endorsed by, or affiliated with
  fact_checker_ke.
- Reuse the name, logo, or verdict-badge styling on a deployed instance
  without renaming/rebranding first.
- Use a badge or copy of the form `"fact_checker_ke verified <handle>"` or
  similar — this project's own output never rates accounts or people, only
  dated claims (ADR-0030 AT-0030-5), and a fork carrying the name into that
  framing compounds the exact gaming vector ADR-0008 C-14 and ADR-0030
  exist to close.

## Rationale

This is the same "open code, closed brand" split common to permissively
licensed projects with an editorial reputation to protect: the code is a
portfolio and adoption play (ADR-0026), but the brand is the actual
credibility signal a reader relies on, and that signal must not be
forkable by default.

Questions about trademark use: open an issue, or see
[SECURITY.md](SECURITY.md) for the private contact if the question
involves a live misuse case.
