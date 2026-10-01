use axum::{body::Body, http::Request};
use chrono::Utc;
use collector::{
    config::{SiteConfig, SiteRegistry},
    http::router,
    rate_limit::RateLimiter,
    runtime_policy::RuntimePolicyManager,
    security::{AccessError, KeyPolicy},
    sink::PostgresSink,
    validation::Validator,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tower::ServiceExt;

async fn pool() -> PgPool {
    PgPoolOptions::new()
        .max_connections(2)
        .connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL is required"))
        .await
        .expect("integration PostgreSQL should be reachable")
}

fn digest(key: &str) -> String {
    Sha256::digest(key.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[tokio::test]
#[ignore = "requires migrated PostgreSQL; run pnpm test:integration"]
async fn refresh_applies_database_policy_and_uses_toml_only_for_missing_rows() {
    let pool = pool().await;
    let db_site = "pr4_runtime_db_site";
    let toml_site = "pr4_runtime_toml_site";
    let no_last_good_site = "pr4_runtime_no_last_good";
    let disabled_site = "pr4_runtime_db_disabled";
    sqlx::query(
        "DELETE FROM raw_events WHERE site_id = $1 AND event_id = '01J00000000000000000000021'",
    )
    .bind(db_site)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM configuration_runtime_instances WHERE service = 'collector' AND instance_id IN (SELECT instance_id FROM configuration_runtime_state WHERE site_id IN ($1, $2, $3, $4))")
        .bind(db_site)
        .bind(toml_site)
        .bind(no_last_good_site)
        .bind(disabled_site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM configuration_runtime_state WHERE site_id IN ($1, $2, $3, $4)")
        .bind(db_site)
        .bind(toml_site)
        .bind(no_last_good_site)
        .bind(disabled_site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_environment_policies WHERE site_id IN ($1, $2, $3, $4)")
        .bind(db_site)
        .bind(toml_site)
        .bind(no_last_good_site)
        .bind(disabled_site)
        .execute(&pool)
        .await
        .unwrap();

    let toml_registry = SiteRegistry::from_sites(vec![
        SiteConfig {
            site_id: toml_site.to_owned(),
            environment: "production".to_owned(),
            enabled: true,
            allowed_origins: vec!["https://toml.example.test".to_owned()],
            ingest_keys: vec!["toml-fallback-key".to_owned()],
            rate_limit_per_minute: 23,
            ingest_key_digests: Vec::new(),
        },
        SiteConfig {
            site_id: db_site.to_owned(),
            environment: "staging".to_owned(),
            enabled: true,
            allowed_origins: vec!["https://toml-conflict.example.test".to_owned()],
            ingest_keys: vec!["toml-conflict-key".to_owned()],
            rate_limit_per_minute: 23,
            ingest_key_digests: Vec::new(),
        },
        SiteConfig {
            site_id: disabled_site.to_owned(),
            environment: "production".to_owned(),
            enabled: true,
            allowed_origins: vec!["https://disabled-toml.example.test".to_owned()],
            ingest_keys: vec!["disabled-toml-key".to_owned()],
            rate_limit_per_minute: 23,
            ingest_key_digests: Vec::new(),
        },
    ])
    .unwrap();
    let runtime_registry = SiteRegistry::from_runtime_sites(Vec::new()).unwrap();
    let policy = KeyPolicy::new(runtime_registry);
    let manager = RuntimePolicyManager::new(
        pool.clone(),
        toml_registry,
        policy.clone(),
        collector::runtime_policy::stored_policy_validator().unwrap(),
    )
    .unwrap();

    let updated_at = "2026-09-25T00:00:00Z";
    let document = json!({
        "schema_version": 1,
        "site_id": db_site,
        "environment": "production",
        "version": 1,
        "updated_at": updated_at,
        "enabled": true,
        "allowed_origins": ["https://database.example.test"],
        "ingest_keys": [{
            "key_id": "ik_12345678",
            "sha256_digest": digest("database-key-v1"),
            "created_at": updated_at
        }],
        "rate_limit_per_minute": 41
    });
    sqlx::query("INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document) VALUES ($1, 'production', 1, $2, $3)")
        .bind(db_site)
        .bind(updated_at.parse::<chrono::DateTime<chrono::Utc>>().unwrap())
        .bind(document)
        .execute(&pool)
        .await
        .unwrap();

    let disabled_document = json!({
        "schema_version": 1,
        "site_id": disabled_site,
        "environment": "production",
        "version": 1,
        "updated_at": "2026-09-25T00:00:00Z",
        "enabled": false,
        "allowed_origins": ["https://disabled-db.example.test"],
        "ingest_keys": [{
            "key_id": "ik_disabled1",
            "sha256_digest": digest("disabled-db-key"),
            "created_at": "2026-09-25T00:00:00Z"
        }],
        "rate_limit_per_minute": 41
    });
    sqlx::query("INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document) VALUES ($1, 'production', 1, $2, $3)")
        .bind(disabled_site)
        .bind("2026-09-25T00:00:00Z".parse::<chrono::DateTime<chrono::Utc>>().unwrap())
        .bind(disabled_document)
        .execute(&pool)
        .await
        .unwrap();

    assert!(manager.refresh_once().await);
    assert!(
        policy
            .authorize(
                db_site,
                Some("https://database.example.test"),
                Some("database-key-v1")
            )
            .is_ok()
    );
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL is required");
    let sink = PostgresSink::connect(&database_url)
        .await
        .expect("PostgreSQL event sink should connect");
    let app = router(
        Validator::new().expect("event schemas should compile"),
        sink,
        policy.clone(),
        RateLimiter::new(),
    );
    let request = Request::post("/v1/events")
        .header("content-type", "application/json")
        .header("origin", "https://database.example.test")
        .header("x-ingest-key", "database-key-v1")
        .body(Body::from(
            json!({
                "schema_version": 1,
                "events": [{
                    "schema_version": 1,
                    "event_id": "01J00000000000000000000021",
                    "type": "page_view",
                    "site_id": db_site,
                    "occurred_at": Utc::now().timestamp_millis(),
                    "path": "/m34-db-policy"
                }]
            })
            .to_string(),
        ))
        .expect("event request should build");
    let response = app
        .oneshot(request)
        .await
        .expect("event request should complete");
    assert_eq!(response.status(), 202);
    let accepted_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM raw_events WHERE site_id = $1 AND event_id = '01J00000000000000000000021'",
    )
    .bind(db_site)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(accepted_rows, 1);
    // A second refresh uses the validator injected when the manager was constructed.
    assert!(manager.refresh_once().await);
    assert!(matches!(
        policy.authorize(
            db_site,
            Some("https://database.example.test"),
            Some("database-key-v2")
        ),
        Err(AccessError::InvalidIngestKey { .. })
    ));
    let fallback = policy
        .authorize(
            toml_site,
            Some("https://toml.example.test"),
            Some("toml-fallback-key"),
        )
        .unwrap();
    assert_eq!(fallback.site.rate_limit_per_minute, 23);
    assert!(matches!(
        policy.authorize(
            disabled_site,
            Some("https://disabled-toml.example.test"),
            Some("disabled-toml-key")
        ),
        Err(AccessError::SiteNotAllowed)
    ));

    let updated_at = "2026-09-25T00:00:05Z";
    let document = json!({
        "schema_version": 1,
        "site_id": db_site,
        "environment": "production",
        "version": 2,
        "updated_at": updated_at,
        "enabled": true,
        "allowed_origins": ["https://database.example.test"],
        "ingest_keys": [{
            "key_id": "ik_abcdefgh",
            "sha256_digest": digest("database-key-v2"),
            "created_at": updated_at
        }],
        "rate_limit_per_minute": 41
    });
    sqlx::query("UPDATE site_environment_policies SET version = 2, updated_at = $3, document = $4 WHERE site_id = $1 AND environment = $2")
        .bind(db_site)
        .bind("production")
        .bind(updated_at.parse::<chrono::DateTime<chrono::Utc>>().unwrap())
        .bind(document)
        .execute(&pool)
        .await
        .unwrap();
    assert!(manager.refresh_once().await);
    assert!(matches!(
        policy.authorize(
            db_site,
            Some("https://database.example.test"),
            Some("database-key-v1")
        ),
        Err(AccessError::InvalidIngestKey { .. })
    ));
    assert!(
        policy
            .authorize(
                db_site,
                Some("https://database.example.test"),
                Some("database-key-v2")
            )
            .is_ok()
    );

    let reported_version: i64 = sqlx::query_scalar(
        "SELECT applied_version FROM configuration_runtime_state WHERE service = 'collector' AND site_id = $1 AND environment = 'production' ORDER BY last_seen_at DESC LIMIT 1",
    )
    .bind(db_site)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reported_version, 2);
    let instance_status: String = sqlx::query_scalar(
        "SELECT instances.refresh_status FROM configuration_runtime_instances AS instances JOIN configuration_runtime_state AS state USING (instance_id) WHERE state.site_id = $1 AND state.environment = 'production' ORDER BY instances.last_seen_at DESC LIMIT 1",
    )
    .bind(db_site)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(instance_status, "current");

    let updated_at = "2026-09-25T00:00:10Z";
    let conflicting_document = json!({
        "schema_version": 1,
        "site_id": db_site,
        "environment": "production",
        "version": 3,
        "updated_at": updated_at,
        "enabled": true,
        "allowed_origins": ["https://toml-conflict.example.test"],
        "ingest_keys": [{
            "key_id": "ik_abcdefgh",
            "sha256_digest": digest("database-key-v3"),
            "created_at": updated_at
        }],
        "rate_limit_per_minute": 41
    });
    sqlx::query("UPDATE site_environment_policies SET version = 3, updated_at = $3, document = $4 WHERE site_id = $1 AND environment = $2")
        .bind(db_site)
        .bind("production")
        .bind(updated_at.parse::<chrono::DateTime<chrono::Utc>>().unwrap())
        .bind(conflicting_document)
        .execute(&pool)
        .await
        .unwrap();

    for _ in 0..2 {
        assert!(manager.refresh_once().await);
        assert!(
            policy
                .authorize(
                    db_site,
                    Some("https://database.example.test"),
                    Some("database-key-v2")
                )
                .is_ok()
        );
        assert!(matches!(
            policy.authorize(
                db_site,
                Some("https://toml-conflict.example.test"),
                Some("database-key-v3")
            ),
            Err(AccessError::InvalidIngestKey { .. })
        ));
    }

    let (applied_version, refresh_status): (Option<i64>, String) = sqlx::query_as(
        "SELECT applied_version, refresh_status FROM configuration_runtime_state WHERE service = 'collector' AND site_id = $1 AND environment = 'production' ORDER BY last_seen_at DESC LIMIT 1",
    )
    .bind(db_site)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(applied_version, Some(2));
    assert_eq!(refresh_status, "stale");

    let no_last_good_document = json!({
        "schema_version": 1,
        "site_id": no_last_good_site,
        "environment": "production",
        "version": 1,
        "updated_at": "2026-09-25T00:00:15Z",
        "enabled": true,
        "allowed_origins": ["https://toml.example.test"],
        "ingest_keys": [{
            "key_id": "ik_nolastgood",
            "sha256_digest": digest("no-last-good-key"),
            "created_at": "2026-09-25T00:00:15Z"
        }],
        "rate_limit_per_minute": 41
    });
    sqlx::query("INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document) VALUES ($1, 'production', 1, $2, $3)")
        .bind(no_last_good_site)
        .bind("2026-09-25T00:00:15Z".parse::<chrono::DateTime<chrono::Utc>>().unwrap())
        .bind(no_last_good_document)
        .execute(&pool)
        .await
        .unwrap();
    let no_last_good_fallback = SiteRegistry::from_sites(vec![SiteConfig {
        site_id: no_last_good_site.to_owned(),
        environment: "staging".to_owned(),
        enabled: true,
        allowed_origins: vec!["https://toml.example.test".to_owned()],
        ingest_keys: vec!["no-last-good-fallback-key".to_owned()],
        rate_limit_per_minute: 23,
        ingest_key_digests: Vec::new(),
    }])
    .unwrap();
    let no_last_good_policy = KeyPolicy::new(SiteRegistry::from_runtime_sites(Vec::new()).unwrap());
    let no_last_good_manager = RuntimePolicyManager::new(
        pool.clone(),
        no_last_good_fallback,
        no_last_good_policy.clone(),
        collector::runtime_policy::stored_policy_validator().unwrap(),
    )
    .unwrap();
    assert!(no_last_good_manager.refresh_once().await);
    assert!(
        no_last_good_policy
            .authorize(
                no_last_good_site,
                Some("https://toml.example.test"),
                Some("no-last-good-key")
            )
            .is_err()
    );
    let (applied_version, refresh_status): (Option<i64>, String) = sqlx::query_as(
        "SELECT applied_version, refresh_status FROM configuration_runtime_state WHERE service = 'collector' AND site_id = $1 AND environment = 'production' ORDER BY last_seen_at DESC LIMIT 1",
    )
    .bind(no_last_good_site)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(applied_version, None);
    assert_eq!(refresh_status, "stale");

    sqlx::query(
        "DELETE FROM raw_events WHERE site_id = $1 AND event_id = '01J00000000000000000000021'",
    )
    .bind(db_site)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM configuration_runtime_instances WHERE service = 'collector' AND instance_id IN (SELECT instance_id FROM configuration_runtime_state WHERE site_id IN ($1, $2, $3, $4))")
        .bind(db_site)
        .bind(toml_site)
        .bind(no_last_good_site)
        .bind(disabled_site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM configuration_runtime_state WHERE site_id IN ($1, $2, $3, $4)")
        .bind(db_site)
        .bind(toml_site)
        .bind(no_last_good_site)
        .bind(disabled_site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_environment_policies WHERE site_id IN ($1, $2, $3, $4)")
        .bind(db_site)
        .bind(toml_site)
        .bind(no_last_good_site)
        .bind(disabled_site)
        .execute(&pool)
        .await
        .unwrap();
}
