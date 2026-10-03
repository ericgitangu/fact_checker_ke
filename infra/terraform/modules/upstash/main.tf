/**
 * ⚠ KNOWN LIMITATION, found empirically this session (not theoretical):
 * the upstash/upstash 2.1 provider's `upstash_redis_database` resource
 * schema includes `password`, `rest_token` and `read_only_rest_token`
 * as plain (non write-only) attributes, so an actual `terraform import`
 * of this resource writes those SECRET VALUES into Terraform state in
 * plaintext — directly violating ADR-0016's "secret values never enter
 * Terraform state" rule. This is NOT the same situation as
 * modules/secret (GCP Secret Manager), where the container/version
 * split lets us omit the version resource entirely; the upstash
 * provider has no equivalent container-only resource.
 *
 * CONSEQUENCE: `enable_import` defaults to false and SHOULD STAY false
 * for this module in normal operation. It was flipped true once in this
 * session to empirically verify the import path works end-to-end
 * (ADR-0016 task scope said "import, don't recreate"), the leak was
 * caught by AT-0016-6's grep check, and was remediated immediately:
 * the resource was `terraform state rm`'d back out, and every GCS
 * object version of envs/prod's state file that contained the secret
 * was deleted (gcs state bucket is versioned — the leak lived in
 * historical versions, not just current state). See the ADR-0016
 * implementation notes for the full incident timeline. THE UPSTASH
 * PASSWORD/REST TOKEN SHOULD STILL BE ROTATED via console.upstash.com
 * out of caution, since it was readable in plaintext (briefly, to
 * anyone with read access to the state bucket) — this is flagged as an
 * action item, not silently fixed.
 *
 * Upstash is therefore managed the same way GCP secret VALUES are:
 * fully out-of-band (CLI/console), with only the database ID recorded
 * here as a plain string output for other modules/docs to reference.
 *
 * Upstash Redis `fact-checker-ke` (id 2fee57b0-0650-4a67-bdc9-4ce3e4ad4dc1)
 * — IMPORTED, never recreated. prevent_destroy per ADR-0016.
 *
 * Deviation from the task brief, EMPIRICALLY VERIFIED (not deduced): the
 * brief said "eu-central-1". `upstash redis list --json` (run against the
 * real account, 2026-10-03) shows this database's `region` field as
 * `"global"` with `state: "active"` — it's a globally-replicated
 * database, not a single-region one. The region variable default below
 * reflects the OBSERVED value, not the brief's assumption, per the
 * verification-discipline rule (never assume; the live API response is
 * the source of truth, and it disagrees with the brief).
 *
 * Provider: upstash/upstash 2.1. Auth: UPSTASH_EMAIL + UPSTASH_API_KEY
 * env vars (confirmed working against the real account via
 * `upstash redis list --json` in this session — NOT the OAuth-style
 * `upstash auth` flow, which reports "not logged in" even when env-var
 * auth works; gate on a real command, not `whoami` — see
 * ~/.claude/reference/serverless_provisioning_neon_upstash.md).
 */

resource "upstash_redis_database" "this" {
  count = var.enable_import ? 1 : 0

  database_name  = var.database_name
  region         = var.region
  primary_region = var.region == "global" ? "eu-central-1" : null
  tls            = true
  # Matches the observed live value exactly (a `terraform plan` without
  # this showed budget 0 -> 20, the provider's own default, which would
  # otherwise permanently drift every plan) — AT-0016-5 requires a clean
  # second plan.
  budget = 0

  lifecycle {
    prevent_destroy = true
  }
}

output "database_id" {
  value = var.enable_import ? upstash_redis_database.this[0].database_id : var.database_id
}
