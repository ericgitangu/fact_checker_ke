# ADR-0021: Data protection lifecycle

**Status:** Proposed · **Date:** 2026-10-03 · Requires a Kenyan advocate's sign-off (ties to ADR-0008) before acceptance

## Problem
ADR-0008 gates ODPC registration on accounts/comments going live, but no ADR says how long we keep what, on what cross-border transfer basis, or what happens when someone asks us to delete their data or a government agency asks us to hand it over. Red-team C-8 flags that Cloud Run/Vercel request logs retain IPs of `/maandamano` viewers, which can be subpoenaed, and that uploaded photos keep EXIF GPS.

## Evidence
- DPA 2019 registration is the default for every controller/processor touching data of people in Kenya; the small-business exemption never applies to "mandatory sectors" and whether fact-checking/protest-tracking counts is **[I]**, assumed yes per ADR-0008 **[V/I, inherited from 0008]**.
- Neon and Upstash run in `eu-central-1` (ADR-0009), the closest region to `africa-south1` — a cross-border transfer out of Kenya under DPA Part VI, whose adequacy/contractual basis is **[GAP]**.
- Red-team C-2: "Draft treated as published for defamation purposes (a third party sees it)" — a submitter who sees their own draft verdict is a data subject *and* a recipient simultaneously.
- Red-team C-8: protest-viewer IPs and EXIF GPS on uploads.
- ADR-0008 §2 already commits to "no GPS, no contact sync" and a privacy notice before accounts/comments go live; this ADR operationalizes that per data class.

