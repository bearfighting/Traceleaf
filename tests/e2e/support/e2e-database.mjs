import { assertE2EComposeRunner, assertE2EProject } from "./e2e-compose.mjs";

export const businessDataResetTables = Object.freeze({
  full: [
    "configuration_capability_runtime_instances",
    "configuration_capability_runtime_state",
    "site_capability_activation_windows",
    "configuration_runtime_instances",
    "configuration_runtime_state",
    "site_management_audit",
    "site_creation_requests",
    "site_definition_revisions",
    "definition_revision_watermarks",
    "configuration_audit",
    "site_environment_policies",
    "site_capability_configurations",
    "site_registry",
    "geo_country_facts",
    "geo_event_metadata",
    "conversion_facts",
    "funnel_step_facts",
    "custom_event_facts",
    "web_vital_facts",
    "dimension_event_facts",
    "dimension_daily",
    "normalized_event_context",
    "session_events",
    "sessions",
    "visitor_event_facts",
    "visitor_daily",
    "session_daily",
    "analytics_rebuild_queue",
    "analytics_watermarks",
    "analytics_generations",
    "analytics_feature_flags",
    "raw_events",
    "page_view_daily",
    "page_view_routes",
    "page_view_totals",
  ],
  analytics: [
    "analytics_rebuild_queue",
    "dimension_event_facts",
    "dimension_daily",
    "normalized_event_context",
    "session_events",
    "sessions",
    "visitor_event_facts",
    "session_daily",
    "visitor_daily",
    "analytics_watermarks",
    "analytics_generations",
    "analytics_feature_flags",
    "raw_events",
    "page_view_daily",
    "page_view_routes",
    "page_view_totals",
  ],
  dashboard: [
    "dimension_event_facts",
    "dimension_daily",
    "session_events",
    "sessions",
    "visitor_event_facts",
    "visitor_daily",
    "session_daily",
    "normalized_event_context",
    "web_vital_facts",
    "analytics_rebuild_queue",
    "analytics_watermarks",
    "analytics_generations",
    "analytics_feature_flags",
    "raw_events",
    "page_view_daily",
    "page_view_routes",
    "page_view_totals",
  ],
});

export function businessDataResetSql(scope) {
  const tables = businessDataResetTables[scope];
  if (!tables) throw new Error(`Unknown E2E business-data reset scope '${scope}'.`);
  return `TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`;
}

export function resetE2EBusinessData({ runCompose, project, scope }) {
  assertE2EProject(project);
  assertE2EComposeRunner(runCompose);
  if (runCompose.e2eProject !== project) {
    throw new Error("Refusing to reset a database through a different E2E Compose project.");
  }
  return runCompose([
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
    businessDataResetSql(scope),
  ]);
}
