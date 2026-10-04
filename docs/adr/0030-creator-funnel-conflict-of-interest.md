# ADR-0030: Creator funnel and conflict-of-interest firewall

**Status:** Proposed · **Date:** 2026-10-03

## Problem
ADR-0003 gives the founder's own YouTube/TikTok content funnel one line ("manual, AI disclosure a GAP") with no conflict-of-interest rule. Red-team U7/E11: a monetized founder channel that earns from trending rumours creates a direct incentive about *which* claims get checked and how fast — which breaks ADR-0012 §5's rule ("monetization can never affect which claims get checked or how they are rated") the moment the funnel exists, unless this ADR gives that rule a process and an audit trail instead of leaving it as an aspiration.

## Evidence
- **YouTube** requires disclosure of "realistic altered or synthetic content" — AI voice clones of a real person (even a few seconds), face/deepfake reenactments, and synthetic performances where someone appears to say or do something they didn't. Unrealistic content, animation, and AI-assisted production (scripts, thumbnails, outlines) do **not** require disclosure. The label appears in the description panel, with a more prominent player-level label for sensitive topics **[V: blog.youtube/inside-youtube/our-approach-to-responsible-ai-innovation/]**.
- **TikTok** requires a visible label on content using AI to generate or significantly alter realistic depictions of people, places or events (synthetic faces, voice clones, AI backgrounds, photorealistic products); AI-assisted text (scripts, captions, hashtags) is exempt. TikTok auto-detects and labels content carrying C2PA Content Credentials, and content skipping a required label gets reduced distribution and pre-publication review **[V2-SECONDARY: multiple independent 2026 sources describing the same mechanism — not a vendor primary source, re-check against TikTok's own policy page before relying on it for an edge case]**.
- **YouTube Data API** uploads from an unaudited/unverified API project (any project created after 28 Jul 2020 that hasn't passed Google's compliance audit) are **locked to private and cannot be appealed to public** — only a verified/audited client can publish publicly **[V: developers.google.com/youtube/v3/docs/videos; support.google.com/youtube/answer/7300965]**. This confirms the red-team's flagged claim rather than leaving it at [VERIFY] — **if the founder's channel posts manually (not via this API project), this restriction does not apply**; it only matters if/when the funnel automates publishing.
- **TikTok Content Posting API**: unaudited clients are capped at `SELF_ONLY` visibility and 5 creators/24h; `Direct Post` beyond self-only requires a 2-4 week audit process; `Upload to inbox` (manual publish from the TikTok app after API-assisted draft creation) does **not** require an audit **[V: developers.tiktok.com/doc/content-posting-api-reference-direct-post, corroborated by multiple 2026 guides]**.
- **Net effect, confirming the red-team's [VERIFY] flag:** both platforms' audit gates are real and apply specifically to *automated* posting APIs, not to manual human publishing. The founder's funnel is manual/assisted per ADR-0003 today, so it is unaffected now — but any future move to API-automated publishing must budget 2-4 weeks for a TikTok audit and a Google verification review, and must not assume public-by-default.

## Options
1. **No funnel (founder channels never reference fact_checker_ke checks).** Cleanest conflict-of-interest posture, but forecloses U7 and a real distribution/revenue channel the owner wants.
2. **Funnel draws from anything in the pipeline, published or not, at the founder's discretion.** Rejected — this is exactly the incentive the red-team flags: it lets trending-but-unverified claims drive content decisions, and breaks ADR-0012 §5 with no enforcement mechanism.
3. **Firewall: funnel may only republish already-published (human-approved) checks; selection and rating are produced with no visibility into funnel performance metrics; funnel revenue is disclosed.** Recommended.

## Decision (proposed): Option 3
- **Source restriction:** the founder's channels (YouTube, TikTok, and any future creator surface) may only reference, narrate or build content around checks that already carry a published, human-approved verdict (ADR-0004 step 7's `rating: null`-until-approved gate already creates this boundary — this ADR extends it to the funnel explicitly). A draft, an in-review claim, or a "trending but unchecked" item can never appear in funnel content framed as a fact-check.
- **Editorial independence from funnel metrics:** the editor queue, claim-priority ordering, and dedup/reuse logic (ADR-0004, ADR-0011 §6) must never read funnel view counts, funnel revenue, or "what's trending on the founder's channel" as an input signal. Enforced as a **process rule today** (solo founder, so this is self-discipline, not code) and as a **structural rule once a second editor exists**: the queue-prioritization code path takes no parameter sourced from funnel analytics — any future change that would add one requires a published ADR amendment, not a silent code change.
- **Audit trail:** every piece of funnel content that references a specific check logs `{check_id, published_at, funnel_post_url, posted_at}` in a lightweight append-only table. This produces a checkable claim ("the funnel only ever posted about already-published checks") rather than an unverifiable assertion — closes the gap the red-team calls out ("not stated whether only published checks may feed it").
- **AI-content disclosure, per platform, applied to the funnel specifically:**
  - YouTube: any funnel video using an AI voice clone, a synthetic face/reenactment, or an AI-narrated "explainer" that could be mistaken for a real recording gets the description-panel disclosure; a synthesized voice reading the published verdict text aloud (likely use case) **does** require disclosure under the "AI voice of a real person" / synthetic-performance language above — default to disclosing rather than relying on the "production assistance" exemption, since the funnel's whole premise is narrating real claims.
  - TikTok: same trigger — any synthetic voice/face in the video gets the platform's AI-content label; script/caption AI assistance alone does not.
  - **Disclosure is logged in the same audit table** (`ai_disclosed: bool`), so a review can confirm every qualifying post was labelled.
