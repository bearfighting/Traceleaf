import { buildCapabilityConfigurationSeedSql } from "../../../tooling/contracts/capability-seed.mjs";

export function seedE2ECapabilityConfigurations(runCompose) {
  const siteIds = ["site_playground", "site_alpha", "site_beta", "site_unknown"];
  const sites = siteIds.map((siteId) => `('${siteId}')`).join(", ");
  runCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "analytics",
    "-d",
    "analytics",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `INSERT INTO site_registry (site_id) VALUES ${sites} ON CONFLICT (site_id) DO UPDATE SET lifecycle_status='active', updated_at=CASE WHEN site_registry.lifecycle_status='archived' THEN NOW() ELSE site_registry.updated_at END`,
  ]);
  runCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "analytics",
    "-d",
    "analytics",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    buildCapabilityConfigurationSeedSql(siteIds),
  ]);
}
