module "artifact_registry" {
  source        = "../../modules/artifact_registry_repository"
  project_id    = var.project_id
  region        = var.artifact_registry_region
  repository_id = "fact-checker-ke"
}
