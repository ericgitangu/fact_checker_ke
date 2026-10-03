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
  description = "Full image ref BY DIGEST (repo@sha256:...), never :latest (ADR-0016)."
  type        = string
}

variable "service_account_email" {
  type = string
}

variable "ingress" {
  description = "One of INGRESS_TRAFFIC_ALL, INGRESS_TRAFFIC_INTERNAL_ONLY, INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER."
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"
}

variable "allow_unauthenticated" {
  type    = bool
  default = true
}

variable "secret_env" {
  description = "map(env_var_name => { secret = secret_id, version = \"latest\" })"
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

variable "container_port" {
  type    = number
  default = 8080
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "max_instance_count" {
  type    = number
  default = 2
}

variable "timeout_seconds" {
  description = "ADR-0015: services/api holds SSE streams; allow up to 60 min."
  type        = number
  default     = 300
}
