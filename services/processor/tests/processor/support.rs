use chrono::{DateTime, Utc};
use processor::Processor;
use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};

pub(super) fn database_url() -> String {
    std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to the integration PostgreSQL database")
}

pub(super) async fn ensure_site_registry(pool: &PgPool, site_id: &str) {
    sqlx::query("INSERT INTO site_registry (site_id) VALUES ($1) ON CONFLICT (site_id) DO NOTHING")
        .bind(site_id)
        .execute(pool)
        .await
        .expect("Site Registry fixture should be present");
}

pub(super) async fn seed_capabilities(
    pool: &PgPool,
    site_id: &str,
    extended_dimensions_enabled: bool,
) {
    ensure_site_registry(pool, site_id).await;
    let updated_at = Utc::now();
    let timestamp = updated_at.to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let enabled = extended_dimensions_enabled;
    let capabilities = serde_json::json!({
        "page_views":{"enabled":true,"settings":{}},
        "browser_context":{"enabled":enabled,"settings":{}},
        "anonymous_visitors":{"enabled":enabled,"settings":{}},
        "sessions":{"enabled":enabled,"settings":{}},
        "dimensions":{"enabled":enabled,"settings":{}},
        "custom_events":{"enabled":true,"settings":{}},
        "web_vitals":{"enabled":true,"settings":{}},
        "conversions":{"enabled":true,"settings":{}},
        "funnels":{"enabled":true,"settings":{}},
        "geo":{"enabled":true,"settings":{}}
    });
    let document = serde_json::json!({
        "schema_version":1,"site_id":site_id,"version":1,"updated_at":timestamp,
        "capabilities":capabilities,"consent_policy":"required",
        "privacy_constraints":["no_ip_persistence","no_fingerprinting","consent_required"]
    });
    sqlx::query("INSERT INTO site_capability_configurations(site_id,version,updated_at,document) VALUES($1,1,$2,$3) ON CONFLICT(site_id) DO UPDATE SET version=1,updated_at=EXCLUDED.updated_at,document=EXCLUDED.document")
        .bind(site_id).bind(updated_at).bind(document).execute(pool).await.unwrap();
    sqlx::query("DELETE FROM site_capability_activation_windows WHERE site_id=$1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    let enabled_ids: &[&str] = if extended_dimensions_enabled {
        &[
            "page_views",
            "browser_context",
            "anonymous_visitors",
            "sessions",
            "dimensions",
            "custom_events",
            "web_vitals",
            "conversions",
            "funnels",
            "geo",
        ]
    } else {
        &[
            "page_views",
            "custom_events",
            "web_vitals",
            "conversions",
            "funnels",
            "geo",
        ]
    };
    for capability_id in enabled_ids {
        sqlx::query("INSERT INTO site_capability_activation_windows(site_id,capability_id,enabled_since) VALUES($1,$2,'0001-01-01T00:00:00Z')")
            .bind(site_id).bind(capability_id).execute(pool).await.unwrap();
    }
}

pub(super) async fn setup() -> (Processor, PgPool) {
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&database_url())
        .await
        .expect("integration database should be reachable");
    sqlx::query("TRUNCATE configuration_capability_runtime_state, configuration_capability_runtime_instances, site_capability_configurations CASCADE")
        .execute(&pool).await.expect("capability runtime state should be writable");
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
    .expect("aggregate tables should be writable");
    let processor = Processor::connect(&database_url())
        .await
        .expect("processor should connect");
    (processor, pool)
}

pub(super) async fn insert_raw_event(
    pool: &PgPool,
    id: &str,
    site_id: &str,
    occurred_at: DateTime<Utc>,
    path: &str,
) {
    ensure_site_registry(pool, site_id).await;
    seed_capabilities(pool, site_id, true).await;
    sqlx::query(
        "INSERT INTO raw_events
            (site_id, event_id, schema_version, event_type, occurred_at,
             received_at, path, payload)
         VALUES ($1, $2, 1, 'page_view', $3, NOW(), $4, $5)",
    )
    .bind(site_id)
    .bind(id)
    .bind(occurred_at)
    .bind(path)
    .bind(json!({
        "schema_version": 1,
        "event_id": id,
        "type": "page_view",
        "site_id": site_id,
        "occurred_at": occurred_at.timestamp_millis(),
        "path": path
    }))
    .execute(pool)
    .await
    .expect("raw event should be insertable");
}

pub(super) async fn insert_identified_event(
    pool: &PgPool,
    id: &str,
    site_id: &str,
    visitor_id: &str,
    occurred_at: DateTime<Utc>,
    path: &str,
) {
    ensure_site_registry(pool, site_id).await;
    seed_capabilities(pool, site_id, true).await;
    sqlx::query(
        "INSERT INTO raw_events
            (site_id, event_id, schema_version, event_type, occurred_at,
             received_at, path, payload, visitor_id, context_schema_version)
         VALUES ($1, $2, 1, 'page_view', $3, $3 + INTERVAL '1 minute', $4, $5, $6::uuid, 1)",
    )
    .bind(site_id)
    .bind(id)
    .bind(occurred_at)
    .bind(path)
    .bind(json!({
        "schema_version": 1,
        "event_id": id,
        "type": "page_view",
        "site_id": site_id,
        "visitor_id": visitor_id,
        "occurred_at": occurred_at.timestamp_millis(),
        "path": path,
        "context_schema_version": 1,
        "context": {
            "language": "en-CA",
            "timezone": "America/Toronto",
            "viewport_width": 1280,
            "viewport_height": 720,
            "screen_width": 1920,
            "screen_height": 1080,
            "referrer": "https://example.com/previous",
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
        }
    }))
    .bind(visitor_id)
    .execute(pool)
    .await
    .expect("identified raw event should be insertable");
}
