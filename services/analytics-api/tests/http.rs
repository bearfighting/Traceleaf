use analytics_api::{AdminTokens, router, state, state_with_admin_tokens};
use axum::{
    body::to_bytes,
    http::{Request, StatusCode},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
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
    router(state(pool))
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and PostgreSQL"]
async fn analytics_http_contract_returns_aggregates_and_validates_queries() {
    let pool = pool().await;
    let site = "analytics_api_test";
    reset(&pool, site).await;
    sqlx::query("INSERT INTO page_view_totals (site_id, page_views) VALUES ($1, 9)")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO page_view_daily (site_id, day, page_views) VALUES ($1, '2026-09-18', 3), ($1, '2026-09-19', 2)")
        .bind(site).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO page_view_routes (site_id, day, path, page_views) VALUES ($1, '2026-09-18', '/', 2), ($1, '2026-09-18', '/about', 1), ($1, '2026-09-19', '/about', 2)")
        .bind(site).execute(&pool).await.unwrap();

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!("/v1/sites/{site}/overview"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(body(response).await["page_views"], 9);

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-19/overview"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(body(response).await["page_views"], 5);

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-19/timeline"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        body(response).await["items"],
        serde_json::json!([
            {"day":"2026-09-18", "page_views":3},
            {"day":"2026-09-19", "page_views":2}
        ])
    );

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-19/pages?limit=2"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        body(response).await["items"],
        serde_json::json!([
            {"path":"/about", "page_views":3}, {"path":"/", "page_views":2}
        ])
    );

    sqlx::query("INSERT INTO page_view_routes (site_id, day, path, page_views) VALUES ($1, '2026-09-18', '/contact', 2)")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-19/pages"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(
        body(response).await["items"],
        serde_json::json!([
            {"path":"/about", "page_views":3},
            {"path":"/", "page_views":2},
            {"path":"/contact", "page_views":2}
        ])
    );

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-19/2026-09-18/overview"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    assert_eq!(body(response).await["error"]["code"], "invalid_date_range");

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2025-01-01/2026-01-02/overview"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    assert_eq!(
        body(response).await["error"]["code"],
        "date_range_too_large"
    );

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-19/pages?limit=0"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    assert_eq!(body(response).await["error"]["code"], "invalid_limit");

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-19/pages?limit=1&limit=2"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    assert_eq!(body(response).await["error"]["code"], "invalid_limit");

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-02-30/2026-03-01/overview"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    assert_eq!(body(response).await["error"]["code"], "invalid_date_range");

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-18/overview"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(body(response).await["page_views"], 3);

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2025-01-01/2025-01-02/pages"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(body(response).await["items"], serde_json::json!([]));

    let response = app(pool.clone())
        .oneshot(
            Request::get("/v1/sites/site_missing/reports/2026-09-18/2026-09-19/timeline")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let response = app(pool.clone())
        .oneshot(
            Request::get("/v1/sites/site_missing/overview")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    reset(&pool, site).await;
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and PostgreSQL"]
async fn phase6_reports_use_active_generation_distincts_and_watermarks() {
    let pool = pool().await;
    let site = "analytics_api_phase6";
    reset_phase6(&pool, site).await;

    let generation = "00000000-0000-4000-8000-000000000101";
    let visitor_a = "550e8400-e29b-41d4-a716-446655440000";
    let visitor_b = "550e8400-e29b-41d4-a716-446655440001";
    let session_a = "00000000-0000-4000-8000-000000000201";
    let session_b = "00000000-0000-4000-8000-000000000202";
    let first_day = "2026-09-18";
    let second_day = "2026-09-19";

    sqlx::query(
        "INSERT INTO analytics_feature_flags (site_id, analytics_enabled)
         VALUES ($1, TRUE)",
    )
    .bind(site)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO analytics_generations
            (generation_id, site_id, aggregation_version, parser_version,
             rebuild_reason, status, activated_at)
         VALUES ($1::uuid, $2, 1, 'woothee-0.13.0', 'initial', 'active', '2026-09-19T12:00:00Z')",
    )
    .bind(generation)
    .bind(site)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO page_view_daily (site_id, day, page_views)
         VALUES ($1, $2::date, 2), ($1, $3::date, 1)",
    )
    .bind(site)
    .bind(first_day)
    .bind(second_day)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO visitor_daily
            (generation_id, site_id, day, unique_visitors, page_views)
         VALUES ($1::uuid, $2, $3::date, 1, 1), ($1::uuid, $2, $4::date, 2, 2)",
    )
    .bind(generation)
    .bind(site)
    .bind(first_day)
    .bind(second_day)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO session_daily
            (generation_id, site_id, day, sessions, page_views)
         VALUES ($1::uuid, $2, $3::date, 1, 1), ($1::uuid, $2, $4::date, 1, 2)",
    )
    .bind(generation)
    .bind(site)
    .bind(first_day)
    .bind(second_day)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO sessions
            (generation_id, session_id, site_id, visitor_id, started_at, ended_at, page_views)
         VALUES
            ($1::uuid, $2::uuid, $3, $4::uuid, '2026-09-18T10:00:00Z', '2026-09-18T10:01:00Z', 1),
            ($1::uuid, $5::uuid, $3, $6::uuid, '2026-09-19T10:00:00Z', '2026-09-19T10:01:00Z', 2)",
    )
    .bind(generation)
    .bind(session_a)
    .bind(site)
    .bind(visitor_a)
    .bind(session_b)
    .bind(visitor_b)
    .execute(&pool)
    .await
    .unwrap();

    let mut raw_ids = Vec::new();
    for (event_id, occurred_at) in [
        ("01J00000000000000000000101", "2026-09-18T10:00:00Z"),
        ("01J00000000000000000000102", "2026-09-19T10:00:00Z"),
        ("01J00000000000000000000103", "2026-09-19T10:01:00Z"),
    ] {
        let occurred_at = occurred_at.parse::<DateTime<Utc>>().unwrap();
        let id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO raw_events
                (site_id, event_id, schema_version, event_type, occurred_at, received_at, path, payload, processed_at)
             VALUES ($1, $2, 2, 'page_view', $3, $3, '/', '{}'::jsonb, NOW())
             RETURNING id",
        )
        .bind(site)
        .bind(event_id)
        .bind(occurred_at)
        .fetch_one(&pool)
        .await
        .unwrap();
        raw_ids.push(id);
    }
    sqlx::query(
        "INSERT INTO visitor_event_facts
            (generation_id, raw_event_id, site_id, visitor_id, occurred_at, day)
         VALUES ($1::uuid, $2, $3, $4::uuid, '2026-09-18T10:00:00Z', $5::date),
                ($1::uuid, $6, $3, $4::uuid, '2026-09-19T10:00:00Z', $7::date),
                ($1::uuid, $8, $3, $9::uuid, '2026-09-19T10:01:00Z', $7::date)",
    )
    .bind(generation)
    .bind(raw_ids[0])
    .bind(site)
    .bind(visitor_a)
    .bind(first_day)
    .bind(raw_ids[1])
    .bind(second_day)
    .bind(raw_ids[2])
    .bind(visitor_b)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO session_events
            (generation_id, raw_event_id, site_id, visitor_id, session_id, occurred_at, day)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, '2026-09-18T10:00:00Z', $6::date),
                ($1::uuid, $7, $3, $4::uuid, $5::uuid, '2026-09-19T10:00:00Z', $8::date),
                ($1::uuid, $9, $3, $10::uuid, $11::uuid, '2026-09-19T10:01:00Z', $8::date)",
    )
    .bind(generation)
    .bind(raw_ids[0])
    .bind(site)
    .bind(visitor_a)
    .bind(session_a)
    .bind(first_day)
    .bind(raw_ids[1])
    .bind(second_day)
    .bind(raw_ids[2])
    .bind(visitor_b)
    .bind(session_b)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO dimension_event_facts
            (generation_id, raw_event_id, site_id, visitor_id, session_id, dimension, value, occurred_at, day)
         VALUES
            ($1::uuid, $2, $3, $4::uuid, $5::uuid, 'browser', 'Chrome:120', '2026-09-18T10:00:00Z', $6::date),
            ($1::uuid, $7, $3, $4::uuid, $5::uuid, 'browser', 'Chrome:120', '2026-09-19T10:00:00Z', $8::date),
            ($1::uuid, $9, $3, $10::uuid, $11::uuid, 'browser', 'Chrome:120', '2026-09-19T10:01:00Z', $8::date)",
    )
    .bind(generation)
    .bind(raw_ids[0])
    .bind(site)
    .bind(visitor_a)
    .bind(session_a)
    .bind(first_day)
    .bind(raw_ids[1])
    .bind(second_day)
    .bind(raw_ids[2])
    .bind(visitor_b)
    .bind(session_b)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO analytics_watermarks
            (site_id, generation_id, source_name, processed_received_watermark)
         VALUES ($1, NULL, 'page_views', '2026-09-19T12:00:00Z'),
                ($1, $2::uuid, 'visitor_session', '2026-09-19T11:00:00Z'),
                ($1, $2::uuid, 'dimensions', '2026-09-19T13:00:00Z')",
    )
    .bind(site)
    .bind(generation)
    .execute(&pool)
    .await
    .unwrap();

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-19/visitors"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let visitor_body = body(response).await;
    assert_eq!(visitor_body["page_views"], 3);
    assert_eq!(visitor_body["unique_visitors"], 2);
    assert_eq!(visitor_body["sessions"], 2);
    assert_eq!(visitor_body["data_as_of"], "2026-09-19T11:00:00Z");
    assert_eq!(visitor_body["freshness_status"], "stale");
    assert_eq!(visitor_body["items"].as_array().unwrap().len(), 2);

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-19/dimensions/browser"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let dimension_body = body(response).await;
    assert_eq!(dimension_body["items"][0]["value"], "Chrome:120");
    assert_eq!(dimension_body["items"][0]["page_views"], 3);
    assert_eq!(dimension_body["items"][0]["unique_visitors"], 2);
    assert_eq!(dimension_body["items"][0]["sessions"], 2);
    assert_eq!(dimension_body["data_as_of"], "2026-09-19T12:00:00Z");
    assert_eq!(dimension_body["freshness_status"], "current");

    sqlx::query(
        "INSERT INTO analytics_generations
            (generation_id, site_id, aggregation_version, parser_version, rebuild_reason, status, created_at)
         VALUES ('00000000-0000-4000-8000-000000000007', $1, 1, 'woothee-0.13.0', 'initial', 'failed', '2026-09-18T09:00:00Z')",
    )
    .bind(site)
    .execute(&pool)
    .await
    .unwrap();
    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-19/dimensions/browser"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(body(response).await["freshness_status"], "current");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and PostgreSQL"]
