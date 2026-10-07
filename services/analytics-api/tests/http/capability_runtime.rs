use super::*;

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
#[ignore = "requires migrated PostgreSQL; run pnpm test:integration"]
async fn capability_runtime_reuses_validator_and_retains_last_good_snapshot_on_invalid_refresh() {
    let pool = pool().await;
    let site_id = "m2b_capability_refresh_test";
    sqlx::query("DELETE FROM configuration_capability_runtime_instances WHERE service = 'analytics_api' AND instance_id IN (SELECT instance_id FROM configuration_capability_runtime_state WHERE site_id = $1)")
        .bind(site_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM configuration_capability_runtime_state WHERE site_id = $1")
        .bind(site_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_capability_configurations WHERE site_id = $1")
        .bind(site_id)
        .execute(&pool)
        .await
        .unwrap();

    seed_capabilities(&pool, site_id).await;
    let runtime = CapabilityRuntime::new(pool.clone(), "analytics_api").unwrap();
    assert!(runtime.refresh_once().await);
    let last_good = runtime
        .snapshot(site_id)
        .expect("initial document is valid");
    assert!(!runtime.is_stale(site_id));

    sqlx::query("DELETE FROM site_capability_activation_windows WHERE site_id = $1 AND capability_id = 'web_vitals'")
        .bind(site_id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(runtime.refresh_once().await);
    assert_eq!(runtime.snapshot(site_id), Some(last_good.clone()));
    assert!(runtime.is_stale(site_id));

    let (applied_version, refresh_status): (Option<i64>, String) = sqlx::query_as(
        "SELECT applied_version, refresh_status FROM configuration_capability_runtime_state WHERE service = 'analytics_api' AND site_id = $1 ORDER BY last_seen_at DESC LIMIT 1",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(applied_version, Some(last_good.version));
    assert_eq!(refresh_status, "stale");

    sqlx::query("DELETE FROM configuration_capability_runtime_state WHERE site_id = $1")
        .bind(site_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM configuration_capability_runtime_instances WHERE service = 'analytics_api' AND instance_id = $1")
        .bind(runtime.instance_id())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_capability_configurations WHERE site_id = $1")
        .bind(site_id)
        .execute(&pool)
        .await
        .unwrap();
}
