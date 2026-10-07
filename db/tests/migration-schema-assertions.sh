#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

clean_database_url="${1:?clean database URL is required}"
upgrade_database_url="${2:?upgrade database URL is required}"
current_database_url="${3:?current database URL is required}"
check_schema() {
  local database_url="$1"

  psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  expected_migrations constant bigint[] := ARRAY[
    20260919000100,
    20260919000200,
    20260921000300,
    20260921000400,
    20260922000500,
    20260922000600,
    20260922000700,
    20260922000800,
    20260923000900,
    20260923001000,
    20260923001100,
    20260924001200,
    20260925001300,
    20260925001400,
    20260925001500,
    20260925001600,
    20260926001700,
    20260930001800,
    20261001001900,
    20261001002000,
    20261002002100,
    20261003002200,
    20261004002300
  ];
  actual_migrations bigint[];
BEGIN
  SELECT array_agg(version ORDER BY version)
    INTO actual_migrations
    FROM _sqlx_migrations;

  IF actual_migrations IS DISTINCT FROM expected_migrations THEN
    RAISE EXCEPTION 'unexpected migration history: %', actual_migrations;
  END IF;
END
$$;

DO $$
DECLARE
  validator_config TEXT[];
BEGIN
  SELECT proconfig INTO validator_config
    FROM pg_proc
   WHERE oid = 'public.configuration_environment_policy_document_is_valid(jsonb)'::regprocedure;
  IF validator_config IS NULL OR NOT ('search_path=pg_catalog, public' = ANY(validator_config)) THEN
    RAISE EXCEPTION 'environment policy validator does not pin a restore-safe search_path: %', validator_config;
  END IF;
END
$$;

DO $$
DECLARE
  required_tables constant text[] := ARRAY[
    'raw_events',
    'page_view_totals',
    'page_view_daily',
    'page_view_routes',
    'analytics_feature_flags',
    'analytics_generations',
    'analytics_watermarks',
    'normalized_event_context',
    'visitor_event_facts',
    'session_events',
    'sessions',
    'visitor_daily',
    'session_daily',
    'dimension_event_facts',
    'dimension_daily',
    'custom_event_facts',
    'web_vital_facts',
    'conversion_facts',
    'funnel_step_facts',
    'geo_event_metadata',
    'geo_country_facts',
    'site_capability_configurations',
    'site_environment_policies',
    'configuration_audit',
    'configuration_runtime_state',
    'configuration_runtime_instances',
    'configuration_capability_runtime_instances',
    'configuration_capability_runtime_state',
    'site_capability_activation_windows',
    'site_registry',
    'site_management_audit',
    'site_creation_requests'
  ];
  missing_table text;
BEGIN
  SELECT required
    INTO missing_table
    FROM unnest(required_tables) AS required
    WHERE to_regclass(format('public.%s', required)) IS NULL
    LIMIT 1;

  IF missing_table IS NOT NULL THEN
    RAISE EXCEPTION 'required migration table is missing: %', missing_table;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.views
     WHERE table_schema = 'public'
       AND table_name = 'site_registry_setup_status'
  ) THEN
    RAISE EXCEPTION 'Site Registry setup-status view is missing';
  END IF;
END
$$;

DO $$
DECLARE
  expected_fk_tables constant text[] := ARRAY[
    'analytics_feature_flags', 'site_capability_configurations',
    'site_capability_activation_windows', 'site_environment_policies',
    'site_definition_revisions', 'raw_events', 'page_view_totals',
    'page_view_daily', 'page_view_routes', 'normalized_event_context',
    'visitor_event_facts', 'visitor_daily', 'sessions', 'session_events',
    'session_daily', 'dimension_event_facts', 'dimension_daily',
    'web_vital_facts', 'custom_event_facts', 'conversion_facts',
    'funnel_step_facts', 'geo_event_metadata', 'geo_country_facts',
    'site_management_audit', 'site_creation_requests'
  ];
  actual_fk_tables text[];
