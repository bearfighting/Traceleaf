use axum::{body::Body, http::Request};
use chrono::Utc;
use collector::{
    config::{SiteConfig, SiteRegistry},
    geo::GeoEnrichment,
    http::router,
    protocol::{AnalyticsEvent, EventType, PageViewEvent},
    rate_limit::RateLimiter,
    security::KeyPolicy,
    sink::{EventSink, PostgresSink, SinkError, StoredEvent},
    validation::Validator,
};
use http_body_util::BodyExt;
use serde_json::json;
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use tower::ServiceExt;

fn database_url() -> String {
    std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to the integration PostgreSQL database")
}

async fn setup() -> (PostgresSink, PgPool) {
    let url = database_url();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .expect("integration database should be reachable");
    sqlx::query(
        "TRUNCATE analytics_rebuild_queue, dimension_event_facts, dimension_daily,
            normalized_event_context,
            session_events, sessions, visitor_event_facts, session_daily,
            visitor_daily, analytics_watermarks, analytics_generations,
            analytics_feature_flags, raw_events, page_view_daily,
            page_view_routes, page_view_totals RESTART IDENTITY CASCADE",
    )
    .execute(&pool)
    .await
    .expect("integration tables should be writable");
    sqlx::query("DELETE FROM analytics_feature_flags")
        .execute(&pool)
        .await
        .expect("feature flag table should be writable");
    sqlx::query("INSERT INTO site_registry (site_id) SELECT unnest(ARRAY['site_boundary', 'site_example', 'other_site', 'site_geo']::text[]) ON CONFLICT (site_id) DO NOTHING")
        .execute(&pool)
        .await
        .expect("Site Registry fixtures should be present");
    let sink = PostgresSink::connect(&url)
        .await
        .expect("Postgres sink should connect");
    (sink, pool)
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn received_at_is_ordered_after_a_committed_definition_revision() {
    let (sink, pool) = setup().await;
    let site_id = "site_boundary";
    let mut definition_tx = pool
        .begin()
        .await
        .expect("definition transaction should start");
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('definition-revision:' || $1, 0))")
        .bind(site_id)
        .execute(&mut *definition_tx)
        .await
        .expect("definition transaction should lock the site");
    let effective_at = sqlx::query_scalar::<_, chrono::DateTime<Utc>>("SELECT clock_timestamp()")
        .fetch_one(&mut *definition_tx)
        .await
        .expect("effective timestamp should be available");

    let mut event = stored_event(
        site_id,
        "01J00000000000000000000098",
        json!({"event_id":"01J00000000000000000000098","site_id":site_id}),
    );
    event.received_at = effective_at - chrono::Duration::seconds(1);
    let sink_task = tokio::spawn(async move { sink.accept(vec![event]).await });
    tokio::time::sleep(std::time::Duration::from_millis(25)).await;

    definition_tx
        .commit()
        .await
        .expect("definition transaction should commit");
    sink_task
        .await
        .expect("event sink task should complete")
        .expect("event should be accepted");

    let received_at = sqlx::query_scalar::<_, chrono::DateTime<Utc>>(
        "SELECT received_at FROM raw_events WHERE site_id=$1 AND event_id=$2",
    )
    .bind(site_id)
    .bind("01J00000000000000000000098")
    .fetch_one(&pool)
    .await
    .expect("accepted event should be queryable");
    assert!(
        received_at >= effective_at,
        "event received_at must follow the committed revision boundary"
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn stores_unified_metadata_without_protocol_feature_flags() {
    let (sink, pool) = setup().await;
    let visitor_id = "550e8400-e29b-41d4-a716-446655440000";
    let mut event = stored_event(
        "site_example",
        "01J00000000000000000000004",
        json!({
            "schema_version": 1,
            "event_id": "01J00000000000000000000004",
            "type": "page_view",
            "site_id": "site_example",
            "occurred_at": 1760000000000_i64,
            "path": "/v2",
            "visitor_id": visitor_id,
            "context_schema_version": 1
        }),
    );
    if let AnalyticsEvent::PageView(page_view) = &mut event.event {
        page_view.schema_version = 1;
        page_view.visitor_id = Some(visitor_id.to_owned());
        page_view.context_schema_version = Some(1);
    }

    sink.accept(vec![event])
        .await
        .expect("identified event should insert");
    let row = sqlx::query(
        "SELECT visitor_id::text AS visitor_id, context_schema_version, payload
         FROM raw_events WHERE event_id = $1",
    )
    .bind("01J00000000000000000000004")
    .fetch_one(&pool)
    .await
    .expect("identified raw event should be queryable");
    assert_eq!(row.get::<String, _>("visitor_id"), visitor_id);
    assert_eq!(row.get::<i32, _>("context_schema_version"), 1);
    assert_eq!(
        row.get::<serde_json::Value, _>("payload")["schema_version"],
        1
    );
}

fn stored_event(site_id: &str, event_id: &str, payload: serde_json::Value) -> StoredEvent {
    StoredEvent {
        event: AnalyticsEvent::PageView(PageViewEvent {
            schema_version: 1,
            event_id: event_id.to_owned(),
            event_type: EventType::PageView,
            site_id: site_id.to_owned(),
            occurred_at: 1_760_000_000_000,
            path: "/about".to_owned(),
            url: Some("https://example.com/about".to_owned()),
            title: Some("About".to_owned()),
            referrer: None,
            context: None,
            visitor_id: None,
            context_schema_version: None,
            extensions: Default::default(),
        }),
        payload,
        received_at: Utc::now(),
        geo: None,
    }
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn stores_raw_payload_and_applies_site_event_idempotency() {
    let (sink, pool) = setup().await;
    let payload = json!({
        "schema_version": 1,
        "event_id": "01J00000000000000000000000",
        "type": "page_view",
        "site_id": "site_example",
        "occurred_at": 1760000000000_i64,
        "path": "/about",
        "future_field": {"kept": true}
    });
    let duplicate = stored_event(
        "site_example",
        "01J00000000000000000000000",
        payload.clone(),
    );

    sink.accept(vec![duplicate.clone()])
        .await
        .expect("first insert should succeed");
    sink.accept(vec![duplicate])
        .await
        .expect("duplicate insert should be a successful no-op");
    sink.accept(vec![stored_event(
        "other_site",
        "01J00000000000000000000000",
        json!({"site_id": "other_site"}),
    )])
    .await
    .expect("same event id on another site should succeed");

    let rows = sqlx::query(
        "SELECT site_id, payload, processed_at, occurred_at, received_at, created_at
         FROM raw_events ORDER BY site_id",
    )
    .fetch_all(&pool)
    .await
    .expect("raw events should be queryable");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].get::<String, _>("site_id"), "other_site");
    assert_eq!(rows[1].get::<String, _>("site_id"), "site_example");
    assert_eq!(rows[1].get::<serde_json::Value, _>("payload"), payload);
    assert!(
        rows[1]
            .get::<Option<chrono::DateTime<Utc>>, _>("processed_at")
            .is_none()
    );
    assert!(
        rows[1]
            .get::<chrono::DateTime<Utc>, _>("occurred_at")
            .timestamp()
            > 0
    );
    assert!(rows[1].get::<chrono::DateTime<Utc>, _>("received_at") <= Utc::now());
    assert!(rows[1].get::<chrono::DateTime<Utc>, _>("created_at") <= Utc::now());

    let total_count = sqlx::query("SELECT COUNT(*) AS count FROM page_view_totals")
        .fetch_one(&pool)
        .await
        .expect("totals table should be queryable")
        .get::<i64, _>("count");
    assert_eq!(total_count, 0);
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn batch_rolls_back_when_a_later_event_cannot_be_stored() {
    let (sink, pool) = setup().await;
    let mut invalid = stored_event(
        "site_example",
        "01J00000000000000000000001",
        json!({"event_id": "01J00000000000000000000001"}),
    );
    if let AnalyticsEvent::PageView(page_view) = &mut invalid.event {
        page_view.occurred_at = i64::MAX;
    }

    let result = sink
        .accept(vec![
            stored_event(
                "site_example",
                "01J00000000000000000000002",
                json!({"event_id": "01J00000000000000000000002"}),
            ),
            invalid,
        ])
        .await;
    assert!(matches!(result, Err(SinkError::InvalidTimestamp)));

    let count = sqlx::query("SELECT COUNT(*) AS count FROM raw_events")
        .fetch_one(&pool)
        .await
        .expect("raw events should be queryable")
        .get::<i64, _>("count");
    assert_eq!(count, 0);
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn collector_http_writes_to_postgres_sink() {
    let (sink, pool) = setup().await;
    let site = SiteConfig {
        site_id: "site_example".to_owned(),
        environment: "production".to_owned(),
        enabled: true,
        allowed_origins: vec!["https://example.com".to_owned()],
        ingest_keys: vec!["production-key".to_owned()],
        rate_limit_per_minute: 600,
        ingest_key_digests: Vec::new(),
    };
    let policy = KeyPolicy::new(
        SiteRegistry::from_sites(vec![site]).expect("test site config should be valid"),
    );
    let app = router(
        Validator::new().expect("event schemas should compile"),
        sink,
        policy,
        RateLimiter::new(),
    );
    let request = Request::builder()
        .method("POST")
        .uri("/v1/events")
        .header("content-type", "application/json")
        .header("origin", "https://example.com")
        .header("x-ingest-key", "production-key")
        .body(Body::from(
            json!({
                "schema_version": 1,
                "events": [{
                    "schema_version": 1,
                    "event_id": "01J00000000000000000000003",
                    "type": "page_view",
                    "site_id": "site_example",
                    "occurred_at": 1760000000000_i64,
                    "path": "/from-http",
                    "future_field": "preserved"
                }]
            })
            .to_string(),
        ))
        .expect("request should build");

    let response = app.oneshot(request).await.expect("request should complete");
    assert_eq!(response.status(), 202);
    let _ = response
        .into_body()
        .collect()
        .await
        .expect("response body should be readable");

    let row = sqlx::query("SELECT payload FROM raw_events WHERE event_id = $1")
        .bind("01J00000000000000000000003")
        .fetch_one(&pool)
        .await
        .expect("HTTP event should be stored");
    assert_eq!(
        row.get::<serde_json::Value, _>("payload")["future_field"],
        "preserved"
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn stores_country_enrichment_without_persisting_client_ip() {
    let (sink, pool) = setup().await;
    let mut event = stored_event(
        "site_geo",
        "01J00000000000000000000091",
        json!({"schema_version":1,"event_id":"01J00000000000000000000091","type":"page_view","site_id":"site_geo","occurred_at":1760000000000_i64,"path":"/geo"}),
    );
    event.geo = Some(GeoEnrichment {
        country_code: "CA".to_owned(),
        provider: "maxmind".to_owned(),
        dataset_version: "GeoLite2-Country-20260918".to_owned(),
        parser_version: "1".to_owned(),
    });
    sink.accept(vec![event])
        .await
        .expect("event should be stored");
    let row = sqlx::query(
        "SELECT r.payload, m.country_code, m.provider, m.dataset_version, m.parser_version
         FROM raw_events r JOIN geo_event_metadata m ON m.raw_event_id=r.id
         WHERE r.site_id='site_geo' AND r.event_id='01J00000000000000000000091'",
    )
    .fetch_one(&pool)
    .await
    .expect("country enrichment should be stored");
    let payload: serde_json::Value = row.get("payload");
    assert_eq!(row.get::<String, _>("country_code"), "CA");
    assert_eq!(row.get::<String, _>("provider"), "maxmind");
    assert_eq!(
        row.get::<String, _>("dataset_version"),
        "GeoLite2-Country-20260918"
    );
    assert_eq!(row.get::<String, _>("parser_version"), "1");
    assert!(payload.get("ip").is_none());
    assert!(payload.get("client_ip").is_none());
}
