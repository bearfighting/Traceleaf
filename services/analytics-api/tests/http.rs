use analytics_api::{AdminTokens, router, state, state_with_admin_tokens};
use axum::{
    body::to_bytes,
    http::{Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use configuration_runtime::CapabilityRuntime;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{env, time::Duration};
use tower::ServiceExt;

async fn pool() -> PgPool {
    PgPoolOptions::new()
        .max_connections(2)
        .connect(&env::var("DATABASE_URL").expect("DATABASE_URL is required"))
        .await
        .expect("database should be available")
}

async fn body(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("body should be readable");
    serde_json::from_slice(&bytes).expect("response should be JSON")
}

async fn seed_capabilities(pool: &PgPool, site_id: &str) {
    sqlx::query("INSERT INTO site_registry (site_id) VALUES ($1) ON CONFLICT (site_id) DO NOTHING")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    let updated_at = Utc::now();
    let timestamp = updated_at.to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let capabilities = [
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
    .into_iter()
    .map(|name| {
        (
            name.to_owned(),
            serde_json::json!({"enabled":true,"settings":{}}),
        )
    })
    .collect::<serde_json::Map<_, _>>();
    let document = serde_json::json!({
        "schema_version": 1, "site_id": site_id, "version": 1, "updated_at": timestamp,
        "capabilities": capabilities, "consent_policy": "required",
        "privacy_constraints": ["no_ip_persistence","no_fingerprinting","consent_required"]
    });
    sqlx::query("INSERT INTO site_capability_configurations (site_id, version, updated_at, document) VALUES ($1, 1, $2, $3) ON CONFLICT (site_id) DO UPDATE SET version=1, updated_at=EXCLUDED.updated_at, document=EXCLUDED.document")
        .bind(site_id).bind(updated_at).bind(document).execute(pool).await.unwrap();
    sqlx::query("DELETE FROM site_capability_activation_windows WHERE site_id=$1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO site_capability_activation_windows(site_id,capability_id,enabled_since) SELECT $1, capability_id, '0001-01-01T00:00:00Z' FROM unnest(ARRAY['page_views','browser_context','anonymous_visitors','sessions','dimensions','custom_events','web_vitals','conversions','funnels','geo']::text[]) AS capability_id")
        .bind(site_id).execute(pool).await.unwrap();
}

async fn reset(pool: &PgPool, site_id: &str) {
    sqlx::query("DELETE FROM configuration_capability_runtime_state WHERE site_id=$1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_capability_configurations WHERE site_id=$1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    for table in ["page_view_routes", "page_view_daily", "page_view_totals"] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE site_id = $1"
        )))
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    }
    seed_capabilities(pool, site_id).await;
}

async fn reset_phase6(pool: &PgPool, site_id: &str) {
    sqlx::query("DELETE FROM configuration_capability_runtime_state WHERE site_id=$1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    for table in [
        "geo_country_facts",
        "geo_event_metadata",
        "dimension_event_facts",
        "dimension_daily",
        "session_events",
        "sessions",
        "visitor_event_facts",
        "visitor_daily",
        "session_daily",
        "analytics_watermarks",
        "analytics_rebuild_queue",
        "analytics_generations",
        "analytics_feature_flags",
        "site_capability_configurations",
        "raw_events",
        "page_view_daily",
        "page_view_routes",
        "page_view_totals",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE site_id = $1"
        )))
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    }
    seed_capabilities(pool, site_id).await;
}

fn app(pool: PgPool) -> axum::Router {
    router(state(pool).expect("embedded schemas compile"))
}

async fn assert_historical_overview(pool: &PgPool, site: &str) {
    let response = app(pool.clone())
        .oneshot(
            Request::get(format!("/v1/sites/{site}/overview"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body(response).await["page_views"], 7);
}

fn admin_app(pool: PgPool, token: &str) -> axum::Router {
    let configured = AdminTokens::parse(&format!("[\"{token}\"]")).unwrap();
    router(state_with_admin_tokens(
        state(pool).expect("embedded schemas compile"),
        Some(configured),
    ))
}

fn site_creation_request(
    token: &str,
    idempotency_key: &str,
    request: serde_json::Value,
) -> Request<axum::body::Body> {
    Request::post("/v1/admin/sites")
        .header("authorization", format!("Bearer {token}"))
        .header("idempotency-key", idempotency_key)
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::to_vec(&request).unwrap(),
        ))
        .unwrap()
}

fn site_creation_fixture() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../protocol/contracts/configuration/current/fixtures/site-management-cases.json"
    ))
    .unwrap()
}

fn capability_document(site_id: &str) -> (DateTime<Utc>, serde_json::Value) {
    let now = Utc::now();
    let timestamp = now.to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let capabilities = [
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
    .into_iter()
    .map(|name| {
        (
            name.to_owned(),
            serde_json::json!({"enabled":true,"settings":{}}),
        )
    })
    .collect::<serde_json::Map<_, _>>();
    let document = serde_json::json!({
        "schema_version":1,
        "site_id":site_id,
        "version":1,
        "updated_at":timestamp,
        "capabilities":capabilities,
        "consent_policy":"required",
        "privacy_constraints":["no_ip_persistence","no_fingerprinting","consent_required"]
    });
    (now, document)
}

async fn clear_configuration_site(pool: &PgPool, site_id: &str) {
    sqlx::query("DELETE FROM configuration_runtime_state WHERE site_id = $1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM configuration_audit WHERE resource->>'site_id' = $1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_environment_policies WHERE site_id = $1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_capability_configurations WHERE site_id = $1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM analytics_feature_flags WHERE site_id = $1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO site_registry (site_id) VALUES ($1) ON CONFLICT (site_id) DO NOTHING")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
}

#[path = "http/analytics_reports.rs"]
mod analytics_reports;
#[path = "http/capability_runtime.rs"]
mod capability_runtime;
#[path = "http/configuration.rs"]
mod configuration;
#[path = "http/site_management.rs"]
mod site_management;
