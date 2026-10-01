use chrono::{DateTime, NaiveDate, Utc};
use processor::Processor;
use serde_json::Value;
use sqlx::{PgPool, Row, postgres::PgPoolOptions};

fn database_url() -> String {
    std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to the integration PostgreSQL database")
}

async fn seed_capabilities(pool: &PgPool, site_id: &str) {
    sqlx::query("INSERT INTO site_registry (site_id) VALUES ($1) ON CONFLICT (site_id) DO NOTHING")
        .bind(site_id)
        .execute(pool)
        .await
        .expect("Site Registry fixture should be present");
    let updated_at = Utc::now();
    let timestamp = updated_at.to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let capabilities = serde_json::json!({
        "page_views":{"enabled":true,"settings":{}},
        "browser_context":{"enabled":true,"settings":{}},
        "anonymous_visitors":{"enabled":true,"settings":{}},
        "sessions":{"enabled":true,"settings":{}},
        "dimensions":{"enabled":true,"settings":{}},
        "custom_events":{"enabled":true,"settings":{}},
        "web_vitals":{"enabled":true,"settings":{}},
        "conversions":{"enabled":true,"settings":{}},
        "funnels":{"enabled":true,"settings":{}},
        "geo":{"enabled":true,"settings":{}}
    });
    let document = serde_json::json!({"schema_version":1,"site_id":site_id,"version":1,"updated_at":timestamp,
        "capabilities":capabilities,"consent_policy":"required",
        "privacy_constraints":["no_ip_persistence","no_fingerprinting","consent_required"]});
    sqlx::query("INSERT INTO site_capability_configurations(site_id,version,updated_at,document) VALUES($1,1,$2,$3) ON CONFLICT(site_id) DO UPDATE SET version=1,updated_at=EXCLUDED.updated_at,document=EXCLUDED.document")
        .bind(site_id).bind(updated_at).bind(document).execute(pool).await.unwrap();
    sqlx::query("DELETE FROM site_capability_activation_windows WHERE site_id=$1")
        .bind(site_id)
        .execute(pool)
        .await
        .unwrap();
    for capability_id in [
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
    ] {
        sqlx::query("INSERT INTO site_capability_activation_windows(site_id,capability_id,enabled_since) VALUES($1,$2,'0001-01-01T00:00:00Z')")
            .bind(site_id).bind(capability_id).execute(pool).await.unwrap();
    }
}

async fn setup() -> (Processor, PgPool) {
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

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn canonical_fixtures_match_processor_aggregates() {
    let fixture_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../protocol/contracts/analytics-api/current/fixtures");
    let mut fixture_paths = std::fs::read_dir(fixture_dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    fixture_paths.sort();

    for fixture_path in fixture_paths {
        let (processor, pool) = setup().await;
        let fixture: Value =
            serde_json::from_str(&std::fs::read_to_string(&fixture_path).unwrap()).unwrap();
        let received_at =
            DateTime::parse_from_rfc3339(fixture["input"]["received_at"].as_str().unwrap())
                .unwrap()
                .with_timezone(&Utc);

        for event in fixture["input"]["events"].as_array().unwrap() {
            insert_fixture_event(&pool, event, received_at).await;
        }

        let processed = processor.process_all_once().await.unwrap();
        let expected = &fixture["expected"];
        assert_eq!(
            processed,
            expected["raw_events"]["inserted"].as_u64().unwrap(),
            "{} processed count",
            fixture_path.display()
        );
        assert_aggregate_rows(&pool, expected, &fixture_path).await;
    }
}

async fn insert_fixture_event(pool: &PgPool, event: &Value, received_at: DateTime<Utc>) {
    seed_capabilities(pool, event["site_id"].as_str().unwrap()).await;
    let occurred_at =
        DateTime::<Utc>::from_timestamp_millis(event["occurred_at"].as_i64().unwrap()).unwrap();
    sqlx::query(
        "INSERT INTO raw_events
            (site_id, event_id, schema_version, event_type, occurred_at,
             received_at, path, url, title, referrer, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (site_id, event_id) DO NOTHING",
    )
    .bind(event["site_id"].as_str().unwrap())
    .bind(event["event_id"].as_str().unwrap())
    .bind(event["schema_version"].as_i64().unwrap() as i32)
    .bind(event["type"].as_str().unwrap())
    .bind(occurred_at)
    .bind(received_at)
    .bind(event.get("path").and_then(Value::as_str))
    .bind(event.get("url").and_then(|value| value.as_str()))
    .bind(event.get("title").and_then(|value| value.as_str()))
    .bind(event.get("referrer").and_then(|value| value.as_str()))
    .bind(event)
    .execute(pool)
    .await
    .unwrap();
}

async fn assert_aggregate_rows(pool: &PgPool, expected: &Value, fixture_path: &std::path::Path) {
    let daily = expected["page_view_daily"].as_array().unwrap();
    let routes = expected["page_view_routes"].as_array().unwrap();
    let totals = expected["page_view_totals"].as_array().unwrap();

    for (table, expected_count) in [
        ("page_view_daily", daily.len()),
        ("page_view_routes", routes.len()),
        ("page_view_totals", totals.len()),
    ] {
        let actual_count = sqlx::query(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) AS count FROM {table}"
        )))
        .fetch_one(pool)
        .await
        .unwrap()
        .get::<i64, _>("count") as usize;
        assert_eq!(actual_count, expected_count, "{table} in {fixture_path:?}");
    }

    for row in daily {
        let actual =
            sqlx::query("SELECT page_views FROM page_view_daily WHERE site_id = $1 AND day = $2")
                .bind(row["site_id"].as_str().unwrap())
                .bind(NaiveDate::parse_from_str(row["day"].as_str().unwrap(), "%Y-%m-%d").unwrap())
                .fetch_one(pool)
                .await
                .unwrap()
                .get::<i64, _>("page_views");
        assert_eq!(actual, row["page_views"].as_i64().unwrap());
    }

    for row in routes {
        let actual = sqlx::query(
            "SELECT page_views FROM page_view_routes
             WHERE site_id = $1 AND day = $2 AND path = $3",
        )
        .bind(row["site_id"].as_str().unwrap())
        .bind(NaiveDate::parse_from_str(row["day"].as_str().unwrap(), "%Y-%m-%d").unwrap())
        .bind(row["path"].as_str().unwrap())
        .fetch_one(pool)
        .await
        .unwrap()
        .get::<i64, _>("page_views");
        assert_eq!(actual, row["page_views"].as_i64().unwrap());
    }

    for row in totals {
        let actual = sqlx::query("SELECT page_views FROM page_view_totals WHERE site_id = $1")
            .bind(row["site_id"].as_str().unwrap())
            .fetch_one(pool)
            .await
            .unwrap()
            .get::<i64, _>("page_views");
        assert_eq!(actual, row["page_views"].as_i64().unwrap());
    }
}
