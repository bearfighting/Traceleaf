#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required for migration regression tests." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for migration regression tests." >&2
  exit 1
fi

clean_database="analytics_migration_clean_${PPID}_$$"
upgrade_database="analytics_migration_upgrade_${PPID}_$$"
database_url_for() {
  node -e '
  const databaseUrl = new URL(process.argv[1]);
  databaseUrl.pathname = `/${process.argv[2]}`;
  process.stdout.write(databaseUrl.toString());
' "$1" "$2"
}
clean_database_url="$(database_url_for "$DATABASE_URL" "$clean_database")"
upgrade_database_url="$(database_url_for "$DATABASE_URL" "$upgrade_database")"

cleanup_upgrade_database() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$clean_database\" WITH (FORCE)" >/dev/null 2>&1 || true
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$upgrade_database\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup_upgrade_database EXIT

echo "Running the migration runner against the current schema..."
pnpm db:migrate

echo "Running the migration runner a second time to verify idempotency..."
pnpm db:migrate

echo "Running the db-migrator migration history regression test..."
cargo test -p db-migrator --test migrations -- --ignored --test-threads=1

echo "Creating an isolated clean database for first-install regression..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$clean_database\"" >/dev/null

echo "Applying all migrations to the clean database..."
DATABASE_URL="$clean_database_url" pnpm db:migrate
DATABASE_URL="$clean_database_url" pnpm db:migrate
DATABASE_URL="$clean_database_url" cargo test -p db-migrator --test migrations -- --ignored --test-threads=1

echo "Creating an isolated database for migration upgrade regression..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$upgrade_database\"" >/dev/null

echo "Applying the previous migration history to the isolated database..."
DATABASE_URL="$upgrade_database_url" \
  cargo run -p db-migrator -- --target-version 20260924001200

echo "Seeding legacy feature flags for configuration migration..."
psql "$upgrade_database_url" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO analytics_feature_flags (site_id, analytics_enabled)
VALUES ('legacy-enabled', TRUE), ('legacy-disabled', FALSE);
CREATE TABLE site_environment_policies (collision BOOLEAN);
SQL

echo "Verifying the configuration migration rolls back atomically on failure..."
if DATABASE_URL="$upgrade_database_url" pnpm db:migrate >/dev/null 2>&1; then
  echo "migration unexpectedly succeeded despite a conflicting table" >&2
  exit 1
fi
psql "$upgrade_database_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.site_capability_configurations') IS NOT NULL THEN
    RAISE EXCEPTION 'failed migration left capability table behind';
  END IF;
  IF to_regprocedure('public.configuration_normalize_origin(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'failed migration left helper functions behind';
  END IF;
  IF EXISTS (SELECT 1 FROM _sqlx_migrations WHERE version = 20260925001300) THEN
    RAISE EXCEPTION 'failed migration was recorded as applied';
  END IF;
END
$$;
DROP TABLE site_environment_policies;
SQL

echo "Upgrading the isolated database to the current migration history..."
DATABASE_URL="$upgrade_database_url" pnpm db:migrate
DATABASE_URL="$upgrade_database_url" cargo test -p db-migrator --test migrations -- --ignored --test-threads=1
psql "$upgrade_database_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  enabled_document JSONB;
  disabled_document JSONB;
BEGIN
  SELECT document INTO enabled_document FROM site_capability_configurations WHERE site_id = 'legacy-enabled';
  SELECT document INTO disabled_document FROM site_capability_configurations WHERE site_id = 'legacy-disabled';
  IF enabled_document IS NULL OR disabled_document IS NULL THEN
    RAISE EXCEPTION 'legacy site capability configurations were not created';
  END IF;
  IF enabled_document->'capabilities' IS DISTINCT FROM '{"page_views":{"enabled":true,"settings":{}},"browser_context":{"enabled":true,"settings":{}},"anonymous_visitors":{"enabled":true,"settings":{}},"sessions":{"enabled":true,"settings":{}},"dimensions":{"enabled":true,"settings":{}},"custom_events":{"enabled":true,"settings":{}},"web_vitals":{"enabled":true,"settings":{}},"conversions":{"enabled":true,"settings":{}},"funnels":{"enabled":true,"settings":{}},"geo":{"enabled":true,"settings":{}}}'::JSONB THEN
    RAISE EXCEPTION 'legacy-enabled mapping is incorrect: %', enabled_document;
  END IF;
  IF disabled_document->'capabilities' IS DISTINCT FROM '{"page_views":{"enabled":true,"settings":{}},"browser_context":{"enabled":false,"settings":{}},"anonymous_visitors":{"enabled":false,"settings":{}},"sessions":{"enabled":false,"settings":{}},"dimensions":{"enabled":false,"settings":{}},"custom_events":{"enabled":true,"settings":{}},"web_vitals":{"enabled":true,"settings":{}},"conversions":{"enabled":true,"settings":{}},"funnels":{"enabled":true,"settings":{}},"geo":{"enabled":true,"settings":{}}}'::JSONB THEN
    RAISE EXCEPTION 'legacy-disabled mapping is incorrect: %', disabled_document;
  END IF;
  IF (SELECT count(*) FROM site_environment_policies) <> 0 THEN
    RAISE EXCEPTION 'environment policy rows must not be implicitly created';
  END IF;
  IF (SELECT count(*) FROM configuration_audit) <> 0 THEN
    RAISE EXCEPTION 'migration must not fabricate configuration audit events';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'analytics_feature_flags' AND column_name = 'analytics_enabled'
  ) THEN
    RAISE EXCEPTION 'legacy analytics_enabled column was removed';
  END IF;
