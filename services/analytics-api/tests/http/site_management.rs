use super::*;

#[tokio::test]
async fn configuration_admin_routes_reject_missing_and_invalid_credentials_before_database_access()
{
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_millis(50))
        .connect_lazy("postgres://invalid:invalid@127.0.0.1:1/invalid")
        .unwrap();
    let route = "/v1/admin/sites/no_such_site/capabilities";
    let no_token = build_router(RouterConfig {
        database_url: "postgres://invalid:invalid@127.0.0.1:1/invalid".into(),
        definition_version: "1".into(),
        admin_tokens: None,
    })
    .unwrap()
    .oneshot(Request::get(route).body(axum::body::Body::empty()).unwrap())
    .await
    .unwrap();
    assert_eq!(no_token.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(body(no_token).await["error"]["code"], "unauthorized");

    let list_without_token = build_router(RouterConfig {
        database_url: "postgres://invalid:invalid@127.0.0.1:1/invalid".into(),
        definition_version: "1".into(),
        admin_tokens: None,
    })
    .unwrap()
    .oneshot(
        Request::get("/v1/admin/sites")
            .body(axum::body::Body::empty())
            .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(list_without_token.status(), StatusCode::UNAUTHORIZED);

    let token = URL_SAFE_NO_PAD.encode([17_u8; 32]);
    let invalid_limit = admin_app(pool.clone(), &token)
        .oneshot(
            Request::get("/v1/admin/sites?limit=101")
                .header("authorization", format!("Bearer {token}"))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid_limit.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body(invalid_limit).await["error"]["code"],
        "configuration_validation_failed"
    );
    let invalid_idempotency_key = admin_app(pool.clone(), &token)
        .oneshot(
            Request::post("/v1/admin/sites")
                .header("authorization", format!("Bearer {token}"))
                .header("idempotency-key", "contains a space")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        invalid_idempotency_key.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        body(invalid_idempotency_key).await["error"]["code"],
        "configuration_validation_failed"
    );
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
#[ignore = "requires DATABASE_URL and PostgreSQL with current migrations"]
async fn site_creation_persists_complete_state_and_replays_without_plaintext_key() {
    let pool = pool().await;
    let token = URL_SAFE_NO_PAD.encode([61_u8; 32]);
    let idempotency_key = format!(
        "site-create-{}-{}",
        std::process::id(),
        Utc::now().timestamp_micros()
    );
    let fixture = site_creation_fixture();
    let original_request = fixture["normalization"]["input"].clone();
    let canonical_request = fixture["normalization"]["canonical"].clone();
    let app = admin_app(pool.clone(), &token);

    let created = app
        .clone()
        .oneshot(site_creation_request(
            &token,
            &idempotency_key,
            original_request.clone(),
        ))
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::CREATED);
    assert_eq!(created.headers()["etag"], "\"1\"");
    assert_eq!(created.headers()["cache-control"], "no-store");
    let created = body(created).await;
    let site_id = created["site"]["site_id"].as_str().unwrap().to_owned();
    let plaintext_key = created["ingest_key"]["key"].as_str().unwrap();
    let key_id = created["ingest_key"]["key_id"].as_str().unwrap();
    assert!(site_id.starts_with("site_"));
    assert_eq!(site_id.len(), 31);
    assert!(site_id.as_bytes()[5].is_ascii_digit() && site_id.as_bytes()[5] <= b'7');
    assert_eq!(plaintext_key.len(), 43);
    assert_eq!(created["initial_environment"], "production");
    assert_eq!(created["site"]["display_name"], "Café Site");
    assert_eq!(created["site"]["website_url"], "https://example.test/path");
    assert_eq!(created["site"]["setup_status"], "ready");

    let policy: serde_json::Value = sqlx::query_scalar(
        "SELECT document FROM site_environment_policies WHERE site_id=$1 AND environment='production'",
    )
    .bind(&site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(policy["enabled"], true);
    assert_eq!(policy["rate_limit_per_minute"], 600);
    assert_eq!(
        policy["allowed_origins"],
        serde_json::json!(["https://example.test"])
    );
    assert_eq!(policy["ingest_keys"][0]["key_id"], key_id);
    let expected_key_digest = Sha256::digest(plaintext_key.as_bytes());
    assert_eq!(
        policy["ingest_keys"][0]["sha256_digest"],
        expected_key_digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    assert!(policy["ingest_keys"][0].get("key").is_none());

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM site_management_audit WHERE site_id=$1 AND operation='created' AND site_version=1",
    )
    .bind(&site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let idempotency_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM site_creation_requests WHERE idempotency_key=$1 AND site_id=$2",
    )
    .bind(&idempotency_key)
    .bind(&site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 1);
    assert_eq!(idempotency_count, 1);

    let replay = app
        .clone()
        .oneshot(site_creation_request(
            &token,
            &idempotency_key,
            canonical_request,
        ))
        .await
        .unwrap();
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(replay.headers()["etag"], "\"1\"");
    let replay = body(replay).await;
    assert_eq!(replay["site"]["site_id"], site_id);
    assert!(replay.get("ingest_key").is_none());

    let mut changed_request = original_request;
    changed_request["display_name"] = serde_json::json!("Different site");
    let conflict = app
        .clone()
        .oneshot(site_creation_request(
            &token,
            &idempotency_key,
            changed_request,
        ))
        .await
        .unwrap();
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    assert_eq!(
        body(conflict).await["error"]["code"],
        "site_idempotency_conflict"
    );

    let archived = app
        .clone()
        .oneshot(
            Request::post(format!("/v1/admin/sites/{site_id}/archive"))
                .header("authorization", format!("Bearer {token}"))
                .header("if-match", "\"1\"")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(archived.status(), StatusCode::OK);
    assert_eq!(body(archived).await["site"]["lifecycle_status"], "archived");
    let archived_replay = app
        .oneshot(site_creation_request(
            &token,
            &idempotency_key,
            fixture["normalization"]["canonical"].clone(),
        ))
        .await
        .unwrap();
    assert_eq!(archived_replay.status(), StatusCode::OK);
    let archived_replay = body(archived_replay).await;
    assert_eq!(archived_replay["site"]["lifecycle_status"], "archived");
    assert!(archived_replay.get("ingest_key").is_none());
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and PostgreSQL with current migrations"]
async fn concurrent_site_creation_requests_are_idempotent_and_never_overwrite() {
    let pool = pool().await;
    let token = URL_SAFE_NO_PAD.encode([62_u8; 32]);
    let fixture = site_creation_fixture();
    let original = fixture["normalization"]["input"].clone();
    let base_key = format!(
        "site-create-race-{}-{}",
        std::process::id(),
        Utc::now().timestamp_micros()
    );
    let app = admin_app(pool.clone(), &token);

    let (left, right) = tokio::join!(
        app.clone()
            .oneshot(site_creation_request(&token, &base_key, original.clone())),
        app.clone()
            .oneshot(site_creation_request(&token, &base_key, original.clone())),
    );
    let left = left.unwrap();
    let right = right.unwrap();
    let statuses = [left.status(), right.status()];
    assert!(statuses.contains(&StatusCode::CREATED));
    assert!(statuses.contains(&StatusCode::OK));
    let left_body = body(left).await;
    let right_body = body(right).await;
    let returned_keys = [left_body.get("ingest_key"), right_body.get("ingest_key")]
        .into_iter()
        .filter(Option::is_some)
        .count();
    assert_eq!(returned_keys, 1);
    assert_eq!(left_body["site"]["site_id"], right_body["site"]["site_id"]);
    let duplicate_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM site_creation_requests WHERE idempotency_key=$1")
            .bind(&base_key)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(duplicate_count, 1);

    let conflict_key = format!("{base_key}-different");
    let mut request_a = original.clone();
    request_a["display_name"] = serde_json::json!("Concurrent A");
    let mut request_b = original;
    request_b["display_name"] = serde_json::json!("Concurrent B");
    let (left, right) = tokio::join!(
        app.clone()
            .oneshot(site_creation_request(&token, &conflict_key, request_a)),
        app.oneshot(site_creation_request(&token, &conflict_key, request_b)),
    );
    let left = left.unwrap();
    let right = right.unwrap();
    let statuses = [left.status(), right.status()];
    assert!(statuses.contains(&StatusCode::CREATED));
    assert!(statuses.contains(&StatusCode::CONFLICT));
    let left = body(left).await;
    let right = body(right).await;
    let conflict_body = if left["error"]["code"] == "site_idempotency_conflict" {
        left
    } else {
        right
    };
    assert_eq!(conflict_body["error"]["code"], "site_idempotency_conflict");
    let committed_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM site_creation_requests WHERE idempotency_key=$1")
            .bind(&conflict_key)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(committed_count, 1);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and PostgreSQL with current migrations"]
async fn site_creation_rolls_back_all_rows_when_a_late_transaction_write_fails() {
    let pool = pool().await;
    sqlx::query(
        "CREATE OR REPLACE FUNCTION test_fail_site_creation_audit() RETURNS trigger
         LANGUAGE plpgsql AS $$
         BEGIN
             IF NEW.operation='created' AND EXISTS (
                 SELECT 1 FROM site_registry
                  WHERE site_id=NEW.site_id AND display_name LIKE 'Rollback Probe %'
             ) THEN
                 RAISE EXCEPTION 'injected site creation failure';
             END IF;
             RETURN NEW;
         END;
         $$",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TRIGGER test_fail_site_creation_audit
         BEFORE INSERT ON site_management_audit
         FOR EACH ROW EXECUTE FUNCTION test_fail_site_creation_audit()",
    )
    .execute(&pool)
    .await
    .unwrap();

    let token = URL_SAFE_NO_PAD.encode([63_u8; 32]);
    let idempotency_key = format!(
        "site-create-rollback-{}-{}",
        std::process::id(),
        Utc::now().timestamp_micros()
    );
    let mut request = site_creation_fixture()["normalization"]["canonical"].clone();
    request["display_name"] =
        serde_json::json!(format!("Rollback Probe {}", Utc::now().timestamp_micros()));
    let response = admin_app(pool.clone(), &token)
        .oneshot(site_creation_request(
            &token,
            &idempotency_key,
            request.clone(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        body(response).await["error"]["code"],
        "configuration_unavailable"
    );

    sqlx::query("DROP TRIGGER test_fail_site_creation_audit ON site_management_audit")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION test_fail_site_creation_audit()")
        .execute(&pool)
        .await
        .unwrap();

    let display_name = request["display_name"].as_str().unwrap();
    let leaked_rows: i64 = sqlx::query_scalar(
        "SELECT
           (SELECT count(*) FROM site_registry WHERE display_name=$1)
         + (SELECT count(*) FROM site_creation_requests WHERE idempotency_key=$2)",
    )
    .bind(display_name)
    .bind(&idempotency_key)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(leaked_rows, 0);
}
