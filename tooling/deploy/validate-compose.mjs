import { spawnSync } from "node:child_process";

const required = ["TRACELEAF_IMAGE_NAMESPACE", "TRACELEAF_IMAGE_TAG", "DEPLOYMENT_HOST_IP"];
const baseline = {
  ...process.env,
  TRACELEAF_IMAGE_NAMESPACE: "example-owner",
  TRACELEAF_IMAGE_TAG: "v1.0.0",
  DEPLOYMENT_HOST_IP: "192.0.2.10",
  POSTGRES_PASSWORD: "dummy-url-safe-password",
  CONFIG_ADMIN_TOKENS: '["dummy-token"]',
  DASHBOARD_CONFIG_ADMIN_TOKEN: "dummy-token",
};

function composeConfig(environment) {
  return spawnSync(
    "docker",
    [
      "compose",
      "--project-name",
      "traceleaf-static-check",
      "--env-file",
      "/dev/null",
      "--file",
      "compose.deploy.yaml",
      "config",
      "--format",
      "json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: environment,
    },
  );
}

const result = composeConfig(baseline);
if (result.status !== 0) throw new Error(`Deployment Compose config failed: ${result.stderr}`);
const model = JSON.parse(result.stdout);
const expected = [
  "db-migrate",
  "db-audit-purger",
  "collector",
  "processor",
  "analytics-api",
  "dashboard",
];
for (const serviceName of expected) {
  const service = model.services?.[serviceName];
  if (!service) throw new Error(`Missing deployment service: ${serviceName}`);
  if (service.build) throw new Error(`${serviceName} must use a prebuilt image, not build`);
  if (serviceName !== "db-migrate" && serviceName !== "db-audit-purger") {
    const wanted = `ghcr.io/example-owner/traceleaf-${serviceName}:v1.0.0`;
    if (service.image !== wanted)
      throw new Error(`${serviceName} image was ${service.image}; expected ${wanted}`);
  } else if (service.image !== "ghcr.io/example-owner/traceleaf-db-tools:v1.0.0") {
    throw new Error(`${serviceName} must use the shared DB tools image`);
  }
}
for (const key of required) {
  const missing = { ...baseline };
  delete missing[key];
  const invalid = composeConfig(missing);
  if (invalid.status === 0) throw new Error(`Compose unexpectedly accepted missing ${key}`);
}
process.stdout.write(
  "Deployment Compose configuration is valid and requires all release inputs.\n",
);
