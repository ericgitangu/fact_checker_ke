# ADR-0025: Editorial operations and capacity

**Status:** Proposed · **Date:** 2026-10-03 · Builds on ADR-0004, ADR-0008, ADR-0011's breaker, ADR-0024

## Problem
ADR-0008 asks for "≥1 check/week" with no ceiling, no SLA, and no plan for what happens when submissions outpace a one-person review capacity. ADR-0011's cost breaker degrades overflow to "queued for review," but human review is already the stated bottleneck (ADR-0004 trade-offs) — the queue has nowhere to drain to (red-team amendment #8, C-3). There is also no defined right-of-reply workflow (ADR-0008 §3 requires one but doesn't operationalize it), no corrections/complaints process, and no step confirming a quote-attribution before publish (closing the C-1 fabricated-quote gap from the pipeline side, operationally rather than technically).

## Evidence
- Red-team E: "U11... Drafts shown to the submitter count as publication to a third party [I], and 0008 doesn't govern them (C-2)." — this ADR's right-of-reply step must respect ADR-0021's "draft is disclosure, not publication" line.
- Red-team amendment #10: "Fix the right-of-reply window at 48h. Public-safety exception needs a recorded reason. Add a takedown and complaint SLA."
- Red-team missing-ADRs item 3: "Reviewer roster, verdicts per week, publish SLA, right-of-reply workflow, corrections and complaints, what happens when the backlog overflows (ties to 0011's breaker)."
- ADR-0008 §6: approach PesaCheck/Africa Check for a collaboration — the natural source of a partner reviewer, distinct from a volunteer comment-moderator (ADR-0024).
- ADR-0004 step 7 (per red-team amendment #5): a draft involving a named person shows evidence/sources only, `rating:null`, until editor approval — the reviewer roster below is who performs that approval.

## Options
1. **Unbounded intake, best-effort review, no published SLA.** This is the status quo (ADR-0008's "≥1/week" floor with no ceiling) and is exactly what the red-team flagged as unworkable once ADR-0011's breaker starts queuing overflow with nowhere to go.
2. **Hard intake cap matched 1:1 to verified reviewer throughput, reject everything above it.** Rejected outright: rejecting submissions wholesale during a viral event is the worst possible failure mode for a fact-checking product's credibility.
3. **A staffed roster with an explicit throughput ceiling, a tiered SLA, and a defined overflow behaviour that degrades gracefully instead of rejecting. Recommended.**

## Decision (proposed)
1. **Reviewer roster.** The founder is the sole guaranteed reviewer at launch. A second tier — partner/volunteer reviewers, sourced from the ADR-0008 §6 PesaCheck/Africa Check outreach — is authorized but not assumed; the throughput numbers below are computed on the founder-alone case and only improve if partners materialize. Reviewer accounts use the `editor` role (ADR-0020), distinct from the `moderator` role (ADR-0024) which only touches comments.
2. **Verdict throughput ceiling.** Based on a named-person verdict requiring: evidence-file assembly, source archival, a right-of-reply attempt, and the ADR-0023 citation-integrity check review — budget 30-45 minutes of founder time per contested/named-person verdict, less (~10 min) for a straightforward reuse-or-reject. At a sustainable 2 hours/day of review time, the ceiling is roughly **4-8 verdicts/day**, i.e. **20-40/week**, which is the number the ADR-0011 quota math and ADR-0009's submission volume must be sized against — not the other way around.
3. **Publish SLA, tiered:**
   - Dedup hit (existing check reused, ADR-0023's guarded reuse): same day.
   - New claim, no named person, no right-of-reply needed: 2 business days.
   - New claim naming a person, requiring right-of-reply: 48h reply window (fixed, per red-team amendment #10) **plus** up to 2 business days of editor time after the window closes or the reply arrives, whichever first.
   - Urgent public-safety exception (ADR-0008 §3's carve-out): same-day publish allowed, but **only** with a recorded reason in the evidence file and an explicit `admin`-role (ADR-0020) sign-off, since skipping right-of-reply raises the defamation exposure ADR-0008 already flags.
4. **Right-of-reply workflow, concretely.** On a draft naming a person: (a) the submitter sees evidence/sources only, `rating:null` (ADR-0004 amendment) — this is disclosure, not publication, per ADR-0021; (b) the editor attempts contact through the named person's public channels (verified handle, public email, or press office) and logs the attempt and timestamp in the evidence file; (c) the 48h clock starts at the logged attempt, not at draft creation; (d) a reply (or its absence after 48h) is recorded and, if received, incorporated into the published check, not omitted.
5. **Quote-attribution confirmation step.** Before any verdict naming a person based on a user-supplied quote (text platforms, per ADR-0002's quote-plus-timestamp model) moves past draft, the editor must confirm the quote against the original post/embed at the cited timestamp and record that confirmation in the evidence file — this is the operational half of closing red-team C-1 (ADR-0023/0004 provide the technical half via `attribution: unverified` and citation checks; this is the human sign-off that removes the `unverified` flag before publish).
6. **Corrections and complaints.** A correction is always additive (ADR-0018's `check.corrected` event, full history shown per ADR-0008) — verdicts are never silently edited. A complaint (reader or subject disputes a rating) enters the same editor queue as new submissions but is flagged `complaint`, triaged within 2 business days for a decision to correct, stand, or escalate to the retained advocate (ADR-0008).
7. **Backlog overflow behaviour, tied to ADR-0011's breaker.** When the queue exceeds the throughput ceiling (step 2) for more than 48h sustained: (a) dedup/reuse hits keep publishing same-day (no editor bottleneck there); (b) new non-named-person claims move to a visible "in queue, publish ETA extended" state rather than silently waiting; (c) new named-person claims still get right-of-reply attempted on schedule (legal exposure doesn't pause for backlog) but publish is explicitly deferred past the normal SLA, disclosed to the submitter. This is the queue's actual drain path that ADR-0011's "queued for review" previously pointed to without defining.

## Trade-offs accepted
A hard throughput ceiling means some viral claims simply wait longer during a surge — accepted because the alternative (rushing named-person verdicts past right-of-reply to clear a backlog) is the direct cause of the defamation exposure ADR-0008 is built to avoid.

## Review trigger
Revisit the throughput ceiling if a partner/volunteer reviewer (ADR-0008 §6) actually onboards, or if actual per-verdict time logged over the first month differs materially from the 30-45 minute estimate.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0025-1 | A named-person draft cannot reach `published` status without a logged right-of-reply attempt timestamp and either a recorded reply or a 48h-elapsed flag | RED |
| AT-0025-2 | A named-person draft based on a user-supplied quote cannot reach `published` status while `attribution: unverified` is still set | RED |
| AT-0025-3 | An urgent public-safety publish that skips the right-of-reply window requires a non-empty recorded reason and an `admin`-role sign-off, logged in the audit log (ADR-0020) | RED |
| AT-0025-4 | A correction never overwrites a prior verdict row; the check's history view shows both the original and corrected state | RED |
| AT-0025-5 | When the open-queue count exceeds the configured throughput ceiling for 48h, new non-named-person submissions surface an extended-ETA state to the submitter instead of a silent wait | RED |
