use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};

fn database_url() -> String {
    std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to the integration PostgreSQL database")
}

async fn pool() -> PgPool {
    let url = database_url();
    PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .expect("integration database should be reachable")
}

async fn cleanup(pool: &PgPool) {
    for table in [
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
        "raw_events",
        "page_view_daily",
        "page_view_routes",
        "page_view_totals",
        "analytics_generations",
        "analytics_feature_flags",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!("DELETE FROM {table}")))
            .execute(pool)
            .await
            .expect("analytics metadata cleanup should succeed");
    }
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn analytics_metadata_migration_is_additive_and_supports_rollback() {
    let pool = pool().await;
    cleanup(&pool).await;
    sqlx::query(
        "INSERT INTO site_registry (site_id) VALUES ('site_pr1') ON CONFLICT (site_id) DO NOTHING",
    )
    .execute(&pool)
    .await
    .expect("Site Registry fixture should be present");

    let analytics_indexes = sqlx::query_scalar::<_, String>(
        "SELECT indexname
         FROM pg_indexes
         WHERE schemaname = current_schema()
           AND indexname IN (
               'normalized_context_generation_site_raw_idx',
               'visitor_event_facts_generation_site_occurred_idx',
               'session_events_generation_site_occurred_idx',
               'dimension_event_facts_generation_site_occurred_idx',
               'dimension_event_facts_generation_dimension_value_idx',
               'dimension_event_facts_generation_visitor_occurred_idx',
               'dimension_event_facts_generation_session_occurred_idx',
               'dimension_daily_generation_lookup_idx'
           )
         ORDER BY indexname",
    )
    .fetch_all(&pool)
    .await
    .expect("analytics query indexes should be inspectable");
    assert_eq!(
        analytics_indexes,
        vec![
            "dimension_daily_generation_lookup_idx",
            "dimension_event_facts_generation_dimension_value_idx",
            "dimension_event_facts_generation_session_occurred_idx",
            "dimension_event_facts_generation_site_occurred_idx",
            "dimension_event_facts_generation_visitor_occurred_idx",
            "normalized_context_generation_site_raw_idx",
            "session_events_generation_site_occurred_idx",
            "visitor_event_facts_generation_site_occurred_idx",
        ]
    );

    let raw_event_columns = sqlx::query(
        "SELECT column_name FROM information_schema.columns
         WHERE table_name = 'raw_events'
           AND column_name IN ('visitor_id', 'context_schema_version')
         ORDER BY column_name",
    )
    .fetch_all(&pool)
    .await
    .expect("raw event metadata should be queryable");
    let columns = raw_event_columns
        .iter()
        .map(|row| row.get::<String, _>("column_name"))
        .collect::<Vec<_>>();
    assert_eq!(columns, vec!["context_schema_version", "visitor_id"]);

    let raw_event = sqlx::query(
        "INSERT INTO raw_events
            (site_id, event_id, schema_version, event_type, occurred_at,
             received_at, path, payload)
         VALUES ($1, $2, 1, 'page_view', $3, $4, '/', '{}'::jsonb)
         RETURNING visitor_id::text AS visitor_id, context_schema_version",
    )
    .bind("site_pr1")
    .bind("01J00000000000000000000090")
    .bind(DateTime::<Utc>::from_timestamp(1_760_000_000, 0).unwrap())
    .bind(DateTime::<Utc>::from_timestamp(1_760_000_001, 0).unwrap())
    .fetch_one(&pool)
    .await
    .expect("legacy raw event should still insert");
    assert!(raw_event.get::<Option<String>, _>("visitor_id").is_none());
    assert!(
        raw_event
            .get::<Option<i32>, _>("context_schema_version")
            .is_none()
    );

    let flags = sqlx::query(
        "INSERT INTO analytics_feature_flags (site_id)
         VALUES ('site_pr1')
         RETURNING analytics_enabled",
    )
    .fetch_one(&pool)
    .await
    .expect("feature flags should use disabled defaults");
    assert!(!flags.get::<bool, _>("analytics_enabled"));

    let first_generation = "00000000-0000-4000-8000-000000000001";
    let second_generation = "00000000-0000-4000-8000-000000000002";
    for generation_id in [first_generation, second_generation] {
        sqlx::query(
            "INSERT INTO analytics_generations
                (generation_id, site_id, aggregation_version, parser_version,
                 rebuild_reason, status)
             VALUES ($1::uuid, 'site_pr1', 1, 'woothee-0.13.0', 'initial', 'building')",
        )
        .bind(generation_id)
        .execute(&pool)
        .await
        .expect("generation should insert");
    }

    let invalid_status = sqlx::query(
        "INSERT INTO analytics_generations
            (generation_id, site_id, aggregation_version, parser_version,
             rebuild_reason, status)
         VALUES ($1::uuid, 'site_pr1', 1, 'woothee-0.13.0', 'initial', 'unknown')",
    )
    .bind("00000000-0000-4000-8000-000000000003")
    .execute(&pool)
    .await;
    assert!(invalid_status.is_err());

    let invalid_reason = sqlx::query(
        "INSERT INTO analytics_generations
            (generation_id, site_id, aggregation_version, parser_version,
             rebuild_reason, status)
         VALUES ($1::uuid, 'site_pr1', 1, 'woothee-0.13.0', 'unknown', 'building')",
    )
    .bind("00000000-0000-4000-8000-000000000004")
    .execute(&pool)
    .await;
    assert!(invalid_reason.is_err());

    let invalid_scope = sqlx::query(
        "INSERT INTO analytics_generations
            (generation_id, site_id, aggregation_version, parser_version,
             scope_from, scope_to, rebuild_reason, status)
         VALUES ($1::uuid, 'site_pr1', 1, 'woothee-0.13.0',
                 '2026-09-20', '2026-09-19', 'backfill', 'building')",
    )
    .bind("00000000-0000-4000-8000-000000000005")
    .execute(&pool)
    .await;
    assert!(invalid_scope.is_err());

    let invalid_generation = sqlx::query(
        "INSERT INTO analytics_generations
            (generation_id, site_id, aggregation_version, parser_version,
             rebuild_reason, status)
         VALUES ($1::uuid, 'site_pr1', 0, 'woothee-0.13.0', 'initial', 'building')",
    )
    .bind("00000000-0000-4000-8000-000000000003")
    .execute(&pool)
    .await;
    assert!(invalid_generation.is_err());

    let raw_event_id = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM raw_events WHERE site_id = 'site_pr1' AND event_id = '01J00000000000000000000090'",
    )
    .fetch_one(&pool)
    .await
    .expect("raw event id should be available for dimension constraints");
    sqlx::query(
        "INSERT INTO dimension_event_facts
            (generation_id, raw_event_id, site_id, dimension, value, occurred_at, day)
         VALUES ($1::uuid, $2, 'site_pr1', 'language', 'en-CA', NOW(), CURRENT_DATE)",
    )
    .bind(first_generation)
    .bind(raw_event_id)
    .execute(&pool)
    .await
    .expect("dimension fact without visitor should be valid");
    let invalid_dimension = sqlx::query(
        "INSERT INTO dimension_event_facts
            (generation_id, raw_event_id, site_id, dimension, value, occurred_at, day)
         VALUES ($1::uuid, $2, 'site_pr1', 'unsupported', 'value', NOW(), CURRENT_DATE)",
    )
    .bind(first_generation)
    .bind(raw_event_id)
    .execute(&pool)
    .await;
    assert!(invalid_dimension.is_err());
    let invalid_session_without_visitor = sqlx::query(
        "INSERT INTO dimension_event_facts
            (generation_id, raw_event_id, site_id, session_id, dimension, value, occurred_at, day)
         VALUES ($1::uuid, $2, 'site_pr1', $3::uuid, 'timezone', 'UTC', NOW(), CURRENT_DATE)",
    )
    .bind(first_generation)
    .bind(raw_event_id)
    .bind("00000000-0000-4000-8000-000000000099")
    .execute(&pool)
    .await;
    assert!(invalid_session_without_visitor.is_err());

    sqlx::query(
        "UPDATE analytics_generations
         SET status = 'active', activated_at = NOW()
         WHERE generation_id = $1::uuid",
    )
    .bind(first_generation)
    .execute(&pool)
    .await
    .expect("first generation should activate");

    let duplicate_active = sqlx::query(
        "UPDATE analytics_generations SET status = 'active' WHERE generation_id = $1::uuid",
    )
    .bind(second_generation)
    .execute(&pool)
    .await;
    assert!(duplicate_active.is_err());

    sqlx::query(
        "UPDATE analytics_generations SET status = 'retired' WHERE generation_id = $1::uuid",
    )
    .bind(first_generation)
    .execute(&pool)
    .await
    .expect("old generation should retire");
    sqlx::query(
        "UPDATE analytics_generations
         SET status = 'active', activated_at = NOW()
         WHERE generation_id = $1::uuid",
    )
    .bind(second_generation)
    .execute(&pool)
    .await
    .expect("new generation should activate");

    let active_count = sqlx::query(
        "SELECT COUNT(*) AS count FROM analytics_generations
         WHERE site_id = 'site_pr1' AND status = 'active'",
    )
    .fetch_one(&pool)
    .await
    .expect("active generation count should be queryable")
    .get::<i64, _>("count");
    assert_eq!(active_count, 1);

    sqlx::query(
        "INSERT INTO analytics_watermarks
            (site_id, generation_id, source_name, processed_received_watermark)
         VALUES
            ('site_pr1', NULL, 'page_views', $1),
            ('site_pr1', $2::uuid, 'visitor_session', $3)",
    )
    .bind(DateTime::<Utc>::from_timestamp(1_760_000_001, 0).unwrap())
    .bind(second_generation)
    .bind(DateTime::<Utc>::from_timestamp(1_760_000_002, 0).unwrap())
    .execute(&pool)
    .await
    .expect("legacy and generation watermarks should coexist");

    let watermark_count = sqlx::query(
        "SELECT COUNT(*) AS count FROM analytics_watermarks WHERE site_id = 'site_pr1'",
    )
    .fetch_one(&pool)
    .await
    .expect("watermark count should be queryable")
    .get::<i64, _>("count");
    assert_eq!(watermark_count, 2);

    let duplicate_legacy_watermark = sqlx::query(
        "INSERT INTO analytics_watermarks
            (site_id, generation_id, source_name)
         VALUES ('site_pr1', NULL, 'page_views')",
    )
    .execute(&pool)
    .await;
    assert!(duplicate_legacy_watermark.is_err());

    let invalid_generation_watermark = sqlx::query(
        "INSERT INTO analytics_watermarks
            (site_id, generation_id, source_name)
         VALUES ('site_pr1', $1::uuid, 'visitor_session')",
    )
    .bind("00000000-0000-4000-8000-000000000099")
    .execute(&pool)
    .await;
    assert!(invalid_generation_watermark.is_err());

    let invalid_legacy_scope = sqlx::query(
        "INSERT INTO analytics_watermarks
            (site_id, generation_id, source_name)
         VALUES ('site_pr1', $1::uuid, 'page_views')",
    )
    .bind(second_generation)
    .execute(&pool)
    .await;
    assert!(invalid_legacy_scope.is_err());

    cleanup(&pool).await;
}