BEGIN
  SELECT array_agg(child.relname ORDER BY child.relname)
    INTO actual_fk_tables
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS child ON child.oid = constraint_row.conrelid
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.site_registry'::regclass
      AND constraint_row.confdeltype = 'r';

  IF actual_fk_tables IS DISTINCT FROM (
    SELECT array_agg(table_name ORDER BY table_name)
      FROM unnest(expected_fk_tables) AS table_name
  ) THEN
    RAISE EXCEPTION 'unexpected Site Registry foreign keys: %', actual_fk_tables;
  END IF;
END
$$;

BEGIN;
DO $registry_setup_status_test$
DECLARE
  site_prefix TEXT := 'm3status_' || txid_current()::TEXT;
  timestamp_value TIMESTAMPTZ := clock_timestamp();
  timestamp_text TEXT := to_char(timestamp_value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  key_document JSONB := jsonb_build_array(jsonb_build_object(
    'key_id', 'ik_12345678',
    'sha256_digest', repeat('0', 64),
    'created_at', to_char(timestamp_value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ));
  capability_document JSONB := jsonb_build_object(
    'page_views', jsonb_build_object('enabled', TRUE, 'settings', '{}'::JSONB),
    'browser_context', jsonb_build_object('enabled', TRUE, 'settings', '{}'::JSONB),
    'anonymous_visitors', jsonb_build_object('enabled', TRUE, 'settings', '{}'::JSONB),
    'sessions', jsonb_build_object('enabled', TRUE, 'settings', '{}'::JSONB),
    'dimensions', jsonb_build_object('enabled', TRUE, 'settings', '{}'::JSONB),
    'custom_events', jsonb_build_object('enabled', TRUE, 'settings', '{}'::JSONB),
    'web_vitals', jsonb_build_object('enabled', TRUE, 'settings', '{}'::JSONB),
    'conversions', jsonb_build_object('enabled', TRUE, 'settings', '{}'::JSONB),
    'funnels', jsonb_build_object('enabled', TRUE, 'settings', '{}'::JSONB),
    'geo', jsonb_build_object('enabled', TRUE, 'settings', '{}'::JSONB)
  );
  candidate_site TEXT;
BEGIN
  INSERT INTO site_registry (site_id, display_name, website_url)
  VALUES (site_prefix || '_incomplete', NULL, NULL);

  INSERT INTO site_registry (site_id, display_name, website_url, lifecycle_status)
  SELECT candidate, 'Migration regression fixture', 'https://example.com',
         CASE WHEN candidate = site_prefix || '_archived' THEN 'archived' ELSE 'active' END
    FROM unnest(ARRAY[
      site_prefix || '_ready',
      site_prefix || '_archived',
      site_prefix || '_keyless',
      site_prefix || '_disabled',
      site_prefix || '_no_page_views'
    ]) AS candidates(candidate);

  FOREACH candidate_site IN ARRAY ARRAY[
    site_prefix || '_ready',
    site_prefix || '_archived',
    site_prefix || '_keyless',
    site_prefix || '_disabled',
    site_prefix || '_no_page_views'
  ] LOOP
    INSERT INTO site_capability_configurations (site_id, version, updated_at, document)
    VALUES (
      candidate_site, 1, timestamp_value,
      jsonb_build_object(
        'schema_version', 1,
        'site_id', candidate_site,
        'version', 1,
        'updated_at', timestamp_text,
        'capabilities',
          CASE WHEN candidate_site = site_prefix || '_no_page_views'
               THEN jsonb_set(capability_document, '{page_views,enabled}', 'false'::JSONB)
               ELSE capability_document
          END,
        'consent_policy', 'required',
        'privacy_constraints', jsonb_build_array('no_ip_persistence', 'no_fingerprinting', 'consent_required')
      )
    );

    INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document)
    VALUES (
      candidate_site, 'test', 1, timestamp_value,
      jsonb_build_object(
        'schema_version', 1,
        'site_id', candidate_site,
        'environment', 'test',
        'version', 1,
        'updated_at', timestamp_text,
        'enabled', candidate_site <> site_prefix || '_disabled',
        'allowed_origins', jsonb_build_array('https://example.com'),
        'ingest_keys', CASE WHEN candidate_site = site_prefix || '_keyless'
                            THEN '[]'::JSONB
                            ELSE key_document
                       END,
        'rate_limit_per_minute', 600
      )
    );
  END LOOP;

  IF (SELECT setup_status FROM site_registry_setup_status
       WHERE site_id = site_prefix || '_incomplete') IS DISTINCT FROM 'needs_attention' THEN
    RAISE EXCEPTION 'incomplete Site should need attention';
  END IF;
  IF (SELECT setup_status FROM site_registry_setup_status
       WHERE site_id = site_prefix || '_ready') IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'configured active Site should be ready';
  END IF;
  IF (SELECT setup_status FROM site_registry_setup_status
       WHERE site_id = site_prefix || '_archived') IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'archiving must not rewrite setup status';
  END IF;
  IF (SELECT setup_status FROM site_registry_setup_status
       WHERE site_id = site_prefix || '_keyless') IS DISTINCT FROM 'needs_attention' THEN
    RAISE EXCEPTION 'Site without an ingest-key digest should need attention';
  END IF;
  IF (SELECT setup_status FROM site_registry_setup_status
       WHERE site_id = site_prefix || '_disabled') IS DISTINCT FROM 'needs_attention' THEN
    RAISE EXCEPTION 'Site with a disabled policy should need attention';
  END IF;
  IF (SELECT setup_status FROM site_registry_setup_status
       WHERE site_id = site_prefix || '_no_page_views') IS DISTINCT FROM 'needs_attention' THEN
    RAISE EXCEPTION 'Site without required Page Views should need attention';
  END IF;
END
$registry_setup_status_test$;
ROLLBACK;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'raw_events_site_event_unique'
       AND conrelid = 'public.raw_events'::regclass
  ) THEN
    RAISE EXCEPTION 'raw event idempotency constraint is missing';
  END IF;

  IF to_regclass('public.analytics_generations_one_active_per_site_idx') IS NULL THEN
    RAISE EXCEPTION 'generation active-site uniqueness index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'configuration_runtime_state_pkey'
       AND conrelid = 'public.configuration_runtime_state'::regclass
  ) THEN
    RAISE EXCEPTION 'Collector runtime state identity constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'configuration_runtime_state_applied_version_check'
       AND conrelid = 'public.configuration_runtime_state'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'configuration_runtime_state_refresh_status_check'
       AND conrelid = 'public.configuration_runtime_state'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'configuration_runtime_state_check'
       AND conrelid = 'public.configuration_runtime_state'::regclass
  ) THEN
    RAISE EXCEPTION 'Collector runtime version and refresh constraints are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'configuration_runtime_instances_pkey'
       AND conrelid = 'public.configuration_runtime_instances'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'configuration_runtime_instances_refresh_status_check'
       AND conrelid = 'public.configuration_runtime_instances'::regclass
  ) THEN
    RAISE EXCEPTION 'Collector instance heartbeat constraints are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'configuration_capability_runtime_instances_pkey'
       AND conrelid = 'public.configuration_capability_runtime_instances'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'configuration_capability_runtime_state_pkey'
       AND conrelid = 'public.configuration_capability_runtime_state'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'configuration_capability_runtime_state_check'
       AND conrelid = 'public.configuration_capability_runtime_state'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'site_capability_activation_windows_pkey'
       AND conrelid = 'public.site_capability_activation_windows'::regclass
  ) THEN
    RAISE EXCEPTION 'Capability runtime status constraints are missing';
  END IF;
END
$$;
SQL
}

echo "Checking clean schema objects..."
check_schema "$clean_database_url"

echo "Checking upgraded schema objects..."
check_schema "$upgrade_database_url"

echo "Checking current schema objects..."
check_schema "$current_database_url"
