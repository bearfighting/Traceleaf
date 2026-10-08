use axum::{body::Body, http::Request};
use chrono::Utc;
use collector::{
    application::{rate_limit::RateLimiter, runtime_policy::RuntimePolicyManager},
    domain::{
        config::SiteRegistry,
        security::{AccessError, KeyPolicy},
        validation::Validator,
    },
    storage::{runtime_policy::PostgresRuntimePolicyRepository, sink::PostgresSink},
    transport::http::router,
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
async fn refresh_uses_only_active_database_policies_and_rejects_missing_or_archived_sites() {
    let pool = pool().await;
    let db_site = "pr4_runtime_db_site";
    let legacy_only_site = "pr4_runtime_toml_site";
    let disabled_site = "pr4_runtime_db_disabled";
    let archived_site = "pr4_runtime_archived";
    sqlx::query(
        "DELETE FROM raw_events WHERE site_id = $1 AND event_id = '01J00000000000000000000021'",
    )
    .bind(db_site)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM configuration_runtime_instances WHERE service = 'collector' AND instance_id IN (SELECT instance_id FROM configuration_runtime_state WHERE site_id IN ($1, $2, $3, $4))")
        .bind(db_site)
        .bind(legacy_only_site)
        .bind(disabled_site)
        .bind(archived_site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM configuration_runtime_state WHERE site_id IN ($1, $2, $3, $4)")
        .bind(db_site)
        .bind(legacy_only_site)
        .bind(disabled_site)
        .bind(archived_site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_environment_policies WHERE site_id IN ($1, $2, $3, $4)")
        .bind(db_site)
        .bind(legacy_only_site)
        .bind(disabled_site)
        .bind(archived_site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO site_registry (site_id) SELECT unnest(ARRAY[$1, $2, $3, $4]::text[]) ON CONFLICT (site_id) DO UPDATE SET lifecycle_status='active'")
        .bind(db_site)
        .bind(legacy_only_site)
        .bind(disabled_site)
        .bind(archived_site)
        .execute(&pool)
        .await
        .unwrap();

    let policy = KeyPolicy::new(SiteRegistry::from_runtime_sites(Vec::new()).unwrap());
    let manager = RuntimePolicyManager::with_repository(
        std::sync::Arc::new(PostgresRuntimePolicyRepository::new(pool.clone())),
        policy.clone(),
        collector::application::runtime_policy::stored_policy_validator().unwrap(),
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

    let staging_document = json!({
        "schema_version": 1,
        "site_id": db_site,
        "environment": "staging",
        "version": 1,
        "updated_at": updated_at,
        "enabled": true,
        "allowed_origins": ["https://database-staging.example.test"],
        "ingest_keys": [{
            "key_id": "ik_staging1",
            "sha256_digest": digest("database-staging-key"),
            "created_at": updated_at
        }],
        "rate_limit_per_minute": 23
    });
    sqlx::query("INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document) VALUES ($1, 'staging', 1, $2, $3)")
        .bind(db_site)
        .bind(updated_at.parse::<chrono::DateTime<chrono::Utc>>().unwrap())
        .bind(staging_document)
        .execute(&pool)
        .await
        .unwrap();

    let archived_document = json!({
        "schema_version": 1,
        "site_id": archived_site,
        "environment": "production",
        "version": 1,
        "updated_at": updated_at,
        "enabled": true,
        "allowed_origins": ["https://archived.example.test"],
        "ingest_keys": [{
            "key_id": "ik_archived1",
            "sha256_digest": digest("archived-db-key"),
            "created_at": updated_at
        }],
        "rate_limit_per_minute": 41
    });
    sqlx::query("INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document) VALUES ($1, 'production', 1, $2, $3)")
        .bind(archived_site)
        .bind(updated_at.parse::<chrono::DateTime<chrono::Utc>>().unwrap())
        .bind(archived_document)
        .execute(&pool)
        .await
        .unwrap();

    assert!(manager.refresh_once().await);
    assert!(
        policy
            .authorize(
                archived_site,
                Some("https://archived.example.test"),
                Some("archived-db-key")
            )
            .is_ok()
    );
    sqlx::query("UPDATE site_registry SET lifecycle_status='archived' WHERE site_id=$1")
        .bind(archived_site)
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
    assert!(matches!(
        policy.authorize(
            legacy_only_site,
            Some("https://toml.example.test"),
            Some("toml-fallback-key")
        ),
        Err(AccessError::SiteNotAllowed)
    ));
    assert!(matches!(
        policy.authorize(
            disabled_site,
            Some("https://disabled-db.example.test"),
            Some("disabled-db-key")
        ),
        Err(AccessError::SiteNotAllowed)
    ));
    assert!(matches!(
        policy.authorize(
            archived_site,
            Some("https://archived.example.test"),
            Some("archived-db-key")
        ),
        Err(AccessError::SiteNotAllowed)
    ));
    let archived_runtime_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM configuration_runtime_state WHERE service = 'collector' AND site_id = $1 AND environment = 'production'",
    )
    .bind(archived_site)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(archived_runtime_rows, 0);

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

    sqlx::query("DELETE FROM site_environment_policies WHERE site_id=$1 AND environment='staging'")
        .bind(db_site)
        .execute(&pool)
        .await
        .unwrap();
    assert!(manager.refresh_once().await);
    assert!(matches!(
        policy.authorize(
            db_site,
            Some("https://database-staging.example.test"),
            Some("database-staging-key")
        ),
        Err(AccessError::OriginNotAllowed)
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

    sqlx::query(
        "DELETE FROM raw_events WHERE site_id = $1 AND event_id = '01J00000000000000000000021'",
    )
    .bind(db_site)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM configuration_runtime_instances WHERE service = 'collector' AND instance_id IN (SELECT instance_id FROM configuration_runtime_state WHERE site_id IN ($1, $2, $3, $4))")
        .bind(db_site)
        .bind(legacy_only_site)
        .bind(disabled_site)
        .bind(archived_site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM configuration_runtime_state WHERE site_id IN ($1, $2, $3, $4)")
        .bind(db_site)
        .bind(legacy_only_site)
        .bind(disabled_site)
        .bind(archived_site)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM site_environment_policies WHERE site_id IN ($1, $2, $3, $4)")
        .bind(db_site)
        .bind(legacy_only_site)
        .bind(disabled_site)
        .bind(archived_site)
        .execute(&pool)
        .await
        .unwrap();

    pool.close().await;
    assert!(!manager.refresh_once().await);
    assert!(
        policy
            .authorize(
                db_site,
                Some("https://database.example.test"),
                Some("database-key-v2")
            )
            .is_ok(),
        "a temporary database outage should retain the last valid policy snapshot"
    );
}
