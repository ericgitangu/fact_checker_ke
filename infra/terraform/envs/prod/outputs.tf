output "artifact_registry_docker_path" {
  value = module.artifact_registry.docker_path
}

output "api_runtime_sa_email" {
  value = google_service_account.api_runtime.email
}

output "pipeline_runtime_sa_email" {
  value = google_service_account.pipeline_runtime.email
}

output "migrate_runtime_sa_email" {
  value = google_service_account.migrate_runtime.email
}

output "deploy_sa_email" {
  value = data.google_service_account.deploy.email
}

output "neon_project_id" {
  value = module.neon.project_id
}

output "upstash_database_id" {
  value = module.upstash.database_id
}

output "cloud_run_services_enabled" {
  value = var.enable_services
}
