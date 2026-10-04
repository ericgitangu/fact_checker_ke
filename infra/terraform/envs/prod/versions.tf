terraform {
  required_version = "1.5.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "0.18.0"
    }
    upstash = {
      source  = "upstash/upstash"
      version = "~> 2.1"
    }
  }

  backend "gcs" {
    bucket = "fact-checker-ke-tfstate-97215510311"
    prefix = "envs/prod"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # Needed specifically for google_billing_budget: billingbudgets.
  # googleapis.com requires an explicit quota project, and this
  # session's ADC default quota project is a DIFFERENT project (not
  # master-crossing-435409-r1) — empirically hit as a 403
  # SERVICE_DISABLED error pointing at project 32555940559 even though
  # billingbudgets.googleapis.com IS enabled on master-crossing-435409-r1
  # (verified separately via `gcloud services list`). This pins the
  # quota project to the one actually running this stack.
  billing_project       = var.project_id
  user_project_override = true
}

# kislerdm/neon 0.18 does NOT auto-read a NEON_API_KEY env var the way
# the google/upstash providers auto-read their credential env vars —
# EMPIRICALLY VERIFIED: `provider "neon" {}` with NEON_API_KEY exported
# still errored "authorization key must be provided" at plan time. The
# api_key argument must be wired explicitly, which is why it's a
# variable here (itself sourced from TF_VAR_neon_api_key, which IS an
# env var, just one Terraform reads generically for any variable, not
# neon-provider-specific). Empty string is accepted at plan time when
# enable_neon_import=false (no API call is ever made, since the module's
# resources are all count=0) — see modules/neon's [MANUAL] note.
provider "neon" {
  api_key = var.neon_api_key
}

# upstash/upstash 2.1 likewise requires explicit email/api_key arguments.
provider "upstash" {
  email   = var.upstash_email
  api_key = var.upstash_api_key
}
