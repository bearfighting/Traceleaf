import { buildCapabilityConfigurationSeedSql } from "./capability-seed.mjs";

export function seedE2ECapabilityConfigurations(runCompose) {
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
    buildCapabilityConfigurationSeedSql([
      "site_playground",
      "site_alpha",
      "site_beta",
      "site_unknown",
    ]),
  ]);
}
