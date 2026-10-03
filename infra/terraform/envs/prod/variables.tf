variable "project_id" {
  type    = string
  default = "master-crossing-435409-r1"
}

variable "region" {
  description = "Cloud Run region (ADR-0009/0015)."
  type        = string
  default     = "africa-south1"
}

variable "artifact_registry_region" {
  description = "Same region as Cloud Run, per task scope."
  type        = string
  default     = "africa-south1"
}

variable "billing_account_id" {
  type    = string
  default = "01C382-12CD13-DCA6EF"
}

variable "enable_services" {
  description = <<-EOT
    Gates the two Cloud Run services (api, pipeline) and their IAM
    wiring. Default false: images are not pushed to Artifact Registry
    yet, so defining the services now would mean `google_cloud_run_v2_
    service` either fails (no valid image) or is created pointing at a
    placeholder — neither is desirable. `terraform plan` MUST be clean
    with this false (task requirement); flip true once release.sh has
    pushed real images by digest.
  EOT
  type        = bool
  default     = false
}

variable "enable_neon_import" {
  description = "Gate for the Neon module — see modules/neon/main.tf [MANUAL] note (NEON_API_KEY)."
  type        = bool
  default     = false
}

variable "enable_upstash_import" {
  description = <<-EOT
    Gate for the Upstash module. KEEP FALSE in normal operation — see
    modules/upstash/main.tf's KNOWN LIMITATION doc comment: the
    upstash/upstash provider's upstash_redis_database resource stores
    password/rest_token/read_only_rest_token in plaintext in Terraform
    state, which this session empirically confirmed (and remediated:
    state rm + deleted the leaking GCS object versions). The Upstash
    database is intentionally left unmanaged by Terraform long-term;
    this flag exists only so the import path can be re-verified in a
    throwaway state file if the provider is ever patched to fix this.
  EOT
  type        = bool
  default     = false
}

variable "api_image" {
  description = "services/api image by digest, e.g. REGION-docker.pkg.dev/PROJECT/REPO/api@sha256:... Required only when enable_services=true."
  type        = string
  default     = ""
}

variable "pipeline_image" {
  type    = string
  default = ""
}

variable "migrate_image" {
  type    = string
  default = ""
}

variable "budget_thresholds_usd" {
  type    = list(number)
  default = [1, 5, 10]
}

variable "alert_notification_emails" {
  description = "Emails that receive billing budget + monitoring alerts."
  type        = list(string)
  default     = ["developer.ericgitangu@gmail.com"]
}

variable "neon_api_key" {
  description = <<-EOT
    [MANUAL] Neon personal API key — console.neon.tech/app/settings/api-keys.
    Default is a placeholder, NOT a real key: the kislerdm/neon 0.18
    provider rejects an EMPTY string at Configure() time with
    "authorization key must be provided" even when enable_neon_import=
    false and no neon_project/neon_branch resource is ever read or
    created (count=0) — empirically verified this session, a plain ""
    default fails `terraform plan` outright. A non-empty placeholder
    satisfies Configure()'s presence check without ever being used for
    a real API call. Set TF_VAR_neon_api_key to a real key (never
    committed) before flipping enable_neon_import=true.
  EOT
  type        = string
  default     = "unset-pending-manual-neon-api-key"
  sensitive   = true
}

variable "upstash_email" {
  description = "Set via TF_VAR_upstash_email (matches UPSTASH_EMAIL in ~/.claude/reference)."
  type        = string
  default     = ""
}

variable "upstash_api_key" {
  description = "Set via TF_VAR_upstash_api_key (matches UPSTASH_API_KEY in ~/.upstash/tokens.md). Never committed."
  type        = string
  default     = ""
  sensitive   = true
}
