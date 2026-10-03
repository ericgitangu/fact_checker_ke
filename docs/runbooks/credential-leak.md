# Runbook: credential leak / rotation

Implements [ADR-0022](../adr/0022-observability-incident-response.md)'s
runbook requirement (AT-0022-4). Covers an exposed API key, DB connection
string, QStash signing key, or any other secret — whether found by
gitleaks, by a human, or (as has actually happened on this project, see
below) surfaced incidentally during infrastructure work.

## This has already happened once — the real incident on record

[ADR-0016](../adr/0016-deploy-rail-iac.md) (line 127) records a real,
already-occurred incident this runbook exists to have a procedure for:
during a Terraform import, the `fact-checker-ke` Upstash Redis
password/REST tokens were plaintext-readable in the state bucket (to any
principal with read access to that bucket) for roughly 10 minutes between
the import and the cleanup. The owner flagged it explicitly rather than
silently handling it, and noted at the time that no credential-leak
runbook existed to point at — **this document closes that gap.** If the
Upstash credentials from that incident have not yet been rotated, treat
that as an open action item and do it using the procedure below before
closing this out.

## Step 1 — contain: revoke first, understand second

The instinct to "investigate first, rotate after" is backwards for a
credential leak — a live, valid, exposed credential is an active risk for
every minute it remains valid. Revoke or rotate the specific credential
immediately, then investigate scope and root cause.

| Secret type | Revoke/rotate at | Notes |
|---|---|---|
| Upstash Redis password/REST token | console.upstash.com → database → reset password / regenerate REST token | This is the ADR-0016 incident's exact secret — see above |
| QStash signing key | console.upstash.com → QStash → signing keys → rotate | Pipeline's signature verification must accept the new key before the old one is revoked, or in-flight messages fail verification — stage the Cloud Run env update first (see step 2), confirm it's live, then revoke the old key |
| Neon Postgres connection string / role password | console.neon.tech → project → roles → reset password | Cuts active connections using the old password; expect a brief connection-pool blip on affected services |
| GCP service account key (if any are still in use) | `gcloud iam service-accounts keys delete` on the leaked key ID, prefer migrating that path to Workload Identity Federation instead of a new long-lived key (ADR-0016's WIF direction) | A long-lived SA key is itself the thing ADR-0016/0026 are trying to get off of — a leak is a good forcing function to finish that migration for the affected service, not just rotate in place |
| Vercel / Anthropic / other vendor API key | Vendor console → regenerate | — |

## Step 2 — update the secret store and redeploy

All production secrets live in **GCP Secret Manager**, read by Cloud Run
via `--set-secrets` (ADR-0009/ADR-0016) — never echoed into logs, CI
output, or a chat/terminal transcript in plaintext.

```bash
# Add the new secret version (never overwrite history silently — Secret
# Manager versions are append-only, which is exactly what you want for
# an audit trail)
echo -n "$NEW_SECRET_VALUE" | gcloud secrets versions add <secret-name> \
  --project <gcp-project> --data-file=- --region africa-south1

# Point Cloud Run at the new version (or ::latest if that's the existing
# convention) and redeploy
gcloud run services update <service-name> \
  --project <gcp-project> --region africa-south1 \
  --set-secrets=<ENV_VAR>=<secret-name>:latest
```

Confirm the new secret is live (a smoke-test request, or a log line
confirming successful reconnection) **before** revoking the old
credential at the vendor (step 1's ordering matters more for
hard-cutover secrets like QStash's signing key than for something like a
DB password where Neon itself invalidates the old one immediately on
reset).

## Step 3 — scope the exposure

- How was it exposed? (Terraform state in a bucket with broader-than-
  intended read access — the ADR-0016 case; a log line; a committed
  `.env`; a build artifact.)
- Who had read access to that location, and for how long was the secret
  live there?
- Does the exposure location itself need a fix (e.g. the Terraform state
  bucket's IAM, not just the one secret) — fix the location, not only the
  symptom, or the next secret stored there leaks the same way.

## Step 4 — confirm the commit history is clean

Even if the leak wasn't via a git commit (the Upstash incident wasn't —
it was via Terraform state), run this as standard practice whenever a
credential-leak runbook is invoked, since a leak investigation is exactly
when it's cheapest to also confirm history is clean:

```bash
gitleaks detect --source . --verbose
# or, scoped to recent history only:
gitleaks detect --source . --log-opts="-10" --verbose
```

Do not declare the incident closed until this comes back clean (or any
hits are confirmed to be non-production test fixtures, not real
secrets).

## Step 5 — log and close out

Record (in the PR/commit that performs the rotation, or in an incident
note if no code change is involved):
- What leaked, where, for how long
- What was rotated and when
- Whether `gitleaks detect` came back clean
- Whether the exposure *mechanism* (not just the one secret) was fixed

If the leak came from infrastructure-as-code (Terraform state, a
misconfigured bucket ACL), cross-reference the fix against
[ADR-0016](../adr/0016-deploy-rail-iac.md)'s plan-guard and state-handling
practices — an incident like this is exactly the kind of "no silent tech
debt" item that belongs in that ADR's record, not just in this runbook.

## Related

- [ADR-0016](../adr/0016-deploy-rail-iac.md) — the real incident this
  runbook responds to; Terraform state handling
- [ADR-0009](../adr/0009-runtime-topology.md) — GCP Secret Manager /
  Cloud Run `--set-secrets` pattern
- [ADR-0026](../adr/0026-open-source-boundary-licence.md) — why no secret
  value (credentials, thresholds, prompts) is ever committed to this
  public repository