## Options
1. **No formal retention policy; delete ad hoc.** Rejected: fails DPA data-minimisation and leaves the defamation evidence file (ADR-0008 C-13) with no defined lifespan.
2. **One blanket retention period for everything.** Rejected: published checks/evidence must outlive any short period (they're the IFCN track record), while uploads and tracker logs must be far shorter for safety.
3. **Per-data-class retention table, each row with a lawful basis and a deletion mechanism. Recommended.**

## Decision (proposed)

### Retention table
| Data class | Retention | Deletion mechanism | Notes |
|---|---|---|---|
| Anonymous submissions (unpublished, no claim found) | 30 days | Scheduled Postgres sweep (reuses the ADR-0017 sweeper cadence, hourly or slower) | Dedup/embedding cache entries tied to it survive if they're content-addressed and PII-free |
| Drafts involving a named person (unpublished) | 90 days or until publish/reject, whichever first | Same sweep | `rating:null` to the submitter per ADR-0004 amendment; counts as a "disclosure to a data subject", not publication (C-2) |
| Published checks + evidence files | Indefinite (the IFCN/defamation record) | Never auto-deleted; corrections are additive (ADR-0018 `check.corrected`), not rewrites | This is the asset the whole product exists to produce |
| Waitlist / newsletter emails | Until unsubscribe or 24 months inactivity | Self-serve unsubscribe link + sweep | Separate consent record from submission data |
| User uploads (photos/audio for deepfake triage, ADR-0006) | 24h after analysis completes, always | GCS lifecycle rule (hard delete, not soft-delete) | EXIF stripped at ingest, before any model sees the file; scanned for NCII/CSAM before processing (ADR-0006 amendment) |
| Application logs (Cloud Run, Vercel) | 30 days | Provider default retention + no manual export | IP truncated or hashed at the sink for any route under `/maandamano/*` (C-8) |
| Tracker-route logs (`/maandamano/*`) | 7 days, IP redacted at ingest (last octet/segment zeroed) | Log-sink exclusion filter (Terraform, ties to red-team amendment #11) | Protest viewership is the single most subpoena-sensitive dataset we hold |
| Audit log (ADR-0020) | Indefinite | Append-only, no delete grant | Accountability record, not personal browsing history |
| Idempotency/inbox keys (ADR-0017) | 24h (client keys), 3 days (QStash dedup, vendor default) | TTL | Operational, not personal data once request bodies with PII age out |

### Cross-border transfer
Neon/Upstash in `eu-central-1` means every submission and check leaves Kenya. Until the advocate confirms a DPA Part VI basis (SCCs, adequacy, or consent), the privacy notice discloses this plainly: *"Your submission is processed on servers in the European Union."* This is a legal-basis gap, not an engineering one.

### DSAR flow
A data subject emails the DPO contact (ADR-0008 §2). Within the DPA's statutory window **[GAP: exact days unconfirmed]**, an editor runs a documented script that queries by device/account id (ADR-0020) across submissions, drafts, uploads and audit log, returning a redacted export. Published-check evidence files are *not* subject to erasure — the justification-defence record outweighs it, matching ADR-0008's "credit and link out" stance. Manual and logged, not self-serve, at this scale.

### Law-enforcement request policy
No data is released without a Kenyan court order or a written statutory request citing its legal basis, verified against the requesting agency's letterhead, and logged in the audit log (ADR-0020) regardless of outcome. The advocate retained before the first named-person verdict (ADR-0008) evaluates any such request first.

### ODPC registration gate
Per ADR-0008 §2, registration happens before accounts/comments go live. Made explicit here as a data-lifecycle gate too: no new data class may collect PII beyond this table without an ODPC re-check.

## Trade-offs accepted
Short retention on uploads and tracker logs trades investigative/audit depth for subpoena-surface reduction — accepted because protest-safety risk (C-8) outweighs forensic convenience for a solo-founder operation with an advocate on retainer, not a legal department.

## Irreversible
EXIF stripping and the 24h upload deletion are one-way: if a later feature needs original EXIF (e.g. geotagged verification), it needs a new, explicitly-consented upload path, not a loosening of this one.

## Review trigger
Revisit on any ODPC correspondence, the advocate's answer on cross-border basis, or if a DSAR volume exceeds what a manual process can handle in a week.

## Acceptance tests
| ID | Behaviour | Status |
|---|---|---|
| AT-0021-1 | An unpublished anonymous submission with no claim found is gone from Postgres 30 days after creation (sweep job, integration test against a seeded `created_at`) | GREEN (anonymous-submission AND named-person-draft sweep both landed — see implementation notes) |
| AT-0021-2 | An upload's EXIF GPS tags are absent from the stored file before any detector runs; the row is deleted from GCS within 24h of analysis completion | RED (no upload pipeline in services/api to strip EXIF from or delete — ADR-0006/infra territory, explicit stub) |
| AT-0021-3 | Log entries for any `/maandamano/*` request have the IP's last octet/segment zeroed at the sink, verified on a live log export | RED (log-sink/Terraform concern — infra/** territory, explicit stub) |
| AT-0021-4 | A DSAR export for a known device token returns that token's submissions and drafts but never a published check's evidence file | GREEN (data-lifecycle hardening pass, 2026-10-04 — see implementation notes below) |
| AT-0021-5 | The privacy notice page states that data is processed in the EU, and this string is covered by a snapshot/contract test so it can't silently regress | RED (apps/web territory — no privacy-notice page exists in this wave's ownership) |

## Implementation notes ("People & adjudication" wave, 2026-10-03)

- **Retention table as data** (`retention_policy`, seeded by `db/migrations/0006_seed_retention_policy.sql` with this ADR's own table's rows — `retention_days: null` means indefinite). `services/api/src/lib/retention.ts#runRetentionSweep` reads the two sweepable periods (`anonymous_submission_no_claim`, `named_person_draft`) from this table rather than hardcoding them, so a future period change is a data edit, not a code change.
- **Invoked from the EXISTING sweeper, not a new cron** (task brief's explicit instruction): `POST /internal/outbox/drain` (`services/api/src/routes/internal.ts`) now also runs `runRetentionSweep` and returns its counts alongside the existing `drained`/`failed`/`idempotencyKeysCleaned` fields.
- **"No claim found"** is operationalized as "no `checks` row references this submission at all" (a `NOT EXISTS` subquery) — a submission that produced a check (draft or published) is never swept by this path even past 30 days, regardless of status.
- **Verified empirically against real Neon Postgres** (`services/api/src/__tests__/retention.integration.test.ts`): a submission backdated 31 days with no check is deleted; a fresh one and one with a check survive; a named-person draft backdated 91 days is deleted, a fresh one survives.
- **Explicit stubs, not faked** (AT-0021-2/3/5 — AT-0021-4 closed below): the remaining three need either an upload pipeline, a log-sink/Terraform change, or an apps/web page — none of which exist in or belong to `services/api`/`packages/db`/`packages/core` ownership. `services/api/src/lib/retention.ts#runDsarExport` is wired to `dsar_requests` + `audit_log` for the slice that DOES exist (comments, keyed by `authorDeviceHash`).

## Implementation notes ("data-lifecycle + flywheel-integrity hardening" pass, 2026-10-04)

- **AT-0021-4 closed.** `submissions` gained a nullable `device_token_hash` column (migration 0011), written at creation time by `services/api/src/routes/submissions.ts` (hashed via the existing `hashDeviceToken`, same as `comments.authorDeviceHash` — the raw token is never persisted). `runDsarExport` now queries `submissions` by that hash and, per submission, its **unpublished** drafts (`checks` with `publishedAt IS NULL`) — a published check is excluded from the export even inside a submission that also has drafts, not only via the top-level `excludedPublishedEvidence` flag, so a draft-shaped export can't leak a published verdict's content through a different field. Verified empirically against real Postgres (`services/api/src/__tests__/retention.integration.test.ts`, AT-0021-4 test): an own submission's id and its draft's id both appear in the export; a different device's submission does not; a published check's summary text never appears anywhere in the serialized export.
- **ADR-0020 review finding closed in the same pass**: `totp_used_codes` (the TOTP replay-prevention store) now gets pruned by the same retention sweep, past a 1-day cutoff — justified in `retention.ts`'s docblock by the ±1-step (~90s) RFC 6238 drift window `verifyTotpCode` enforces; anything older can never validate again regardless of whether the row still exists. Verified against real Postgres: a row backdated 2 days is deleted, a fresh row survives.
- **Still out of scope, needs the advocate**: the DPA Part VI cross-border transfer basis (§"Cross-border transfer" above) is a legal-basis determination, not an engineering task — explicitly NOT attempted in this pass. AT-0021-2 (upload EXIF/GCS), AT-0021-3 (log-sink IP redaction) and AT-0021-5 (privacy-notice page) remain RED, out of `services/api`/`packages/db` ownership.

---
## Amendment (two-engine pivot, 2026-10-04) — training-moat consent and auto-published / fetched data classes

**Status:** Accepted direction (owner-approved pivot 2026-10-04); the cross-border and training-consent pieces still **require advocate sign-off** (ties to ADR-0008/0033). Additive; the retention table, DSAR flow, law-enforcement policy and cross-border disclosure are retained.

- **Data-collection-as-training-moat consent (owner requirement) is operationalized in ADR-0033 §C.4** and ties here: submissions, editor/auditor corrections, and user agree/dispute signals feed the ADR-0031 flywheel (and the ADR-0005 Sheng-STT moat). The consent must be **specific, severable from the act of submitting, revocable (revocation → DSAR path), and exclude protest/special-category content by default.** `[ADVOCATE: can a free service condition submission on training consent under DPA 2019, or must it be optional?]` A consent later found invalid may require purging training data derived from it (irreversibility parallel to EXIF/upload deletion above).
- **New data classes from the pivot:**
  - **Fetched candidate items (fetch engine, ADR-0032):** platform-public metadata + engagement snapshots. Minimal PII (public figures' public posts), but retained only as long as needed to produce/attribute a check; non-check-producing candidates follow the "anonymous submission, no claim found" 30-day sweep by analogy. Reverse-image-search artifacts are treated as transient like uploads (24h) unless they become an evidence file.
  - **Async-audit records (ADR-0025/0031):** which published assessments were sampled, by whom, with what outcome — an **append-only accountability record** like the audit log (indefinite, no delete grant).
- **Published auto-generated checks remain indefinite** (the IFCN/defamation record and evidence file) — unchanged; auto-publish increases their *volume*, not their lifecycle.

### Acceptance tests (additive)
| ID | Behaviour | Status |
|---|---|---|
| AT-0021-6 | Training-moat consent is a severable, revocable record separate from submission; revocation excludes that subject from future training sets and protest/special-category content is excluded by default (ties to ADR-0033 AT-0033-3). | RED |
