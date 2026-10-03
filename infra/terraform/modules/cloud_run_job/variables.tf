variable "project_id" {
  type = string
}

variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "image" {
  description = "Full image ref BY DIGEST."
  type        = string
}

variable "service_account_email" {
  type = string
}

variable "command" {
  type    = list(string)
  default = null
}

variable "args" {
  type    = list(string)
  default = null
}

variable "secret_env" {
  type = map(object({
    secret  = string
    version = optional(string, "latest")
  }))
  default = {}
}

variable "plain_env" {
  type    = map(string)
  default = {}
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "max_retries" {
  type    = number
  default = 1
}

variable "timeout_seconds" {
  type    = number
  default = 600
}
