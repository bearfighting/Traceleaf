use super::support::*;
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::Row;

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn processes_daily_routes_and_totals_atomically() {
    let (processor, pool) = setup().await;
    let day = NaiveDate::from_ymd_opt(2026, 9, 18)
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap()
        .and_utc();
    insert_raw_event(&pool, "01J00000000000000000000010", "site_a", day, "/").await;
    insert_raw_event(&pool, "01J00000000000000000000011", "site_a", day, "/about").await;
    insert_raw_event(&pool, "01J00000000000000000000012", "site_a", day, "/").await;

    assert_eq!(processor.process_all_once().await.unwrap(), 3);
    assert_eq!(processor.process_all_once().await.unwrap(), 0);

    let daily =
        sqlx::query("SELECT page_views FROM page_view_daily WHERE site_id = 'site_a' AND day = $1")
            .bind(day.date_naive())
            .fetch_one(&pool)
            .await
            .unwrap()
            .get::<i64, _>("page_views");
    assert_eq!(daily, 3);

    let root = sqlx::query(
        "SELECT page_views FROM page_view_routes
         WHERE site_id = 'site_a' AND day = $1 AND path = '/'",
    )
    .bind(day.date_naive())
    .fetch_one(&pool)
    .await
    .unwrap()
    .get::<i64, _>("page_views");
    assert_eq!(root, 2);

    let total = sqlx::query("SELECT page_views FROM page_view_totals WHERE site_id = 'site_a'")
        .fetch_one(&pool)
        .await
        .unwrap()
        .get::<i64, _>("page_views");
    assert_eq!(total, 3);

    let processed =
        sqlx::query("SELECT COUNT(*) AS count FROM raw_events WHERE processed_at IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get::<i64, _>("count");
    assert_eq!(processed, 3);
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn uses_occurred_at_utc_day_and_isolates_sites() {
    let (processor, pool) = setup().await;
    let late_event = DateTime::parse_from_rfc3339("2026-09-18T00:30:00-04:00")
        .unwrap()
        .with_timezone(&Utc);
    insert_raw_event(
        &pool,
        "01J00000000000000000000013",
        "site_a",
        late_event,
        "/late",
    )
    .await;
    insert_raw_event(
        &pool,
        "01J00000000000000000000014",
        "site_b",
        late_event,
        "/late",
    )
    .await;

    assert_eq!(processor.process_all_once().await.unwrap(), 2);
    let rows = sqlx::query("SELECT site_id, day, page_views FROM page_view_daily ORDER BY site_id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].get::<String, _>("site_id"), "site_a");
    assert_eq!(rows[1].get::<String, _>("site_id"), "site_b");
    assert_eq!(
        rows[0].get::<NaiveDate, _>("day"),
        NaiveDate::from_ymd_opt(2026, 9, 18).unwrap()
    );
    assert_eq!(rows[0].get::<i64, _>("page_views"), 1);
    assert_eq!(rows[1].get::<i64, _>("page_views"), 1);
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn failed_aggregate_update_leaves_event_unprocessed() {
    let (processor, pool) = setup().await;
    let day = Utc::now();
    insert_identified_event(
        &pool,
        "01J00000000000000000000015",
        "site_a",
        "00000000-0000-4000-8000-000000000015",
        day,
        "/failure",
    )
    .await;
    sqlx::query("ALTER TABLE analytics_rebuild_queue ADD CONSTRAINT reject_failure_fixture CHECK (site_id <> 'site_a')")
        .execute(&pool)
        .await
        .unwrap();

    assert!(processor.process_one().await.is_err());
    let processed = sqlx::query(
        "SELECT processed_at FROM raw_events WHERE event_id = '01J00000000000000000000015'",
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .get::<Option<DateTime<Utc>>, _>("processed_at");
    assert!(processed.is_none());

    for table in [
        "page_view_daily",
        "page_view_routes",
        "page_view_totals",
        "analytics_rebuild_queue",
    ] {
        let count = sqlx::query(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) AS count FROM {table}"
        )))
        .fetch_one(&pool)
        .await
        .unwrap()
        .get::<i64, _>("count");
        assert_eq!(count, 0, "{table} should be rolled back");
    }

    sqlx::query("ALTER TABLE analytics_rebuild_queue DROP CONSTRAINT reject_failure_fixture")
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn once_cli_processes_the_backlog() {
    let (_processor, pool) = setup().await;
    let day = Utc::now();
    insert_raw_event(&pool, "01J00000000000000000000016", "site_cli", day, "/cli").await;

    let revisions_before: serde_json::Value = sqlx::query_scalar(
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'site_id', site_id,
            'revision', revision,
            'definition_version', definition_version,
            'effective_at', effective_at,
            'created_at', created_at,
            'document', document
        ) ORDER BY site_id, revision), '[]'::jsonb) FROM site_definition_revisions",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let audit_before: serde_json::Value = sqlx::query_scalar(
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'resource', resource,
            'version', version,
            'operation', operation,
            'actor_kind', actor_kind,
            'changed_fields', changed_fields,
            'created_at', created_at,
            'expires_at', expires_at,
            'audit_id', audit_id
        ) ORDER BY audit_id), '[]'::jsonb)
         FROM configuration_audit WHERE resource->>'kind'='conversion_funnel_definitions'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let status = std::process::Command::new(env!("CARGO_BIN_EXE_processor"))
        .env("DATABASE_URL", database_url())
        .env(
            "ANALYTICS_DEFINITIONS_FILE",
            "/path/that/must/not/be-read/analytics-definitions.json",
        )
        .arg("--once")
        .status()
        .expect("processor binary should start");
    assert!(status.success());

    let revisions_after: serde_json::Value = sqlx::query_scalar(
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'site_id', site_id,
            'revision', revision,
            'definition_version', definition_version,
            'effective_at', effective_at,
            'created_at', created_at,
            'document', document
        ) ORDER BY site_id, revision), '[]'::jsonb) FROM site_definition_revisions",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let audit_after: serde_json::Value = sqlx::query_scalar(
        "SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'resource', resource,
            'version', version,
            'operation', operation,
            'actor_kind', actor_kind,
            'changed_fields', changed_fields,
            'created_at', created_at,
            'expires_at', expires_at,
            'audit_id', audit_id
        ) ORDER BY audit_id), '[]'::jsonb)
         FROM configuration_audit WHERE resource->>'kind'='conversion_funnel_definitions'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        revisions_after, revisions_before,
        "ordinary processing must not add or modify any definition revision"
    );
    assert_eq!(
        audit_after, audit_before,
        "ordinary processing must not add or modify definition import audit records"
    );

    let processed = sqlx::query(
        "SELECT processed_at FROM raw_events WHERE event_id = '01J00000000000000000000016'",
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .get::<Option<DateTime<Utc>>, _>("processed_at");
    assert!(processed.is_some());
}
