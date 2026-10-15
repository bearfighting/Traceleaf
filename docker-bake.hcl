variable "REGISTRY" { default = "ghcr.io" }
variable "IMAGE_NAMESPACE" { default = "traceleaf" }
variable "IMAGE_TAG" { default = "candidate-local" }
variable "SOURCE_URL" { default = "https://github.com/traceleaf/traceleaf" }
variable "VERSION" { default = "0.0.0" }
variable "REVISION" { default = "unknown" }

target "common" {
  context    = "."
  platforms  = ["linux/amd64", "linux/arm64"]
  labels = {
    "org.opencontainers.image.source"   = SOURCE_URL
    "org.opencontainers.image.version"  = VERSION
    "org.opencontainers.image.revision" = REVISION
  }
}

target "collector" {
  inherits   = ["common"]
  dockerfile = "docker/rust-workspace.Dockerfile"
  target     = "collector-release"
  tags       = ["${REGISTRY}/${IMAGE_NAMESPACE}/traceleaf-collector:${IMAGE_TAG}"]
  cache-from = ["type=gha,scope=traceleaf-release-collector"]
  cache-to   = ["type=gha,mode=max,scope=traceleaf-release-collector"]
}

target "processor" {
  inherits   = ["common"]
  dockerfile = "docker/rust-workspace.Dockerfile"
  target     = "processor-release"
  tags       = ["${REGISTRY}/${IMAGE_NAMESPACE}/traceleaf-processor:${IMAGE_TAG}"]
  cache-from = ["type=gha,scope=traceleaf-release-processor"]
  cache-to   = ["type=gha,mode=max,scope=traceleaf-release-processor"]
}

target "analytics-api" {
  inherits   = ["common"]
  dockerfile = "docker/rust-workspace.Dockerfile"
  target     = "analytics-api-release"
  tags       = ["${REGISTRY}/${IMAGE_NAMESPACE}/traceleaf-analytics-api:${IMAGE_TAG}"]
  cache-from = ["type=gha,scope=traceleaf-release-analytics-api"]
  cache-to   = ["type=gha,mode=max,scope=traceleaf-release-analytics-api"]
}

target "db-tools" {
  inherits   = ["common"]
  dockerfile = "docker/rust-workspace.Dockerfile"
  target     = "db-migrator-release"
  tags       = ["${REGISTRY}/${IMAGE_NAMESPACE}/traceleaf-db-tools:${IMAGE_TAG}"]
  cache-from = ["type=gha,scope=traceleaf-release-db-tools"]
  cache-to   = ["type=gha,mode=max,scope=traceleaf-release-db-tools"]
}

target "dashboard" {
  inherits   = ["common"]
  dockerfile = "docker/dashboard-deploy.Dockerfile"
  tags       = ["${REGISTRY}/${IMAGE_NAMESPACE}/traceleaf-dashboard:${IMAGE_TAG}"]
  cache-from = ["type=gha,scope=traceleaf-release-dashboard"]
  cache-to   = ["type=gha,mode=max,scope=traceleaf-release-dashboard"]
}

group "release" {
  targets = ["collector", "processor", "analytics-api", "db-tools", "dashboard"]
}
