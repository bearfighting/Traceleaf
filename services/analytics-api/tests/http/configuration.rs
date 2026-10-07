use super::*;

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
async fn configuration_api_initializes_missing_legacy_capability_configuration() {
    let pool = pool().await;
    let site_id = "config_api_legacy_capabilities";
    clear_configuration_site(&pool, site_id).await;

    let token = URL_SAFE_NO_PAD.encode([28_u8; 32]);
    let app = admin_app(pool.clone(), &token);
    let path = format!("/v1/admin/sites/{site_id}/capabilities");
    let missing = app
        .clone()
        .oneshot(
            Request::get(&path)
                .header("authorization", format!("Bearer {token}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);

    let initialized = app
        .clone()
        .oneshot(
            Request::post(&path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-none-match", "*")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(initialized.status(), StatusCode::CREATED);
    assert_eq!(initialized.headers()["etag"], "\"1\"");
    let initialized = body(initialized).await;
    assert_eq!(
        initialized["configuration"]["capabilities"]["page_views"]["enabled"],
        true
    );
    assert_eq!(
        initialized["configuration"]["capabilities"]["browser_context"]["enabled"],
        false
    );
    assert_eq!(initialized["effective_state"]["stored_version"], 1);

    let duplicate = app
        .oneshot(
            Request::post(&path)
                .header("authorization", format!("Bearer {token}"))
                .header("if-none-match", "*")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let activation_windows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM site_capability_activation_windows WHERE site_id = $1",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(activation_windows, 1);
    let audit_rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM configuration_audit WHERE resource->>'site_id' = $1 AND operation = 'created'",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_rows, 1);
    clear_configuration_site(&pool, site_id).await;
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
