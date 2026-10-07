use super::support::*;
use chrono::{DateTime, NaiveDate, Utc};
use processor::Processor;
use serde_json::json;
use sqlx::{PgPool, Row};

async fn cleanup_generation_metadata(pool: &PgPool) {
    for table in [
        "analytics_watermarks",
        "analytics_generations",
        "analytics_feature_flags",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!("DELETE FROM {table}")))
            .execute(pool)
            .await
            .expect("generation metadata should be cleanable");
    }
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn rollback_generation_is_atomic_and_selects_only_retired_targets() {
    let (processor, pool) = setup().await;
    cleanup_generation_metadata(&pool).await;

    let active_generation = "00000000-0000-4000-8000-000000000011";
    let retired_generation = "00000000-0000-4000-8000-000000000012";
    sqlx::query(
        "INSERT INTO analytics_generations
            (generation_id, site_id, aggregation_version, parser_version,
             rebuild_reason, status)
         VALUES
            ($1::uuid, 'site_processor', 1, 'woothee-0.13.0', 'initial', 'active'),
            ($2::uuid, 'site_processor', 1, 'woothee-0.13.0', 'backfill', 'retired')",
    )
    .bind(active_generation)
    .bind(retired_generation)
    .execute(&pool)
    .await
    .expect("rollback generations should be insertable");

    processor
        .rollback_generation("site_processor", retired_generation)
        .await
        .expect("retired generation should become active");

    let statuses = sqlx::query(
        "SELECT generation_id::text AS generation_id, status
         FROM analytics_generations
         WHERE site_id = 'site_processor'
         ORDER BY generation_id",
    )
    .fetch_all(&pool)
    .await
    .expect("generation statuses should be queryable");
    assert_eq!(statuses.len(), 2);
    assert_eq!(statuses[0].get::<String, _>("status"), "retired");
    assert_eq!(statuses[1].get::<String, _>("status"), "active");

    let result = processor
        .rollback_generation("site_processor", retired_generation)
        .await;
    assert!(result.is_err());

    let active_count = sqlx::query(
        "SELECT COUNT(*) AS count
         FROM analytics_generations
         WHERE site_id = 'site_processor' AND status = 'active'",
    )
    .fetch_one(&pool)
    .await
    .expect("active generation count should be queryable")
    .get::<i64, _>("count");
    assert_eq!(active_count, 1);

    cleanup_generation_metadata(&pool).await;
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn rebuild_writes_generation_facts_without_mutating_raw_payload() {
    let (processor, pool) = setup().await;
    let site_id = "site_phase6_processor";
    ensure_site_registry(&pool, site_id).await;
    let visitor_id = "550e8400-e29b-41d4-a716-446655440000";
    let second_visitor_id = "550e8400-e29b-41d4-a716-446655440001";
    sqlx::query(
        "INSERT INTO analytics_feature_flags (site_id, analytics_enabled)
         VALUES ($1, TRUE)",
    )
    .bind(site_id)
    .execute(&pool)
    .await
    .unwrap();

    let first = DateTime::parse_from_rfc3339("2026-09-18T23:30:00Z")
        .unwrap()
        .with_timezone(&Utc);
    insert_identified_event(
        &pool,
        "01J00000000000000000000020",
        site_id,
        visitor_id,
        first,
        "/first",
    )
    .await;
    insert_identified_event(
        &pool,
        "01J00000000000000000000021",
        site_id,
        visitor_id,
        first + chrono::Duration::minutes(10),
        "/same-session",
    )
    .await;
    insert_identified_event(
        &pool,
        "01J00000000000000000000022",
        site_id,
        visitor_id,
        first + chrono::Duration::minutes(40),
        "/new-session",
    )
    .await;
    insert_identified_event(
        &pool,
        "01J00000000000000000000025",
        site_id,
        second_visitor_id,
        first + chrono::Duration::minutes(5),
        "/second-visitor",
    )
    .await;

    let original_payload = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM raw_events WHERE site_id = $1 AND event_id = $2",
    )
    .bind(site_id)
    .bind("01J00000000000000000000020")
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(processor.process_all_once().await.unwrap(), 4);

    let generation_id = sqlx::query_scalar::<_, String>(
        "SELECT generation_id::text FROM analytics_generations
         WHERE site_id = $1 AND status = 'active'",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let visitor_facts = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM visitor_event_facts WHERE generation_id = $1::uuid",
    )
    .bind(&generation_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let session_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sessions WHERE generation_id = $1::uuid",
    )
    .bind(&generation_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let normalized_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM normalized_event_context WHERE generation_id = $1::uuid",
    )
    .bind(&generation_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let dimension_fact_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM dimension_event_facts WHERE generation_id = $1::uuid",
    )
    .bind(&generation_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(visitor_facts, 4);
    assert_eq!(session_count, 3);
    assert_eq!(normalized_count, 4);
    assert_eq!(dimension_fact_count, 24);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT page_views FROM dimension_daily
             WHERE generation_id = $1::uuid AND site_id = $2
               AND day = $3 AND dimension = 'browser' AND value = 'unknown'",
        )
        .bind(&generation_id)
        .bind(site_id)
        .bind(first.date_naive())
        .fetch_one(&pool)
        .await
        .unwrap(),
        3
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT unique_visitors FROM visitor_daily
             WHERE generation_id = $1::uuid AND site_id = $2 AND day = $3",
        )
        .bind(&generation_id)
        .bind(site_id)
        .bind(first.date_naive())
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
    assert!(
        sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT source_watermark FROM analytics_generations
             WHERE generation_id = $1::uuid",
        )
        .bind(&generation_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .get("visitor_session")
        .is_some()
    );
    assert!(
        sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT source_watermark FROM analytics_generations
             WHERE generation_id = $1::uuid",
        )
        .bind(&generation_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .get("dimensions")
        .is_some()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM analytics_watermarks
             WHERE site_id = $1 AND generation_id IS NULL AND source_name = 'page_views'",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );

    let payload_after = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM raw_events WHERE site_id = $1 AND event_id = $2",
    )
    .bind(site_id)
    .bind("01J00000000000000000000020")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(payload_after, original_payload);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM analytics_generations
             WHERE site_id = $1 AND status = 'active'",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn failed_generation_rebuild_rolls_back_partial_facts_and_preserves_active_generation() {
    let (processor, pool) = setup().await;
    let site_id = "site_generation_failure";
    let occurred_at = DateTime::parse_from_rfc3339("2026-09-18T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let visitor_id = "550e8400-e29b-41d4-a716-446655440099";
    insert_identified_event(
        &pool,
        "01J00000000000000000000990",
        site_id,
        visitor_id,
        occurred_at,
        "/rollback",
    )
    .await;
    sqlx::query(
        "INSERT INTO analytics_feature_flags (site_id, analytics_enabled)
         VALUES ($1, TRUE)",
    )
    .bind(site_id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(processor.process_all_once().await.unwrap(), 1);

    let day = occurred_at.date_naive();
    processor
        .rebuild_site(site_id, day, day, "initial", "woothee-0.13.0", false)
        .await
        .unwrap();
    let active_generation_id = sqlx::query_scalar::<_, String>(
        "SELECT generation_id::text FROM analytics_generations
         WHERE site_id = $1 AND status = 'active'",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        "ALTER TABLE visitor_event_facts
         ADD CONSTRAINT reject_generation_failure_fixture
         CHECK (site_id <> 'site_generation_failure') NOT VALID",
    )
    .execute(&pool)
    .await
    .expect("test constraint should isolate failure to visitor facts");
    let rebuild_result = processor
        .rebuild_site(site_id, day, day, "backfill", "woothee-0.13.0", false)
        .await;
    sqlx::query(
        "ALTER TABLE visitor_event_facts DROP CONSTRAINT reject_generation_failure_fixture",
    )
    .execute(&pool)
    .await
    .expect("test constraint should be removed before assertions");
    assert!(
        rebuild_result.is_err(),
        "visitor fact constraint must fail rebuild"
    );

    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT generation_id::text FROM analytics_generations
             WHERE site_id = $1 AND status = 'active'",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        active_generation_id
    );
    let (failed_generation_id, failure_reason) = sqlx::query_as::<_, (String, String)>(
        "SELECT generation_id::text, failure_reason FROM analytics_generations
         WHERE site_id = $1 AND status = 'failed'",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .expect("failed generation should be recorded outside the rolled-back transaction");
    assert!(
        failure_reason.contains("reject_generation_failure_fixture"),
        "rebuild should fail at the visitor fact constraint, got: {failure_reason}"
    );
    for table in [
        "normalized_event_context",
        "visitor_event_facts",
        "visitor_daily",
        "sessions",
        "session_events",
        "session_daily",
        "dimension_event_facts",
        "dimension_daily",
        "analytics_watermarks",
    ] {
        let count = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM {table} WHERE generation_id = $1::uuid"
        )))
        .bind(&failed_generation_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 0, "failed generation left rows in {table}");
    }
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn disabled_extended_capabilities_keep_page_view_workflow_without_rebuild_queue() {
    let (processor, pool) = setup().await;
    insert_raw_event(
        &pool,
        "01J00000000000000000000023",
        "site_phase6_disabled",
        "2026-09-18T12:00:00Z".parse().unwrap(),
        "/legacy",
    )
    .await;

    assert_eq!(processor.process_all_once().await.unwrap(), 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT page_views FROM page_view_totals WHERE site_id = $1",)
            .bind("site_phase6_disabled")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM analytics_rebuild_queue")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn no_visitor_event_contributes_dimensions_only_after_site_rebuild() {
    let (processor, pool) = setup().await;
    let site_id = "site_phase6_no_visitor";
    seed_capabilities(&pool, site_id, true).await;
    let occurred_at: DateTime<Utc> = "2026-09-18T12:00:00Z".parse().unwrap();
    sqlx::query(
        "INSERT INTO analytics_feature_flags (site_id, analytics_enabled)
         VALUES ($1, TRUE)",
    )
    .bind(site_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO raw_events
            (site_id, event_id, schema_version, event_type, occurred_at,
             received_at, path, payload, context_schema_version)
         VALUES ($1, $2, 1, 'page_view', $3, $3 + INTERVAL '1 minute', '/', $4, 1)",
    )
    .bind(site_id)
    .bind("01J00000000000000000000030")
    .bind(occurred_at)
    .bind(json!({
        "schema_version": 1,
        "event_id": "01J00000000000000000000030",
        "type": "page_view",
        "site_id": site_id,
        "occurred_at": occurred_at.timestamp_millis(),
        "path": "/",
        "context_schema_version": 1,
        "context": {
            "language": "en-CA",
            "timezone": "America/Toronto",
            "referrer": "https://example.com/previous",
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
        }
    }))
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(processor.process_all_once().await.unwrap(), 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM analytics_rebuild_queue WHERE site_id = $1",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );

    processor
        .rebuild_site(
            site_id,
            occurred_at.date_naive(),
            occurred_at.date_naive(),
            "initial",
            "woothee-0.13.0",
            false,
        )
        .await
        .unwrap();
    let generation_id = sqlx::query_scalar::<_, String>(
        "SELECT generation_id::text FROM analytics_generations
         WHERE site_id = $1 AND status = 'active'",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM dimension_event_facts
             WHERE generation_id = $1::uuid AND site_id = $2",
        )
        .bind(&generation_id)
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        6
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM visitor_event_facts
             WHERE generation_id = $1::uuid AND site_id = $2",
        )
        .bind(&generation_id)
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM session_events
             WHERE generation_id = $1::uuid AND site_id = $2",
        )
        .bind(&generation_id)
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn disabled_extended_capabilities_pause_pending_rebuild_without_activation() {
    let (processor, pool) = setup().await;
    let site_id = "site_paused_queue";
    ensure_site_registry(&pool, site_id).await;
    let day = NaiveDate::from_ymd_opt(2026, 9, 18).unwrap();

    sqlx::query(
        "INSERT INTO analytics_feature_flags (site_id, analytics_enabled)
         VALUES ($1, FALSE)",
    )
    .bind(site_id)
    .execute(&pool)
    .await
    .unwrap();
    seed_capabilities(&pool, site_id, false).await;
    processor
        .enqueue_rebuild(site_id, day, day, "incremental", "woothee-0.13.0")
        .await
        .unwrap();

    assert!(!processor.process_rebuild_queue_once().await.unwrap());
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT status FROM analytics_rebuild_queue WHERE site_id = $1",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        "pending"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM analytics_generations WHERE site_id = $1",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn rebuild_queue_deduplicates_same_site_scope() {
    let (processor, pool) = setup().await;
    let day = NaiveDate::from_ymd_opt(2026, 9, 18).unwrap();
    processor
        .enqueue_rebuild("site_queue", day, day, "incremental", "woothee-0.13.0")
        .await
        .unwrap();
    processor
        .enqueue_rebuild("site_queue", day, day, "backfill", "woothee-0.13.0")
        .await
        .unwrap();
    processor
        .enqueue_rebuild("site_queue", day, day, "incremental", "woothee-0.13.0")
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM analytics_rebuild_queue
             WHERE site_id = 'site_queue'",
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT rebuild_reason FROM analytics_rebuild_queue
             WHERE site_id = 'site_queue'",
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "backfill"
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn concurrent_queue_workers_publish_one_generation_without_failed_duplicate() {
    let (processor, pool) = setup().await;
    let second_processor = Processor::connect(&database_url()).await.unwrap();
    let site_id = "site_concurrent_queue";
    ensure_site_registry(&pool, site_id).await;
    let visitor_id = "550e8400-e29b-41d4-a716-446655440000";
    let occurred_at: DateTime<Utc> = "2026-09-18T12:00:00Z".parse().unwrap();

    sqlx::query(
        "INSERT INTO analytics_feature_flags (site_id, analytics_enabled)
         VALUES ($1, TRUE)",
    )
    .bind(site_id)
    .execute(&pool)
    .await
    .unwrap();
    insert_identified_event(
        &pool,
        "01J00000000000000000000026",
        site_id,
        visitor_id,
        occurred_at,
        "/concurrent",
    )
    .await;

    assert!(processor.process_one().await.unwrap());
    let (left, right) = tokio::join!(
        processor.process_rebuild_queue_once(),
        second_processor.process_rebuild_queue_once()
    );
    let left = left.unwrap();
    let right = right.unwrap();
    assert!(left || right);

    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM analytics_generations
             WHERE site_id = $1 AND status = 'active'",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM analytics_generations
             WHERE site_id = $1 AND status = 'failed'",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT status FROM analytics_rebuild_queue WHERE site_id = $1",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        "completed"
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn late_events_over_24_hours_wait_for_explicit_backfill() {
    let (processor, pool) = setup().await;
    let site_id = "site_backfill";
    ensure_site_registry(&pool, site_id).await;
    let visitor_id = "550e8400-e29b-41d4-a716-446655440000";
    sqlx::query(
        "INSERT INTO analytics_feature_flags (site_id, analytics_enabled)
         VALUES ($1, TRUE)",
    )
    .bind(site_id)
    .execute(&pool)
    .await
    .unwrap();
    insert_identified_event(
        &pool,
        "01J00000000000000000000024",
        site_id,
        visitor_id,
        "2026-09-18T12:00:00Z".parse().unwrap(),
        "/late",
    )
    .await;
    sqlx::query(
        "UPDATE raw_events
         SET received_at = occurred_at + INTERVAL '25 hours'
         WHERE site_id = $1",
    )
    .bind(site_id)
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(processor.process_all_once().await.unwrap(), 1);
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT rebuild_reason FROM analytics_rebuild_queue WHERE site_id = $1",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        "backfill"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM analytics_generations WHERE site_id = $1",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );

    processor
        .rebuild_site(
            site_id,
            NaiveDate::from_ymd_opt(2026, 9, 18).unwrap(),
            NaiveDate::from_ymd_opt(2026, 9, 18).unwrap(),
            "backfill",
            "woothee-0.13.0",
            false,
        )
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT status FROM analytics_rebuild_queue WHERE site_id = $1",
        )
        .bind(site_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        "completed"
    );
}