- **Publishing mechanics:** keep funnel publishing **manual** (ADR-0003's current decision) specifically because that avoids the YouTube API's unverified-project private-lock and the TikTok Content Posting API's audit/self-only gate described above. Automating funnel publishing is a Phase 2+ decision gated on budgeting the Google verification review and the TikTok 2-4 week audit — not assumed free.
- **Revenue disclosure:** funnel ad/creator-fund/sponsorship revenue, however small, is listed on the same funding-transparency page ADR-0008 §3 and ADR-0012 already require for sponsorships and grants — a reader checking "who funds this" should see the funnel income in the same place, not discover it separately.
- **Per-account gaming interaction (ties to ADR-0008 C-14):** because checks rate claims, not accounts, the funnel also can never present a published check as "fact_checker_ke verified @handle" — only "fact_checker_ke checked this specific claim, dated."

## Trade-offs accepted
Restricting the funnel to published-only content means it cannot cover breaking/trending claims as fast as an unrestrained channel could — accepted deliberately: speed-over-rigor on the founder's own monetized channel is the precise failure mode this ADR exists to prevent.

## Irreversible
None identified — this is a process/policy decision, reversible by a future ADR amendment with a stated reason (which itself becomes part of the audit trail).

## Review trigger
Revisit if a second editor joins (upgrades the "process rule" to a code-enforced rule), if funnel revenue becomes material enough to warrant a dedicated disclosure format, or if either platform's audit/disclosure policy changes.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0030-1 | Every row in the funnel-content audit table references a `check_id` whose `published_at` timestamp is earlier than the funnel post's `posted_at` | GREEN (data-lifecycle hardening pass, 2026-10-04 — see implementation notes below) |
| AT-0030-2 | The editor queue's priority-ordering function accepts no parameter whose source is funnel analytics; a static-analysis/lint check enforces this on the queue module | RED |
| AT-0030-3 | Any funnel post flagged `ai_disclosed: true` in the audit table has a corresponding on-platform disclosure (description-panel text for YouTube, label metadata for TikTok) verified by a manual spot-check before each posting batch | RED |
| AT-0030-4 | The funding-transparency page's rendered output includes a funnel-revenue line item whenever the funnel audit table has any row with non-zero attributed revenue | RED |
| AT-0030-5 | No published check page or funnel post renders copy of the form "<handle> verified" or "<handle> is a liar" — only claim-dated rating copy, checked by a snapshot/regex test over rendered check and funnel-post templates | RED |

## Implementation notes (2026-10-03)

A process reference doc consolidating this ADR's three enforcement rules
(source restriction, editorial independence from funnel metrics, audit
trail) and the AI-disclosure checklist now exists at
[`docs/architecture/creator-funnel-firewall.md`](../architecture/creator-funnel-firewall.md)
— a day-to-day checklist companion to this ADR's evidence/decision
record, cross-linked from
[`docs/architecture/security-and-compliance.md`](../architecture/security-and-compliance.md).

This is documentation only. The audit-table schema, the queue
lint/static-analysis check (AT-0030-2), and the funding-transparency page
line item (AT-0030-4) are code/data changes out of scope for this pass —
all five acceptance tests (AT-0030-1 through AT-0030-5) remain **RED**,
unclaimed here. This ADR's status is left as `Proposed`.

## Implementation notes ("data-lifecycle + flywheel-integrity hardening" pass, 2026-10-04)

**AT-0030-1 closed.** The audit-table schema exists as `funnel_audit_log`
(migration 0011, `packages/db/src/schema.ts`), matching this ADR's/the
firewall doc's row shape: `{ check_id, published_at, funnel_post_url,
posted_at, ai_disclosed }`, plus a `platform` discriminator and an
unused-for-now nullable `revenue_cents` column (present so AT-0030-4's
future web change doesn't need another migration just to add it).

The write path, `services/api/src/lib/creator-funnel.ts#recordFunnelPost`
(exposed as `POST /v1/editor/funnel-posts`, admin-only — this records the
founder's own conflict-of-interest-adjacent activity, deliberately not
exposed to `editor`), enforces the "source restriction" rule at write
time: a post is rejected (`not_published`) if the referenced check has no
`publishedAt`, and rejected (`invalid_timing`) if the proposed `postedAt`
predates the check's `publishedAt`. Migration 0011 also adds a database
CHECK constraint (`funnel_audit_log_posted_after_published`) as a second,
independent line of defense for the same invariant. Verified empirically
against real Postgres (`services/api/src/__tests__/
creator-funnel.integration.test.ts`): a post against a published check
with `postedAt` after `publishedAt` is recorded; a post predating
publication is rejected and no row is written; a post against an
unpublished draft is rejected and no row is written.

This remains a firewall/audit record, not a feature (rule 2's "editorial
independence from funnel metrics" is satisfied by the simple fact that no
code path anywhere reads `funnel_audit_log` to influence editorial
ordering — nothing in `services/api/src/lib/editorial.ts` references it).

**Still RED, out of this pass's `services/api`/`packages/db` ownership:**
AT-0030-2 (a lint/static-analysis check on the editor-queue module — a
tooling/CI change), AT-0030-3 (a manual spot-check process before each
posting batch — not a code artifact), AT-0030-4 (the funding-transparency
page's rendered line item — apps/web), AT-0030-5 (a snapshot/regex test
over rendered check/funnel-post templates — apps/web).