END
$$;
DO $$
DECLARE
  long_environment TEXT := repeat('e', 129);
  valid_key JSONB := jsonb_build_array(jsonb_build_object(
    'key_id', 'ik_12345678',
    'sha256_digest', repeat('0', 64),
    'created_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ));
  timestamp_text TEXT := to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  valid_policy JSONB;
BEGIN
  valid_policy := jsonb_build_object(
    'schema_version', 1, 'site_id', 'extra-field-policy', 'environment', 'production',
    'version', 1, 'updated_at', timestamp_text, 'enabled', TRUE,
    'allowed_origins', jsonb_build_array('https://example.com'), 'ingest_keys', valid_key,
    'rate_limit_per_minute', 600
  );
  INSERT INTO site_environment_policies (site_id, environment, version, document)
  VALUES (
    'empty-keys-policy', 'preview', 1,
    jsonb_build_object(
      'schema_version', 1, 'site_id', 'empty-keys-policy', 'environment', 'preview',
      'version', 1, 'updated_at', timestamp_text, 'enabled', TRUE,
      'allowed_origins', jsonb_build_array('https://preview.example.com'),
      'ingest_keys', '[]'::JSONB, 'rate_limit_per_minute', 600
    )
  );
  BEGIN
    INSERT INTO site_capability_configurations (site_id, version, document)
    VALUES (
      'invalid-capability', 1,
      jsonb_build_object(
        'schema_version', 1, 'site_id', 'invalid-capability', 'version', 1,
        'updated_at', timestamp_text, 'capabilities', jsonb_build_object('page_views', TRUE),
        'consent_policy', 'required',
        'privacy_constraints', jsonb_build_array('no_ip_persistence', 'no_fingerprinting', 'consent_required')
      )
    );
    RAISE EXCEPTION 'malformed capability document unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO site_environment_policies (site_id, environment, version, document)
    VALUES (
      'invalid-policy', 'production', 1,
      jsonb_build_object(
        'schema_version', 1, 'site_id', 'invalid-policy', 'environment', 'production',
        'version', 1, 'updated_at', timestamp_text, 'enabled', TRUE,
        'allowed_origins', jsonb_build_array(), 'ingest_keys', valid_key,
        'rate_limit_per_minute', 600
      )
    );
    RAISE EXCEPTION 'empty environment policy arrays unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO site_environment_policies (site_id, environment, version, document)
    VALUES ('extra-field-policy', 'production', 1, valid_policy || jsonb_build_object('unexpected', TRUE));
    RAISE EXCEPTION 'unknown environment policy field unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO site_capability_configurations (site_id, version, updated_at, document)
    SELECT 'timestamp-mismatch-capability', 1, NOW(),
      jsonb_set(jsonb_set(document, '{site_id}', '"timestamp-mismatch-capability"'),
        '{updated_at}', to_jsonb('2000-01-01T00:00:00Z'::TEXT))
      FROM site_capability_configurations WHERE site_id = 'legacy-enabled';
    RAISE EXCEPTION 'mismatched capability updated_at unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO site_capability_configurations (site_id, version, document)
    VALUES ('', 1, '{}'::JSONB);
    RAISE EXCEPTION 'empty capability site_id unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO site_environment_policies (site_id, environment, version, document)
    VALUES (
      'unicode-origin', 'production', 1,
      jsonb_set(
        jsonb_set(valid_policy, '{site_id}', '"unicode-origin"'),
        '{allowed_origins}', '["https://bücher.example"]'::JSONB
      )
    );
    RAISE EXCEPTION 'Unicode U-label Origin unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO site_environment_policies (site_id, environment, version, document)
    VALUES (
      'ipv4-alias-origin', 'production', 1,
      jsonb_set(
        jsonb_set(valid_policy, '{site_id}', '"ipv4-alias-origin"'),
        '{allowed_origins}', '["https://127.1"]'::JSONB
      )
    );
    RAISE EXCEPTION 'abbreviated IPv4 Origin unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO site_environment_policies (site_id, environment, version, document)
  VALUES (
    'canonical-ipv4-origin', 'production', 1,
    jsonb_set(
      jsonb_set(valid_policy, '{site_id}', '"canonical-ipv4-origin"'),
      '{allowed_origins}', '["https://127.0.0.1"]'::JSONB
    )
  );
  BEGIN
    INSERT INTO site_environment_policies (site_id, environment, version, document)
    VALUES (
      'leading-zero-port-origin', 'production', 1,
      jsonb_set(
        jsonb_set(valid_policy, '{site_id}', '"leading-zero-port-origin"'),
        '{allowed_origins}', '["https://example.com:08080"]'::JSONB
      )
    );
    RAISE EXCEPTION 'leading-zero Origin port unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO site_environment_policies (site_id, environment, version, document)
  VALUES (
    'punycode-origin', 'production', 1,
    jsonb_set(
      jsonb_set(valid_policy, '{site_id}', '"punycode-origin"'),
      '{allowed_origins}', '["https://xn--bcher-kva.example"]'::JSONB
    )
  );

  INSERT INTO site_environment_policies (site_id, environment, version, document)
  VALUES (
    'ipv6-origin', 'staging', 1,
    jsonb_set(
      jsonb_set(
        jsonb_set(valid_policy, '{site_id}', '"ipv6-origin"'),
        '{environment}', '"staging"'
      ),
      '{allowed_origins}', '["https://[2001:0db8:0:0:0:0:0:1]"]'::JSONB
    )
  );
  BEGIN
    INSERT INTO site_environment_policies (site_id, environment, version, document)
    VALUES (
      'ipv6-origin', 'production', 1,
      jsonb_set(
        jsonb_set(valid_policy, '{site_id}', '"ipv6-origin"'),
        '{environment}', '"production"'
      ) || jsonb_build_object('allowed_origins', '["https://[2001:db8::1]"]'::JSONB)
    );
    RAISE EXCEPTION 'equivalent expanded and compressed IPv6 Origins unexpectedly passed';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document)
    VALUES (
      'timestamp-mismatch-policy', 'production', 1, '2000-01-01T00:00:00Z'::TIMESTAMPTZ,
      jsonb_set(jsonb_set(valid_policy, '{site_id}', '"timestamp-mismatch-policy"'),
        '{environment}', '"production"')
    );
    RAISE EXCEPTION 'mismatched policy updated_at unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO configuration_audit (actor_kind, resource, version, operation, changed_fields, created_at, expires_at)
    VALUES ('deployment_admin', '{"kind":"site_capabilities","site_id":123}'::JSONB,
      1, 'updated', ARRAY['capabilities'], NOW(), NOW() + INTERVAL '1 year');
    RAISE EXCEPTION 'non-string audit site_id unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO configuration_audit (actor_kind, resource, version, operation, changed_fields, created_at, expires_at)
    VALUES ('deployment_admin', '{"kind":"site_capabilities","site_id":"audit-site"}'::JSONB,
      1, 'updated', ARRAY['capabilities', 'capabilities'], NOW(), NOW() + INTERVAL '1 year');
    RAISE EXCEPTION 'duplicate audit changed_fields unexpectedly passed constraints';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO site_environment_policies (site_id, environment, version, document)
  VALUES (
    'long-environment', long_environment, 1,
    jsonb_build_object(
      'schema_version', 1, 'site_id', 'long-environment', 'environment', long_environment,
      'version', 1, 'updated_at', timestamp_text, 'enabled', TRUE,
      'allowed_origins', jsonb_build_array('https://example.com'), 'ingest_keys', valid_key,
      'rate_limit_per_minute', 600
    )
  );
  BEGIN
    INSERT INTO site_environment_policies (site_id, environment, version, document)
    VALUES (
      'long-environment', 'production', 1,
      jsonb_build_object(
        'schema_version', 1, 'site_id', 'long-environment', 'environment', 'production',
        'version', 1, 'updated_at', timestamp_text, 'enabled', TRUE,
        'allowed_origins', jsonb_build_array('https://EXAMPLE.com:443/'), 'ingest_keys', valid_key,
        'rate_limit_per_minute', 600
      )
    );
    RAISE EXCEPTION 'normalized Origin reuse across environments unexpectedly passed';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  INSERT INTO site_environment_policies (site_id, environment, version, document)
  VALUES (
    'another-site', 'production', 1,
    jsonb_build_object(
      'schema_version', 1, 'site_id', 'another-site', 'environment', 'production',
      'version', 1, 'updated_at', timestamp_text, 'enabled', TRUE,
      'allowed_origins', jsonb_build_array('https://example.com'), 'ingest_keys', valid_key,
      'rate_limit_per_minute', 600
    )
  );
END
$$;
SQL

echo "Checking Origin uniqueness while an environment moves between sites..."
psql "$upgrade_database_url" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO site_environment_policies (site_id, environment, version, document)
VALUES (
  'identity-move-source', 'staging', 1,
  jsonb_build_object(
    'schema_version', 1, 'site_id', 'identity-move-source', 'environment', 'staging',
    'version', 1, 'updated_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'enabled', TRUE, 'allowed_origins', jsonb_build_array('https://move.example.com'),
    'ingest_keys', jsonb_build_array(jsonb_build_object('key_id', 'ik_moveorig', 'sha256_digest', repeat('3', 64), 'created_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),
    'rate_limit_per_minute', 600
  )
);
SQL
psql "$upgrade_database_url" -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
BEGIN;
SET application_name = 'pr2_identity_move_test';
UPDATE site_environment_policies
   SET site_id = 'identity-move-target',
       document = jsonb_set(document, '{site_id}', '"identity-move-target"')
 WHERE site_id = 'identity-move-source' AND environment = 'staging';
SELECT pg_sleep(30);
COMMIT;
SQL
identity_move_pid=$!
identity_move_started=0
for attempt in {1..400}; do
  lock_state="$(psql "$upgrade_database_url" -Atq -c "SELECT 1 FROM pg_stat_activity AS activity WHERE application_name = 'pr2_identity_move_test' AND state = 'active' AND (SELECT count(*) FROM pg_locks WHERE pid = activity.pid AND locktype = 'advisory' AND granted) >= 2")"
  if [[ "$lock_state" == "1" ]]; then
    identity_move_started=1
    break
  fi
  sleep 0.05
done
if [[ "$identity_move_started" -ne 1 ]]; then
  wait "$identity_move_pid" || true
  echo "environment identity move did not reach the lock-held synchronization point" >&2
  exit 1
fi
if ! psql "$upgrade_database_url" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
INSERT INTO site_environment_policies (site_id, environment, version, document)
VALUES (
  'identity-move-source', 'production', 1,
  jsonb_build_object(
    'schema_version', 1, 'site_id', 'identity-move-source', 'environment', 'production',
    'version', 1, 'updated_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'enabled', TRUE, 'allowed_origins', jsonb_build_array('https://move.example.com'),
    'ingest_keys', jsonb_build_array(jsonb_build_object('key_id', 'ik_movesource', 'sha256_digest', repeat('4', 64), 'created_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),
    'rate_limit_per_minute', 600
  )
);
SQL
then
  wait "$identity_move_pid" || true
  echo "Origin claim did not wait for the environment identity move" >&2
  exit 1
fi
wait "$identity_move_pid"
psql "$upgrade_database_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM site_environment_policies WHERE site_id = 'identity-move-source' AND environment = 'production') <> 1 THEN
    RAISE EXCEPTION 'Origin claim on source site did not complete after the move';
  END IF;
  IF (SELECT count(*) FROM site_environment_policies WHERE site_id = 'identity-move-target' AND environment = 'staging') <> 1 THEN
    RAISE EXCEPTION 'environment identity move did not complete';
  END IF;
END
$$;
SQL

echo "Checking concurrent Origin claim serialization..."
psql "$upgrade_database_url" -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
BEGIN;
INSERT INTO site_environment_policies (site_id, environment, version, document)
VALUES (
  'concurrent-origin-test', 'staging', 1,
  jsonb_build_object(
    'schema_version', 1, 'site_id', 'concurrent-origin-test', 'environment', 'staging',
    'version', 1, 'updated_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'enabled', TRUE, 'allowed_origins', jsonb_build_array('https://race.example.com'),
    'ingest_keys', jsonb_build_array(jsonb_build_object('key_id', 'ik_racestage', 'sha256_digest', repeat('1', 64), 'created_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),
    'rate_limit_per_minute', 600
  )
);
COMMIT;
SQL
first_origin_insert_pid=$!
psql "$upgrade_database_url" -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL' &
BEGIN;
INSERT INTO site_environment_policies (site_id, environment, version, document)
VALUES (
  'concurrent-origin-test', 'production', 1,
  jsonb_build_object(
    'schema_version', 1, 'site_id', 'concurrent-origin-test', 'environment', 'production',
    'version', 1, 'updated_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'enabled', TRUE, 'allowed_origins', jsonb_build_array('https://race.example.com'),
    'ingest_keys', jsonb_build_array(jsonb_build_object('key_id', 'ik_raceprod', 'sha256_digest', repeat('2', 64), 'created_at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),
    'rate_limit_per_minute', 600
  )
);
COMMIT;
SQL
second_origin_insert_pid=$!
origin_insert_successes=0
origin_insert_rejections=0
if wait "$first_origin_insert_pid"; then origin_insert_successes=$((origin_insert_successes + 1)); else origin_insert_rejections=$((origin_insert_rejections + 1)); fi
if wait "$second_origin_insert_pid"; then origin_insert_successes=$((origin_insert_successes + 1)); else origin_insert_rejections=$((origin_insert_rejections + 1)); fi
if [[ "$origin_insert_successes" -ne 1 || "$origin_insert_rejections" -ne 1 ]]; then
  echo "concurrent same-Origin writes should produce one success and one rejection" >&2
  exit 1
fi

echo "Checking scheduled audit expiry behavior..."
psql "$upgrade_database_url" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO configuration_audit (actor_kind, resource, version, operation, changed_fields, created_at, expires_at)
VALUES
  ('deployment_admin', '{"kind":"site_capabilities","site_id":"expired"}'::JSONB,
   1, 'updated', ARRAY['capabilities'], NOW() - INTERVAL '2 years', NOW() - INTERVAL '1 year'),
  ('deployment_admin', '{"kind":"site_capabilities","site_id":"retained"}'::JSONB,
   1, 'updated', ARRAY['capabilities'], NOW() - INTERVAL '6 months', NOW() + INTERVAL '6 months');
SQL
DATABASE_URL="$upgrade_database_url" pnpm db:purge-configuration-audit
psql "$upgrade_database_url" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM configuration_audit WHERE expires_at <= NOW()) THEN
    RAISE EXCEPTION 'expired audit records were not purged';
  END IF;
  IF (SELECT count(*) FROM configuration_audit) <> 1 THEN
    RAISE EXCEPTION 'non-expired audit records were not retained';
  END IF;
END
$$;
SQL

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
    20260930001800
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
    'site_registry'
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
check_schema "$DATABASE_URL"

echo "Migration regression passed."
