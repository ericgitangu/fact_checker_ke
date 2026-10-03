variable "project_id" {
  description = "Existing Neon project ID — imported, never created by this module."
  type        = string
  default     = "ancient-art-69043280"
}

variable "project_name" {
  type    = string
  default = "fact-checker-ke"
}

variable "region_id" {
  type    = string
  default = "aws-eu-central-1"
}

variable "main_branch_id" {
  type    = string
  default = "br-soft-mode-b1m57jj2"
}

variable "dev_branch_id" {
  type    = string
  default = "br-square-hat-b1589ix2"
}
