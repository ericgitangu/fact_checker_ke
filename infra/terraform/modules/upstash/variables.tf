variable "database_id" {
  description = "Existing Upstash Redis database ID — imported, never created."
  type        = string
  default     = "2fee57b0-0650-4a67-bdc9-4ce3e4ad4dc1"
}

variable "database_name" {
  type    = string
  default = "fact-checker-ke"
}

variable "region" {
  description = "Observed live value is the global-replicated 'global' region, not a single eu-central-1 — see module main.tf doc comment."
  type        = string
  default     = "global"
}

variable "enable_import" {
  type    = bool
  default = false
}
