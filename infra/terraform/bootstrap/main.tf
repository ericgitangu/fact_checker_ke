/**
 * ADR-0016 bootstrap: one-time resources that must exist before envs/prod
 * can use a remote (GCS) backend — the state bucket itself, the WIF
 * pool/provider for GitHub (unused until Actions billing is restored,
 * ADR-0016 trade-off), and the deploy service account.
 *
 * This layer intentionally uses a LOCAL backend (see backend.tf). You
 * cannot store the state bucket's own creation in a backend that lives
 * inside the bucket it is creating — this is the standard Terraform
 * chicken-and-egg resolution. The local state file
 * (infra/terraform/bootstrap/terraform.tfstate) is gitignored; treat it as
 * precious (it is the only record of the bucket/WIF/SA resource IDs) and
 * back it up out-of-band (it contains no secret VALUES — only resource
 * metadata — so copying it to the state bucket itself after creation,
 * under a bootstrap/ prefix, is safe and recommended for disaster
 * recovery; not automated here to keep bootstrap single-purpose).
 */

terraform {
  required_version = "1.5.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
