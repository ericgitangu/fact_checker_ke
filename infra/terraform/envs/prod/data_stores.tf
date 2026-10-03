module "neon" {
  source        = "../../modules/neon"
  enable_import = var.enable_neon_import
}

module "upstash" {
  source        = "../../modules/upstash"
  enable_import = var.enable_upstash_import
}
