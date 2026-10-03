# Runbook: legal takedown / complaint

Implements [ADR-0022](../adr/0022-observability-incident-response.md)'s
runbook requirement (AT-0022-4). Covers a court order, an ODPC directive,
or an advocate-directed removal/correction demand against a published
check. See [ADR-0008](../adr/0008-legal-compliance.md) for the legal
posture this responds to (defamation exposure, the *Muthaura v NMG*
precedent, ODPC registration) and
[ADR-0020](../adr/0020-identity-auth-roles.md) for the role model this
runbook assumes.

## Who can execute this

Only an account holding the **`admin`** role (ADR-0020 §4) can correct or
unpublish a check, or flip any related flag. At current team size this is
the founder; once a second editor/admin exists, this stays an
admin-only action, not an editor one, because unpublishing is higher-impact
than the normal editor review gate.

## Step 1 — triage: what kind of demand is this?

| Demand type | Example | First move |
|---|---|---|
| **Court order** | A served KEHC order (cf. *Muthaura v NMG*, KES 7.5M + takedown, KEHC 2386) | Do not act unilaterally — forward immediately to the retained advocate (ADR-0008); only act on the advocate's instruction or a clear, unambiguous order deadline that can't wait |
| **ODPC directive** | A Data Protection Act enforcement notice | Forward to the advocate; ODPC directives often have a short compliance window — log the receipt timestamp immediately (see audit step below) regardless of when the substantive response goes out |
| **Informal/advocate-style demand letter** | A complainant's lawyer emails asking for removal/correction | Log it, acknowledge receipt within the SLA ADR-0008 sets (advocate-defined, not lower than legal minimums), do **not** remove or correct before the editorial review below unless the advocate says otherwise |
| **Reader complaint, no legal letterhead** | A reader disputes a rating | Routed through the normal editorial correction process (ADR-0004), not this runbook — escalate to this runbook only if it's followed by a formal demand |

## Step 2 — preserve before you touch anything

Before any removal or correction:
1. Snapshot the check's current published state (rating, evidence file,
   citations, `published_at`) — this is what the demand is actually
   about, and it must be recoverable for the advocate's review even after
   it's taken down.
2. Confirm whether the demand is about a **draft** (never should have been
   publicly visible — ADR-0004's `rating: null` gate should make this
   impossible, but if it somehow happened, that's a C-2 red-team scenario
   and gets its own incident writeup, not just a quiet fix) versus an
   **editor-approved published check** (the normal, expected case this
   runbook is for).

## Step 3 — correction vs. removal

ADR-0008 draws this distinction deliberately — it matters for the IFCN
correction-policy record even though this project isn't an IFCN signatory:

- **Correction** (the rating or evidence was wrong): update the check,
  and the check page shows a visible correction notice with a timestamp
  — never a silent edit. The original rating and the correction reason
  are both retained in the audit log (ADR-0020 §5), not deleted.
- **Removal** (court-ordered, or the advocate determines the claim
  shouldn't have run at all): unpublish via the admin action that fires
  the audit-log row; the page shows a "removed following legal process"
  notice rather than a bare 404, unless the order specifically requires
  otherwise.

Whichever it is, the action is taken through the actual admin
unpublish/correct code path (which writes the audit row in the same
transaction, ADR-0020 §5) — never a direct database edit. A direct DB
edit leaves no audit trail and is itself a violation of the "immutable
audit log" decision this project is built on.

## Step 4 — log it

Every action in this runbook produces an `audit_log` row
(`actor_id`, `action`, `target_type: 'check'`, `target_id`, `metadata`
including the demand type and reference, `created_at`) — this is what
makes "the funnel only posted published checks" and "every
correction/removal has a traceable legal basis" checkable claims instead
of assertions (ties to the same audit-log pattern ADR-0030 uses for the
funnel).

## Step 5 — propagation check

If the check page is served via ISR (Vercel), confirm the tag
revalidation actually fired — a stale cached copy continuing to serve the
pre-correction/removed version after the admin action is itself a
violation of the takedown. Check the CDN response for the corrected/removed
state, not just the origin.

## Step 6 — close out

- Confirm the advocate has what they need for any formal response
  (snapshot from step 2, audit row from step 4).
- If this came with an SLA (ADR-0008's takedown/complaint SLA), confirm
  the response went out inside it.
- If the underlying cause was systemic (e.g. the dedup/evidence pipeline
  produced a bad verdict, not just an isolated editor error), file it as
  a red-team finding against ADR-0004, not just a one-off fix.

## Related

- [ADR-0008](../adr/0008-legal-compliance.md) — legal entity, ODPC,
  correction policy, takedown SLA
- [ADR-0020](../adr/0020-identity-auth-roles.md) — admin role, audit log
- [ADR-0004](../adr/0004-verification-pipeline.md) — publish gate,
  `rating: null` until editor approval
