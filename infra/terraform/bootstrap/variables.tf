variable "project_id" {
  description = "GCP project ID (observed: master-crossing-435409-r1)."
  type        = string
}

variable "region" {
  description = "Default region for bootstrap resources requiring one."
  type        = string
  default     = "europe-west1"
}

variable "state_bucket_region" {
  description = <<-EOT
    Region for the Terraform state GCS bucket.

    Decision: europe-west1, not africa-south1, even though Cloud Run
    workloads run in africa-south1 (ADR-0009/0015). Justification:
      1. GCS storage pricing in africa-south1 is Tier-2 (higher unit
         cost, per ADR-0009's region research); europe-west1 is
         standard Tier-1 pricing. State objects are tiny (KB-MB range)
         so the absolute delta is cents/month either way, but there is
         no reason to pay the Tier-2 premium for a bucket that nothing
         latency-sensitive reads.
      2. europe-west1 is close to Neon/Upstash's eu-central-1 (both
         imported, not created, by this stack), keeping the
         state-management plane co-located with the two stateful
         services it describes, independent of where Cloud Run itself
         runs.
      3. State-bucket region is decoupled from compute region by
         design — Terraform talks to the GCS API over the internet,
         not a VPC-local path, so there is no latency reason to match
         Cloud Run's region.
  EOT
  type        = string
  default     = "europe-west1"
}

variable "state_bucket_name" {
  description = "Globally-unique GCS bucket name for Terraform remote state."
  type        = string
  default     = "fact-checker-ke-tfstate"
}

variable "github_repository" {
  description = "owner/repo pinned into the WIF attribute condition (ADR-0016 red-team amendment)."
  type        = string
  default     = "ericgitangu/fact_checker_ke"
}

variable "deploy_services" {
  description = "Cloud Run service names the deploy SA gets run.admin on."
  type        = list(string)
  default     = ["fact-checker-ke-api", "fact-checker-ke-pipeline"]
}