async fn phase6_reports_expose_rebuild_state_without_active_generation() {
    let pool = pool().await;
    let site = "analytics_api_phase6_rebuild_state";
    reset_phase6(&pool, site).await;
    sqlx::query(
        "INSERT INTO analytics_feature_flags (site_id, analytics_enabled)
         VALUES ($1, TRUE)",
    )
    .bind(site)
    .execute(&pool)
    .await
    .unwrap();
    let generation = "00000000-0000-4000-8000-000000000006";
    sqlx::query(
        "INSERT INTO analytics_generations
            (generation_id, site_id, aggregation_version, parser_version, rebuild_reason, status)
         VALUES ($1::uuid, $2, 1, 'woothee-0.13.0', 'initial', 'building')",
    )
    .bind(generation)
    .bind(site)
    .execute(&pool)
    .await
    .unwrap();

    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-18/visitors"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(body(response).await["freshness_status"], "rebuilding");

    sqlx::query(
        "UPDATE analytics_generations SET status = 'failed' WHERE generation_id = $1::uuid",
    )
    .bind(generation)
    .execute(&pool)
    .await
    .unwrap();
    let response = app(pool)
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-18/visitors"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(body(response).await["freshness_status"], "failed");
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and PostgreSQL"]
async fn phase6_reports_fail_closed_without_capability_configuration() {
    let pool = pool().await;
    let site = "analytics_api_phase6_disabled";
    reset_phase6(&pool, site).await;
    sqlx::query("DELETE FROM site_capability_configurations WHERE site_id=$1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    let response = app(pool)
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-18/visitors"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        body(response).await["error"]["code"],
        "configuration_unavailable"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and PostgreSQL"]
async fn health_checks_database() {
    let pool = pool().await;
    let response = app(pool)
        .oneshot(
            Request::get("/health")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(body(response).await, serde_json::json!({"status":"ok"}));
}

#[tokio::test]
async fn health_hides_database_failure() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_millis(100))
        .connect_lazy("postgres://invalid:invalid@127.0.0.1:1/invalid")
        .expect("lazy pool should be created");
    let response = app(pool)
        .oneshot(
            Request::get("/health")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 503);
    let value = body(response).await;
    assert_eq!(value["error"]["code"], "analytics_api_error");
    assert_eq!(
        value["error"]["message"],
        "Analytics API failed to complete the request"
    );
}

#[tokio::test]
async fn analytics_errors_are_generic() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_millis(100))
        .connect_lazy("postgres://invalid:invalid@127.0.0.1:1/invalid")
        .expect("lazy pool should be created");
    let response = app(pool)
        .oneshot(
            Request::get("/v1/sites/site_example/overview")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 503);
    let value = body(response).await;
    assert_eq!(value["error"]["code"], "configuration_unavailable");
    assert_eq!(
        value["error"]["message"],
        "Capability configuration is unavailable"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and PostgreSQL"]
async fn geo_country_report_includes_unknown_and_is_site_scoped() {
    let pool = pool().await;
    let site = "geo_api_test";
    reset_phase6(&pool, site).await;
    for (event_id, country, provider, dataset) in [
        (
            "01J00000000000000000000101",
            "CA",
            "db-ip",
            "DBIP-City-Lite-20260918",
        ),
        (
            "01J00000000000000000000102",
            "unknown",
            "maxmind",
            "GeoLite2-Country-20260918",
        ),
    ] {
        let raw_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO raw_events(site_id,event_id,schema_version,event_type,occurred_at,received_at,path,payload,processed_at)
             VALUES($1,$2,1,'page_view','2026-09-18T12:00:00Z','2026-09-18T12:00:01Z','/', '{}', NOW()) RETURNING id",
        )
        .bind(site).bind(event_id).fetch_one(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO geo_event_metadata(raw_event_id,site_id,country_code,provider,dataset_version,parser_version)
             VALUES($1,$2,$3,$4,$5,'1')",
        ).bind(raw_id).bind(site).bind(country).bind(provider).bind(dataset).execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO geo_country_facts(raw_event_id,site_id,country_code,occurred_at)
             VALUES($1,$2,$3,'2026-09-18T12:00:00Z')",
        )
        .bind(raw_id)
        .bind(site)
        .bind(country)
        .execute(&pool)
        .await
        .unwrap();
    }
    let response = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-18/geo"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let response = body(response).await;
    assert_eq!(response["coverage_from"], "2026-09-18");
    assert_eq!(response["data_as_of"], serde_json::Value::Null);
    assert_eq!(response["freshness_status"], "current");
    assert_eq!(response["aggregation_version"], 1);
    assert_eq!(
        response["providers"],
        serde_json::json!(["db-ip", "maxmind"])
    );
    assert_eq!(response["items"][0]["country_code"], "CA");
    assert_eq!(response["items"][1]["country_code"], "unknown");
    assert_eq!(response["items"][0]["page_views"], 1);
    assert_eq!(response["items"][1]["page_views"], 1);

    sqlx::query(
        "INSERT INTO raw_events(site_id,event_id,schema_version,event_type,occurred_at,received_at,path,payload)
         VALUES($1,'01J00000000000000000000103',1,'page_view','2026-09-18T12:00:00Z','2026-09-18T12:00:02Z','/pending','{}')",
    )
    .bind(site)
    .execute(&pool)
    .await
    .unwrap();
    let pending = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-09-18/2026-09-18/geo"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(body(pending).await["freshness_status"], "stale");

    seed_capabilities(&pool, "another_geo_api_test").await;
    let other = app(pool)
        .oneshot(
            Request::get("/v1/sites/another_geo_api_test/reports/2026-09-18/2026-09-18/geo")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let other = body(other).await;
    assert!(other["items"].as_array().unwrap().is_empty());
    assert!(other["providers"].as_array().unwrap().is_empty());
}

fn admin_app(pool: PgPool, token: &str) -> axum::Router {
    let configured = AdminTokens::parse(&format!("[\"{token}\"]")).unwrap();
    router(state_with_admin_tokens(state(pool), Some(configured)))
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
}

#[tokio::test]
async fn configuration_admin_routes_reject_missing_and_invalid_credentials_before_database_access()
{
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_millis(50))
        .connect_lazy("postgres://invalid:invalid@127.0.0.1:1/invalid")
        .unwrap();
    let route = "/v1/admin/sites/no_such_site/capabilities";
    let no_token = router(state(pool.clone()))
        .oneshot(Request::get(route).body(axum::body::Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(no_token.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(body(no_token).await["error"]["code"], "unauthorized");

    let token = URL_SAFE_NO_PAD.encode([17_u8; 32]);
    let invalid = admin_app(pool, &token)
        .oneshot(
            Request::get(route)
                .header(
                    "authorization",
                    format!("Bearer {}", URL_SAFE_NO_PAD.encode([18_u8; 32])),
                )
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(body(invalid).await["error"]["code"], "unauthorized");

    let lowercase_scheme = admin_app(
        PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_millis(50))
            .connect_lazy("postgres://invalid:invalid@127.0.0.1:1/invalid")
            .unwrap(),
        &token,
    )
    .oneshot(
        Request::get(route)
            .header("authorization", format!("bearer {token}"))
            .body(axum::body::Body::empty())
            .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(lowercase_scheme.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        body(lowercase_scheme).await["error"]["code"],
        "configuration_unavailable"
    );

    let unavailable = admin_app(
        PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_millis(50))
            .connect_lazy("postgres://invalid:invalid@127.0.0.1:1/invalid")
            .unwrap(),
        &token,
    )
    .oneshot(
        Request::get(route)
            .header("authorization", format!("Bearer {token}"))
            .body(axum::body::Body::empty())
            .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        body(unavailable).await["error"]["code"],
        "configuration_unavailable"
    );

    let bad_body = admin_app(
        PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy("postgres://invalid:invalid@127.0.0.1:1/invalid")
            .unwrap(),
        &token,
    )
    .oneshot(
        Request::put("/v1/admin/sites/site_a/capabilities")
            .header("authorization", format!("Bearer {token}"))
            .header("if-match", "\"1\"")
            .header("content-type", "application/json")
            .body(axum::body::Body::from("{"))
            .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(bad_body.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body(bad_body).await["error"]["code"],
        "configuration_validation_failed"
    );

    let bad_content_type = admin_app(
        PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy("postgres://invalid:invalid@127.0.0.1:1/invalid")
            .unwrap(),
        &token,
    )
    .oneshot(
        Request::put("/v1/admin/sites/site_a/capabilities")
            .header("authorization", format!("Bearer {token}"))
            .header("if-match", "\"1\"")
            .header("content-type", "text/plain")
            .body(axum::body::Body::from("{}"))
            .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(bad_content_type.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body(bad_content_type).await["error"]["code"],
        "configuration_validation_failed"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and PostgreSQL"]
async fn configuration_api_creates_empty_policy_then_issues_and_revokes_key_atomically() {
    let pool = pool().await;
    let site_id = "config_api_pr3_flow";
    let environment = "preview";
    clear_configuration_site(&pool, site_id).await;
    sqlx::query(
        "INSERT INTO analytics_feature_flags (site_id, analytics_enabled) VALUES ($1, TRUE)",
    )
    .bind(site_id)
    .execute(&pool)
    .await
    .unwrap();
    let (updated_at, document) = capability_document(site_id);
    sqlx::query(
        "INSERT INTO site_capability_configurations (site_id, version, updated_at, document) VALUES ($1, 1, $2, $3)",
    )
    .bind(site_id)
    .bind(updated_at)
    .bind(document)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO site_capability_activation_windows(site_id,capability_id,enabled_since) SELECT $1, capability_id, '0001-01-01T00:00:00Z' FROM unnest(ARRAY['page_views','browser_context','anonymous_visitors','sessions','dimensions','custom_events','web_vitals','conversions','funnels','geo']::text[]) AS capability_id")
        .bind(site_id).execute(&pool).await.unwrap();

    let token = URL_SAFE_NO_PAD.encode([27_u8; 32]);
    let app = admin_app(pool.clone(), &token);
    let capabilities_path = format!("/v1/admin/sites/{site_id}/capabilities");
    let capability_read = app
        .clone()
        .oneshot(
            Request::get(&capabilities_path)
                .header("authorization", format!("Bearer {token}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(capability_read.status(), StatusCode::OK);
    assert_eq!(capability_read.headers()["etag"], "\"1\"");
    let mut invalid_capabilities = capability_document(site_id).1["capabilities"].clone();
    invalid_capabilities["browser_context"]["enabled"] = serde_json::json!(false);
    let invalid_capability_write = app
        .clone()
        .oneshot(
            Request::put(&capabilities_path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"1\"")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({"capabilities":invalid_capabilities}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        invalid_capability_write.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut updated_capabilities = capability_document(site_id).1["capabilities"].clone();
    updated_capabilities["web_vitals"]["enabled"] = serde_json::json!(false);
    let capability_write = app
        .clone()
        .oneshot(
            Request::put(&capabilities_path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"1\"")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({"capabilities":updated_capabilities}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(capability_write.status(), StatusCode::OK);
    assert_eq!(capability_write.headers()["etag"], "\"2\"");
    let stale_capability_write = app
        .clone()
        .oneshot(
            Request::put(&capabilities_path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"1\"")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({"capabilities":updated_capabilities}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale_capability_write.status(), StatusCode::CONFLICT);
    let policy_path = format!("/v1/admin/sites/{site_id}/environments/{environment}/ingest-policy");
    let policy_body = serde_json::json!({
        "enabled":true,
        "allowed_origins":["https://config-api.example.test"],
        "rate_limit_per_minute":600
    });
    let missing_precondition = app
        .clone()
        .oneshot(
            Request::post(&policy_path)
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(axum::body::Body::from(policy_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        missing_precondition.status(),
        StatusCode::PRECONDITION_REQUIRED
    );

    let created = app
        .clone()
        .oneshot(
            Request::post(&policy_path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-none-match", "*")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(policy_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    assert_eq!(created.headers()["etag"], "\"1\"");
    let created = body(created).await;
    assert_eq!(created["policy"]["keys"], serde_json::json!([]));
    assert_eq!(created["effective_state"]["status"], "pending");
    assert_eq!(
        created["effective_state"]["applied_versions"]["collector"],
        serde_json::Value::Null
    );

    let key_path = format!("/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys");
    let issued = app
        .clone()
        .oneshot(
            Request::post(&key_path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"1\"")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(issued.status(), StatusCode::CREATED);
    assert_eq!(issued.headers()["etag"], "\"2\"");
    assert_eq!(issued.headers()["cache-control"], "no-store");
    let issued_body = body(issued).await;
    let plaintext = issued_body["key"].as_str().unwrap();
    assert_eq!(plaintext.len(), 43);
    assert_eq!(URL_SAFE_NO_PAD.decode(plaintext).unwrap().len(), 32);
    let key_id = issued_body["metadata"]["key_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let digest: String = sqlx::query_scalar(
        "SELECT document->'ingest_keys'->0->>'sha256_digest' FROM site_environment_policies WHERE site_id = $1 AND environment = $2",
    )
    .bind(site_id)
    .bind(environment)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(digest.len(), 64);
    assert!(
        !serde_json::to_string(&issued_body)
            .unwrap()
            .contains(&digest)
    );

    let read = app
        .clone()
        .oneshot(
            Request::get(&policy_path)
                .header("authorization", format!("Bearer {token}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(read.headers()["etag"], "\"2\"");
    let read_body = body(read).await;
    assert_eq!(read_body["policy"]["keys"][0]["key_id"], key_id);
    assert!(!serde_json::to_string(&read_body).unwrap().contains(&digest));

    let policy_update = serde_json::json!({
        "enabled":true,
        "allowed_origins":["https://config-api.example.test"],
        "rate_limit_per_minute":500
    });
    let updated = app
        .clone()
        .oneshot(
            Request::put(&policy_path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"2\"")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(policy_update.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    assert_eq!(updated.headers()["etag"], "\"3\"");
    let updated_body = body(updated).await;
    assert_eq!(updated_body["policy"]["keys"].as_array().unwrap().len(), 1);
    assert_eq!(updated_body["policy"]["rate_limit_per_minute"], 500);

    sqlx::query("DELETE FROM configuration_runtime_instances")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO configuration_runtime_instances (instance_id, service, refresh_status, last_seen_at) VALUES ('collector-one', 'collector', 'current', NOW()), ('collector-two', 'collector', 'current', NOW())")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO configuration_runtime_state (instance_id, service, site_id, environment, applied_version, refresh_status, last_seen_at) VALUES ('collector-one', 'collector', $1, $2, 3, 'current', NOW())")
        .bind(site_id)
        .bind(environment)
        .execute(&pool)
        .await
        .unwrap();
    let missing_instance_report = app
        .clone()
        .oneshot(
            Request::get(&policy_path)
                .header("authorization", format!("Bearer {token}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let missing_instance_report = body(missing_instance_report).await;
    assert_eq!(
        missing_instance_report["effective_state"]["status"],
        "pending"
    );
    assert_eq!(
        missing_instance_report["effective_state"]["applied_versions"]["collector"],
        serde_json::Value::Null
    );

    sqlx::query("INSERT INTO configuration_runtime_state (instance_id, service, site_id, environment, applied_version, refresh_status, last_seen_at) VALUES ('collector-two', 'collector', $1, $2, 2, 'current', NOW())")
        .bind(site_id)
        .bind(environment)
        .execute(&pool)
        .await
        .unwrap();
    let aggregated = app
        .clone()
        .oneshot(
            Request::get(&policy_path)
                .header("authorization", format!("Bearer {token}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let aggregated = body(aggregated).await;
    assert_eq!(aggregated["effective_state"]["status"], "pending");
    assert_eq!(
        aggregated["effective_state"]["applied_versions"]["collector"],
        2
    );

    sqlx::query("UPDATE configuration_runtime_state SET applied_version = 3 WHERE instance_id = 'collector-two' AND site_id = $1 AND environment = $2")
        .bind(site_id)
        .bind(environment)
        .execute(&pool)
        .await
        .unwrap();
    let current = app
        .clone()
        .oneshot(
            Request::get(&policy_path)
                .header("authorization", format!("Bearer {token}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let current = body(current).await;
    assert_eq!(current["effective_state"]["status"], "current");
    assert_eq!(
        current["effective_state"]["applied_versions"]["collector"],
        3
    );

    sqlx::query("UPDATE configuration_runtime_state SET refresh_status = 'stale' WHERE instance_id = 'collector-two' AND site_id = $1 AND environment = $2")
        .bind(site_id)
        .bind(environment)
        .execute(&pool)
        .await
        .unwrap();
    let stale = app
        .clone()
        .oneshot(
            Request::get(&policy_path)
                .header("authorization", format!("Bearer {token}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let stale = body(stale).await;
    assert_eq!(stale["effective_state"]["status"], "stale");

    sqlx::query("UPDATE configuration_runtime_state SET refresh_status = 'current', last_seen_at = NOW() - INTERVAL '16 seconds' WHERE site_id = $1 AND environment = $2")
        .bind(site_id)
        .bind(environment)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE configuration_runtime_instances SET last_seen_at = NOW() - INTERVAL '16 seconds' WHERE instance_id IN ('collector-one', 'collector-two')")
        .execute(&pool)
        .await
        .unwrap();
    let expired = app
        .clone()
        .oneshot(
            Request::get(&policy_path)
                .header("authorization", format!("Bearer {token}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let expired = body(expired).await;
    assert_eq!(expired["effective_state"]["status"], "stale");

    let concurrent_update_a = serde_json::json!({
        "enabled":true, "allowed_origins":["https://config-api.example.test"],
        "rate_limit_per_minute":550
    });
    let concurrent_update_b = serde_json::json!({
        "enabled":true, "allowed_origins":["https://config-api.example.test"],
        "rate_limit_per_minute":525
    });
    let request_a = app.clone().oneshot(
        Request::put(&policy_path)
            .header("authorization", format!("Bearer {token}"))
            .header("if-match", "\"3\"")
            .header("content-type", "application/json")
            .body(axum::body::Body::from(concurrent_update_a.to_string()))
            .unwrap(),
    );
    let request_b = app.clone().oneshot(
        Request::put(&policy_path)
            .header("authorization", format!("Bearer {token}"))
            .header("if-match", "\"3\"")
            .header("content-type", "application/json")
            .body(axum::body::Body::from(concurrent_update_b.to_string()))
            .unwrap(),
    );
    let (response_a, response_b) = tokio::join!(request_a, request_b);
    let response_a = response_a.unwrap();
    let response_b = response_b.unwrap();
    let statuses = [response_a.status(), response_b.status()];
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::OK)
            .count(),
        1
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::CONFLICT)
            .count(),
        1
    );
    let successful = if response_a.status() == StatusCode::OK {
        response_a
    } else {
        response_b
    };
    assert_eq!(successful.headers()["etag"], "\"4\"");
    let concurrent_body = body(successful).await;
    assert!(
        [525, 550].contains(
            &concurrent_body["policy"]["rate_limit_per_minute"]
                .as_i64()
                .unwrap()
        )
    );

    let stale = app
        .clone()
        .oneshot(
            Request::post(&key_path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"1\"")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);

    let key_item_path = format!("{key_path}/{key_id}");
    let revoked = app
        .clone()
        .oneshot(
            Request::delete(&key_item_path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"4\"")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revoked.status(), StatusCode::OK);
    assert_eq!(revoked.headers()["etag"], "\"5\"");
    let revoked_body = body(revoked).await;
    assert_eq!(revoked_body["policy"]["keys"], serde_json::json!([]));

    let duplicate = app
        .clone()
        .oneshot(
            Request::post(&policy_path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-none-match", "*")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(policy_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let conflict_origin = serde_json::json!({
        "enabled":true,
        "allowed_origins":["https://CONFIG-API.example.test:443/"],
        "rate_limit_per_minute":600
    });
    let rejected = app
        .oneshot(
            Request::post(format!(
                "/v1/admin/sites/{site_id}/environments/staging/ingest-policy"
            ))
            .header("authorization", format!("Bearer {token}"))
            .header("if-none-match", "*")
            .header("content-type", "application/json")
            .body(axum::body::Body::from(conflict_origin.to_string()))
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body(rejected).await["error"]["code"],
        "configuration_validation_failed"
    );

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM configuration_audit WHERE resource->>'site_id' = $1",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 6);
    let audit_text: String = sqlx::query_scalar(
        "SELECT COALESCE(string_agg(resource::text || changed_fields::text, ' '), '') FROM configuration_audit WHERE resource->>'site_id' = $1",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!audit_text.contains(plaintext));
    assert!(!audit_text.contains(&digest));
    clear_configuration_site(&pool, site_id).await;
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and PostgreSQL"]
async fn capability_effective_state_aggregates_services_and_versions() {
    let pool = pool().await;
    let site = "capability_runtime_aggregate_test";
    reset(&pool, site).await;
    sqlx::query("DELETE FROM configuration_capability_runtime_instances")
        .execute(&pool)
        .await
        .unwrap();
    let token = URL_SAFE_NO_PAD.encode([61_u8; 32]);
    let app = admin_app(pool.clone(), &token);
    let path = format!("/v1/admin/sites/{site}/capabilities");

    let request = || {
        Request::get(&path)
            .header("authorization", format!("Bearer {token}"))
            .body(axum::body::Body::empty())
            .unwrap()
    };
    let no_history = app.clone().oneshot(request()).await.unwrap();
    assert_eq!(no_history.status(), StatusCode::OK);
    let no_history = body(no_history).await;
    assert_eq!(no_history["effective_state"]["status"], "pending");
    assert_eq!(
        no_history["effective_state"]["applied_versions"]["collector"],
        serde_json::Value::Null
    );
    assert_eq!(
        no_history["effective_state"]["applied_versions"]["processor"],
        serde_json::Value::Null
    );

    sqlx::query("INSERT INTO configuration_capability_runtime_instances (service,instance_id,refresh_status,last_seen_at) VALUES ('collector','pr5-collector','current',NOW()),('processor','pr5-processor','current',NOW()),('analytics_api','pr5-api01','current',NOW())")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO configuration_capability_runtime_state (service,instance_id,site_id,applied_version,refresh_status,last_seen_at) VALUES ('collector','pr5-collector',$1,1,'current',NOW()),('processor','pr5-processor',$1,1,'current',NOW()),('analytics_api','pr5-api01',$1,1,'current',NOW())")
        .bind(site).execute(&pool).await.unwrap();
    sqlx::query("UPDATE configuration_capability_runtime_state SET applied_version=1,refresh_status='current',last_seen_at=NOW() WHERE site_id=$1 AND service='analytics_api'")
        .bind(site).execute(&pool).await.unwrap();
    let version_one = app.clone().oneshot(request()).await.unwrap();
    assert_eq!(
        body(version_one).await["effective_state"]["status"],
        "current"
    );

    let mut capabilities = capability_document(site).1["capabilities"].clone();
    capabilities["geo"]["enabled"] = serde_json::json!(false);
    let changed = app
        .clone()
        .oneshot(
            Request::put(&path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"1\"")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({"capabilities":capabilities}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(changed.status(), StatusCode::OK);
    assert_eq!(body(changed).await["effective_state"]["status"], "pending");

    sqlx::query("UPDATE configuration_capability_runtime_state SET applied_version=2,last_seen_at=NOW() WHERE site_id=$1")
        .bind(site).execute(&pool).await.unwrap();
    let caught_up = app.clone().oneshot(request()).await.unwrap();
    assert_eq!(
        body(caught_up).await["effective_state"]["status"],
        "current"
    );

    sqlx::query("UPDATE configuration_capability_runtime_state SET refresh_status='stale' WHERE site_id=$1 AND service='processor'")
        .bind(site).execute(&pool).await.unwrap();
    let stale = app.clone().oneshot(request()).await.unwrap();
    let stale = body(stale).await;
    assert_eq!(stale["effective_state"]["status"], "stale");
    assert_eq!(stale["effective_state"]["applied_versions"]["collector"], 2);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and migrated PostgreSQL"]
async fn definition_sets_append_immutable_revisions_with_etags_and_reject_removal() {
    let pool = pool().await;
    let site_id = "definition_revision_api_test";
    clear_configuration_site(&pool, site_id).await;
    seed_capabilities(&pool, site_id).await;
    let token = URL_SAFE_NO_PAD.encode([17_u8; 32]);
    let app = admin_app(pool.clone(), &token);
    let path = format!("/v1/admin/sites/{site_id}/conversion-funnel-definitions");
    let definitions = serde_json::json!({
        "conversions":[{"id":"purchase","name":"Purchase","event_name":"purchase","active":true,"properties":{}}],
        "funnels":[{"id":"checkout","name":"Checkout","active":true,"steps":[{"event_name":"cart","properties":{}},{"event_name":"purchase","properties":{}}]}]
    });
    let unauthorized = app
        .clone()
        .oneshot(Request::get(&path).body(axum::body::Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);
    let created = app
        .clone()
        .oneshot(
            Request::post(&path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-none-match", "*")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(definitions.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    assert_eq!(created.headers().get("etag").unwrap(), "\"1\"");
    let created = body(created).await;
    let version = created["definition_version"].as_str().unwrap().to_owned();
    assert!(created["effective_at"].is_string());
    let update = serde_json::json!({
        "conversions":[{"id":"purchase","name":"Purchase v2","event_name":"purchase","active":false,"properties":{}}],
        "funnels":[{"id":"checkout","name":"Checkout","active":true,"steps":[{"event_name":"cart","properties":{}},{"event_name":"purchase","properties":{}}]}]
    });
    let stale = app
        .clone()
        .oneshot(
            Request::put(&path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"9\"")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(update.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    let updated = app
        .clone()
        .oneshot(
            Request::put(&path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"1\"")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(update.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let updated = body(updated).await;
    assert_eq!(updated["revision"], 2);
    assert_eq!(updated["conversions"][0]["active"], false);
    assert_ne!(updated["definition_version"], version);
    let revisions = app
        .clone()
        .oneshot(
            Request::get(format!("/v1/sites/{site_id}/definition-revisions"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revisions.status(), StatusCode::OK);
    let revisions = body(revisions).await;
    assert_eq!(revisions["site_id"], site_id);
    assert_eq!(
        revisions["current_definition_version"],
        updated["definition_version"]
    );
    assert_eq!(revisions["revisions"].as_array().unwrap().len(), 2);
    assert_eq!(revisions["revisions"][0]["revision"], 2);
    assert_eq!(revisions["revisions"][1]["definition_version"], version);
    let current_report = app
        .clone()
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site_id}/reports/2026-09-01/2026-09-02/conversions"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        body(current_report).await["definition_version"],
        updated["definition_version"]
    );
    let historical_report = app.clone().oneshot(Request::get(format!("/v1/sites/{site_id}/reports/2026-09-01/2026-09-02/conversions?definition_version={version}")).body(axum::body::Body::empty()).unwrap()).await.unwrap();
    assert_eq!(body(historical_report).await["definition_version"], version);
    let unknown_revision = app.clone().oneshot(Request::get(format!("/v1/sites/{site_id}/reports/2026-09-01/2026-09-02/conversions?definition_version=unknown")).body(axum::body::Body::empty()).unwrap()).await.unwrap();
    assert_eq!(unknown_revision.status(), StatusCode::BAD_REQUEST);
    let removed = serde_json::json!({"conversions":[],"funnels":[]});
    let rejected = app
        .clone()
        .oneshot(
            Request::put(&path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"2\"")
                .header("content-type", "application/json")
                .body(axum::body::Body::from(removed.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let audit_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM configuration_audit WHERE resource->>'site_id'=$1 AND resource->>'kind'='conversion_funnel_definitions'").bind(site_id).fetch_one(&pool).await.unwrap();
    assert_eq!(audit_count, 2);
    clear_configuration_site(&pool, site_id).await;
}
