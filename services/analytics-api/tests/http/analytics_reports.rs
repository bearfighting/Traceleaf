use super::*;

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

#[tokio::test]
#[ignore = "requires DATABASE_URL and migrated PostgreSQL"]
async fn registry_metadata_gaps_do_not_block_historical_analytics() {
    let pool = pool().await;
    let site = "m34_history_metadata_gap";
    for table in [
        "raw_events",
        "page_view_totals",
        "page_view_daily",
        "page_view_routes",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE site_id = $1"
        )))
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query("DELETE FROM site_environment_policies WHERE site_id = $1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_capability_activation_windows WHERE site_id = $1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_capability_configurations WHERE site_id = $1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM analytics_feature_flags WHERE site_id = $1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO site_registry (site_id, display_name, website_url) VALUES ($1, NULL, NULL) ON CONFLICT (site_id) DO UPDATE SET display_name = NULL, website_url = NULL")
        .bind(site).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO raw_events (site_id, event_id, schema_version, event_type, occurred_at, received_at, path, payload) VALUES ($1, '01J00000000000000000000001', 1, 'page_view', NOW(), NOW(), '/legacy', '{}'::jsonb)")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO page_view_totals (site_id, page_views) VALUES ($1, 7)")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();

    let metadata: (Option<String>, Option<String>) =
        sqlx::query_as("SELECT display_name, website_url FROM site_registry WHERE site_id = $1")
            .bind(site)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(metadata, (None, None));
    let capability_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM site_capability_configurations WHERE site_id = $1",
    )
    .bind(site)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(capability_rows, 0);
    let raw_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM raw_events WHERE site_id = $1")
        .bind(site)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(raw_rows, 1);

    // A Site with incomplete Registry metadata remains queryable without a policy row.
    assert_historical_overview(&pool, site).await;
    for path in [
        format!("/v1/sites/{site}/reports/2026-10-01/2026-10-01/overview"),
        format!("/v1/sites/{site}/reports/2026-10-01/2026-10-01/timeline"),
        format!("/v1/sites/{site}/reports/2026-10-01/2026-10-01/pages"),
    ] {
        let response = app(pool.clone())
            .oneshot(Request::get(path).body(axum::body::Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    let visitors = app(pool.clone())
        .oneshot(
            Request::get(format!(
                "/v1/sites/{site}/reports/2026-10-01/2026-10-01/visitors"
            ))
            .body(axum::body::Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(visitors.status(), StatusCode::SERVICE_UNAVAILABLE);

    let updated_at = Utc::now();
    let updated_at_text = updated_at.to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let policy_document = serde_json::json!({
        "schema_version": 1,
        "site_id": site,
        "environment": "production",
        "version": 1,
        "updated_at": updated_at_text,
        "enabled": false,
        "allowed_origins": ["https://history.example.test"],
        "ingest_keys": [{
            "key_id": "ik_m34hist1",
            "sha256_digest": "a".repeat(64),
            "created_at": updated_at_text
        }],
        "rate_limit_per_minute": 60
    });
    sqlx::query("INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document) VALUES ($1, 'production', 1, $2, $3)")
        .bind(site)
        .bind(updated_at)
        .bind(policy_document)
        .execute(&pool)
        .await
        .unwrap();
    // An explicitly disabled policy does not hide historical Analytics data.
    assert_historical_overview(&pool, site).await;
    sqlx::query("UPDATE site_environment_policies SET document=jsonb_set(document, '{enabled}', 'true'::jsonb) WHERE site_id=$1 AND environment='production'")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    // Enabling a DB policy also leaves historical query behavior unchanged.
    assert_historical_overview(&pool, site).await;

    let raw_rows_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM raw_events WHERE site_id = $1")
            .bind(site)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(raw_rows_after, raw_rows);

    sqlx::query("DELETE FROM raw_events WHERE site_id = $1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_environment_policies WHERE site_id = $1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM configuration_capability_runtime_instances WHERE service = 'analytics_api' AND instance_id IN (SELECT instance_id FROM configuration_capability_runtime_state WHERE site_id = $1)")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM configuration_capability_runtime_state WHERE site_id = $1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_capability_activation_windows WHERE site_id = $1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_capability_configurations WHERE site_id = $1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM page_view_totals WHERE site_id = $1")
        .bind(site)
        .execute(&pool)
        .await
        .unwrap();
}
