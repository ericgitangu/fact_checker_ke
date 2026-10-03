# ADR-0024: Trust and safety, and moderation

**Status:** Proposed · **Date:** 2026-10-03 · Gated by ADR-0008 ODPC registration before comments go live

## Problem
ADR-0001 Phase 1 says "full UGC moderation tooling" with no design. ADR-0008 makes ODPC registration a gate for accounts/comments but doesn't define what the moderation surface actually is. Apple App Store Guideline 1.2 requires any app with user-generated content to have a content filter, a report mechanism, a block mechanism, and published contact information for abuse reports — none of which exist in any ADR. Google Play's UGC policy is comparable. The only moderator available is the solo founder (red-team E, U5), so queue design must assume zero dedicated staff.

## Evidence
- Red-team E: "U5 Comments, likes, sharing corrections — Deferred, no design... No ADR covers moderation, identity or brigading. The only moderator is the solo founder."
- Red-team missing-ADRs list, item 2: "UGC pipeline that meets Apple 1.2 (filter, report, block, contact). Queue, SLA and brigading controls... A volunteer or partner model (PesaCheck)."
- ADR-0007 (Maandamano tracker) already restricts live comments to Phase 1 and flags no rule for ongoing-protest comments — this ADR is where that rule lands.
- ADR-0008 §6 already commits to approaching PesaCheck/Africa Check for a Sheng/creator-content collaboration; this ADR extends that to a volunteer-moderator pool.
- Apple App Store Review Guideline 1.2 (Safety — User Generated Content) requires, for apps with UGC: a method to filter objectionable content, a mechanism to report it, a mechanism to block abusive users, and published contact information — this is Apple's well-known, stable policy text; not separately re-fetched here, treated as **[I]** background rather than a new vendor-fact claim.

## Options
1. **No comments or UGC at launch; defer entirely to a later phase.** Compliant by omission, but ADR-0001 already schedules comments for Phase 1 and the product's value (crowd-sourced corrections, U5) depends on some UGC surface eventually — deferring the *design* indefinitely just repeats today's gap.
2. **Full UGC stack from day one (comments, likes, sharing, reputation).** Rejected: a solo founder cannot staff a moderation queue sized for an unbounded comment surface; this is exactly the C-12/U5 risk the red-team flagged.
3. **Minimal, compliant, rate-limited UGC: comments only, pre-filtered, report/block built in, sized to a solo-founder SLA, with volunteer backup. Recommended.**

## Decision (proposed)
1. **Scope: comments on published checks only**, no likes/reactions/sharing-with-commentary at launch (those multiply the moderation surface without adding fact-checking value). Comments require the device/session identity from ADR-0020 (no fully anonymous posting — accountability without requiring a full account).
2. **Pre-publish automated filter.** A lightweight classifier (reuses the ADR-0011 small-model tier) screens for slurs, doxxing patterns (phone numbers, national ID formats, addresses), and spam links before a comment becomes visible. Flagged comments hold in a `pending` state, visible only to the author, until an editor/admin (ADR-0020 role) releases or rejects them.
3. **Report mechanism.** Every comment has a report action; three or more independent reports (by distinct device/account identities) auto-hides the comment pending review — this is the brigading control: a single coordinated reporter can't hide a comment, but a real pile-on holds it without needing the founder to be online instantly.
4. **Block mechanism.** A reader can block a commenter's device/account identity; blocked identities' comments are hidden client-side for that reader only (not a global ban, which stays an editor/admin action).
5. **Contact for abuse reports.** Published, per Apple 1.2: a visible abuse-contact path (email or in-app form) distinct from the general feedback channel, routed to the same editor/admin review surface.
6. **Queue and SLA sized for a solo founder.** Target: moderation queue cleared within 24h on a normal day, 48h during a declared high-volume event (ties to ADR-0025's throughput ceiling). If the queue exceeds a defined backlog size, new comments go straight to `pending` (pre-moderation) instead of auto-visible, trading immediacy for not drowning — this is the same breaker philosophy as ADR-0011's cost circuit breaker, applied to editorial load instead of LLM spend.
7. **Volunteer/partner moderator model.** A small, named-and-vetted volunteer pool (candidates: PesaCheck collaboration per ADR-0008 §6, or trusted community members) can be granted a scoped `moderator` role (comment release/reject/hide only — no publish/correct/kill-switch rights, distinguishing it from `editor` in ADR-0020) once ODPC registration (ADR-0008 gate) is complete and each volunteer has signed a basic confidentiality/conduct agreement.
8. **Ongoing-protest comments are off, not moderated.** For any check or tracker page tagged to an active, ongoing protest event (ADR-0007), commenting is disabled entirely until the event is marked concluded — real-time crowd comments on live unrest are the highest-risk, lowest-value UGC surface (coordination risk, incitement risk, zero fact-checking value), and "off" is cheaper and safer than "heavily moderated."
9. **Brigading beyond reports.** A velocity guard (reuses ADR-0011's submission-velocity trend counters in Redis) flags a check page receiving an abnormal comment-rate spike for editor attention, independent of individual reports — this catches coordinated floods before the report threshold alone would.

## Trade-offs accepted
Pre-publish filtering and a report-threshold hold delay some legitimate comments' visibility by minutes to hours. Accepted because the alternative — fully live comments moderated only after the fact — is unworkable for a one-person team and is the exact gap the red-team flagged for U5.

## Irreversible
None identified; the comment surface can be tightened (narrower scope) or loosened (likes, reactions) later without a data-model rewrite, since `comments` is additive to the existing `checks` schema.

## Review trigger
Revisit if volunteer moderators are onboarded (role scope may need splitting further) or if comment volume regularly exceeds the 24h/48h SLA.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0024-1 | A comment containing a phone-number pattern or slur from the filter list never becomes publicly visible without editor release | RED |
| AT-0024-2 | Three reports from three distinct device identities auto-hide a comment; two reports from devices sharing one identity do not | RED |
| AT-0024-3 | Any check or tracker page tagged to an active protest event rejects new comment submissions with a clear reason, and re-enables once the event is marked concluded | RED |
| AT-0024-4 | An abuse-contact path is reachable from any comment's report action and is distinct from the general feedback form | RED |
| AT-0024-5 | A `moderator`-role account can release/reject/hide a comment but is rejected (403) on any publish, correction or kill-switch action | RED |
