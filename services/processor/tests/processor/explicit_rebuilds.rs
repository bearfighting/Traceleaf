use super::support::*;
use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::Row;

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn rebuilds_geo_country_facts_from_saved_enrichment() {
    let (processor, pool) = setup().await;
    seed_capabilities(&pool, "site_geo", true).await;
    let raw_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO raw_events(site_id,event_id,schema_version,event_type,occurred_at,received_at,path,payload,processed_at)
         VALUES('site_geo','01J00000000000000000000201',1,'page_view','2026-09-18T12:00:00Z','2026-09-18T12:00:01Z','/','{}',NOW()) RETURNING id",
    ).fetch_one(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO geo_event_metadata(raw_event_id,site_id,country_code,provider,dataset_version,parser_version)
         VALUES($1,'site_geo','unknown','maxmind','GeoLite2-Country-20260918','1')",
    ).bind(raw_id).execute(&pool).await.unwrap();

    assert_eq!(
        processor
            .rebuild_geo_country_facts("site_geo")
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        processor
            .rebuild_geo_country_facts("site_geo")
            .await
            .unwrap(),
        1
    );
    let row = sqlx::query("SELECT country_code FROM geo_country_facts WHERE site_id='site_geo'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("country_code"), "unknown");
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn rebuilds_web_vital_facts_and_advances_its_watermark() {
    let (processor, pool) = setup().await;
    let site_id = "site_web_vital_rebuild";
    seed_capabilities(&pool, site_id, true).await;
    let occurred_at = DateTime::from_timestamp_millis(Utc::now().timestamp_millis()).unwrap();
    let occurred_at_millis = occurred_at.timestamp_millis();
    let page_view_event_id = "01J00000000000000000000211";
    sqlx::query("INSERT INTO raw_events(site_id,event_id,schema_version,event_type,occurred_at,received_at,path,payload,processed_at) VALUES($1,$2,1,'page_view',$3,$3,'/vitals',$4,NOW())")
        .bind(site_id)
        .bind(page_view_event_id)
        .bind(occurred_at)
        .bind(json!({"event_id":page_view_event_id,"type":"page_view","path":"/vitals"}))
        .execute(&pool)
        .await
        .unwrap();
    for (event_id, report_sequence, value) in [
        ("01J00000000000000000000212", 1_i64, 900.0_f64),
        ("01J00000000000000000000213", 2_i64, 700.0_f64),
    ] {
        sqlx::query("INSERT INTO raw_events(site_id,event_id,schema_version,event_type,occurred_at,received_at,path,payload,processed_at) VALUES($1,$2,1,'web_vital',$3,$3,'/vitals',$4,NOW())")
            .bind(site_id)
            .bind(event_id)
            .bind(occurred_at)
            .bind(json!({
                "event_id":event_id,
                "type":"web_vital",
                "page_view_event_id":page_view_event_id,
                "page_view_occurred_at":occurred_at_millis,
                "path":"/vitals",
                "metric":"LCP",
                "value":value,
                "rating":"good",
                "navigation_type":"navigate",
                "report_sequence":report_sequence
            }))
            .execute(&pool)
            .await
            .unwrap();
    }

    assert_eq!(processor.rebuild_web_vital_facts(site_id).await.unwrap(), 1);
    let (value, report_sequence): (f64, i64) = sqlx::query_as(
        "SELECT value,report_sequence FROM web_vital_facts WHERE site_id=$1 AND page_view_event_id=$2 AND metric='LCP'",
    )
    .bind(site_id)
    .bind(page_view_event_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((value, report_sequence), (700.0, 2));
    let watermark: DateTime<Utc> = sqlx::query_scalar(
        "SELECT processed_received_watermark FROM analytics_watermarks WHERE site_id=$1 AND generation_id IS NULL AND source_name='web_vitals'",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(watermark, occurred_at);
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn disabled_custom_event_capability_marks_input_processed_without_creating_facts() {
    let (processor, pool) = setup().await;
    let site_id = "site_custom_capability_disabled";
    seed_capabilities(&pool, site_id, true).await;
    let now = Utc::now();
    let mut document: serde_json::Value =
        sqlx::query_scalar("SELECT document FROM site_capability_configurations WHERE site_id=$1")
            .bind(site_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    document["version"] = json!(2);
    document["updated_at"] = json!(now.to_rfc3339_opts(chrono::SecondsFormat::Micros, true));
    for capability in ["custom_events", "conversions", "funnels"] {
        document["capabilities"][capability]["enabled"] = json!(false);
        sqlx::query(
            "DELETE FROM site_capability_activation_windows WHERE site_id=$1 AND capability_id=$2",
        )
        .bind(site_id)
        .bind(capability)
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query("UPDATE site_capability_configurations SET version=2,updated_at=$2,document=$3 WHERE site_id=$1")
        .bind(site_id)
        .bind(now)
        .bind(document)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO raw_events(site_id,event_id,schema_version,event_type,occurred_at,received_at,payload)
         VALUES($1,'01J00000000000000000000202',1,'custom_event',NOW(),NOW(),
         '{\"schema_version\":1,\"event_id\":\"01J00000000000000000000202\",\"type\":\"custom_event\",\"site_id\":\"site_custom_capability_disabled\",\"occurred_at\":1760000000000,\"event_name\":\"signup\",\"properties\":{}}'::jsonb)",
    )
    .bind(site_id)
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(processor.process_all_once().await.unwrap(), 1);
    let (processed, facts): (Option<DateTime<Utc>>, i64) = sqlx::query_as(
        "SELECT raw.processed_at,(SELECT COUNT(*) FROM custom_event_facts facts WHERE facts.site_id=raw.site_id) FROM raw_events raw WHERE raw.site_id=$1",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(processed.is_some());
    assert_eq!(facts, 0);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL and migrated PostgreSQL"]
async fn imports_definitions_once_and_processes_events_by_received_at_revision() {
    let (processor, pool) = setup().await;
    let site_id = "site_definition_revision_processor";
    seed_capabilities(&pool, site_id, true).await;
    let legacy = json!({
        "version":"legacy-rules-2026-09",
        "sites":[{"site_id":site_id,"conversions":[{"id":"purchase","name":"Purchase","event_name":"purchase"}],"funnels":[]}]
    });
    assert_eq!(
        processor
            .import_definitions_if_empty(&legacy)
            .await
            .unwrap(),
        1
    );
    let replacement = json!({
        "version":"replacement-must-not-overwrite",
        "sites":[{"site_id":site_id,"conversions":[{"id":"purchase","name":"Changed","event_name":"other"}],"funnels":[]}]
    });
    assert_eq!(
        processor
            .import_definitions_if_empty(&replacement)
            .await
            .unwrap(),
        0
    );
    let stored: serde_json::Value = sqlx::query_scalar(
        "SELECT document FROM site_definition_revisions WHERE site_id=$1 AND revision=1",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored["definition_version"], "legacy-rules-2026-09");
    assert_eq!(stored["conversions"][0]["active"], true);

    let boundary = Utc::now() - chrono::Duration::seconds(5);
    let boundary_text = boundary.to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    let next = json!({
        "schema_version":1,"site_id":site_id,"revision":2,"definition_version":"r2-boundary-test",
        "updated_at":boundary_text,"effective_at":boundary_text,
        "conversions":[{"id":"purchase","name":"Purchase v2","event_name":"purchase_v2","active":true,"properties":{}}],
        "funnels":[{"id":"checkout","name":"Checkout","active":true,"steps":[{"event_name":"purchase"},{"event_name":"purchase_v2"}]}]
    });
    sqlx::query("INSERT INTO site_definition_revisions(site_id,revision,definition_version,effective_at,created_at,document) VALUES($1,2,'r2-boundary-test',$2,$2,$3)")
        .bind(site_id).bind(boundary).bind(next).execute(&pool).await.unwrap();
    let visitor_id = "00000000-0000-4000-8000-000000000701";
    let mut event_rows = Vec::new();
    for (event_id, event_name, received_at) in [
        (
            "01J00000000000000000000701",
            "purchase",
            boundary - chrono::Duration::seconds(1),
        ),
        (
            "01J00000000000000000000702",
            "purchase_v2",
            boundary + chrono::Duration::seconds(1),
        ),
    ] {
        let raw_event_id = sqlx::query_scalar::<_, i64>("INSERT INTO raw_events(site_id,event_id,schema_version,event_type,occurred_at,received_at,path,payload,visitor_id) VALUES($1,$2,1,'custom_event',$3,$3,'/',jsonb_build_object('schema_version',1,'event_id',$2,'type','custom_event','site_id',$1,'occurred_at',($3::text),'event_name',$4,'properties','{}'::jsonb),$5::uuid) RETURNING id")
            .bind(site_id).bind(event_id).bind(received_at).bind(event_name).bind(visitor_id).fetch_one(&pool).await.unwrap();
        event_rows.push((raw_event_id, received_at));
    }
    let generation_id = "00000000-0000-4000-8000-000000000702";
    let session_id = "00000000-0000-4000-8000-000000000703";
    sqlx::query("INSERT INTO analytics_generations(generation_id,site_id,aggregation_version,parser_version,rebuild_reason,status) VALUES($1::uuid,$2,1,'test-parser','initial','active')")
        .bind(generation_id).bind(site_id).execute(&pool).await.unwrap();
    for (raw_event_id, occurred_at) in event_rows {
        sqlx::query("INSERT INTO session_events(generation_id,raw_event_id,site_id,visitor_id,session_id,occurred_at,day) VALUES($1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7)")
            .bind(generation_id).bind(raw_event_id).bind(site_id).bind(visitor_id).bind(session_id).bind(occurred_at).bind(occurred_at.date_naive()).execute(&pool).await.unwrap();
    }
    assert_eq!(processor.process_all_once().await.unwrap(), 2);
    let facts: Vec<(String, String)> = sqlx::query_as("SELECT event_id,definition_version FROM conversion_facts WHERE site_id=$1 ORDER BY event_id")
        .bind(site_id).fetch_all(&pool).await.unwrap();
    assert_eq!(
        facts,
        vec![
            (
                "01J00000000000000000000701".to_owned(),
                "legacy-rules-2026-09".to_owned()
            ),
            (
                "01J00000000000000000000702".to_owned(),
                "r2-boundary-test".to_owned()
            ),
        ]
    );

    assert_eq!(
        processor.rebuild_custom_event_facts(site_id).await.unwrap(),
        2
    );
    let custom_fact_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM custom_event_facts WHERE site_id=$1")
            .bind(site_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(custom_fact_count, 2);
    let invalidated_definition_watermarks: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM analytics_watermarks WHERE site_id=$1 AND generation_id IS NULL AND source_name IN ('conversions','funnels') AND definition_version IS NULL",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(invalidated_definition_watermarks, 2);

    assert_eq!(
        processor
            .rebuild_conversion_funnel_facts_for_version(site_id, "r2-boundary-test")
            .await
            .unwrap(),
        2
    );
    let versioned_facts: Vec<(String, String)> = sqlx::query_as(
        "SELECT event_id,definition_version FROM conversion_facts WHERE site_id=$1 ORDER BY event_id",
    )
    .bind(site_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(versioned_facts, facts);
    let rebuilt_definition_watermarks: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM analytics_watermarks WHERE site_id=$1 AND generation_id IS NULL AND source_name IN ('conversions','funnels') AND definition_version='r2-boundary-test'",
    )
    .bind(site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rebuilt_definition_watermarks, 2);
    let funnel_facts: Vec<(i32, String)> = sqlx::query_as(
        "SELECT step_index,event_id FROM funnel_step_facts WHERE site_id=$1 AND definition_id='checkout' AND definition_version='r2-boundary-test' ORDER BY step_index",
    )
    .bind(site_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        funnel_facts,
        vec![
            (0, "01J00000000000000000000701".to_owned()),
            (1, "01J00000000000000000000702".to_owned()),
        ]
    );
}

#[tokio::test]
#[ignore = "requires PostgreSQL; run pnpm test:integration"]
async fn explicit_import_definitions_cli_reads_file_and_is_idempotent() {
    let (_processor, pool) = setup().await;
    let site_id = format!("site_cli_import_{}", std::process::id());
    sqlx::query(
        "DELETE FROM configuration_audit WHERE resource->>'kind'='conversion_funnel_definitions' AND resource->>'site_id'=$1",
    )
    .bind(&site_id)
    .execute(&pool)
    .await
    .unwrap();
    seed_capabilities(&pool, &site_id, true).await;

    let definitions_path = std::env::temp_dir().join(format!(
        "processor-definitions-cli-{}.json",
        std::process::id()
    ));
    let initial_definitions = json!({
        "version":"cli-import-v1",
        "sites":[{"site_id":site_id,"conversions":[{"id":"purchase","name":"Purchase","event_name":"purchase"}],"funnels":[]}]
    });
    std::fs::write(
        &definitions_path,
        serde_json::to_vec(&initial_definitions).unwrap(),
    )
    .unwrap();

    let run_import = || {
        std::process::Command::new(env!("CARGO_BIN_EXE_processor"))
            .env("DATABASE_URL", database_url())
            .env("ANALYTICS_DEFINITIONS_FILE", &definitions_path)
            .arg("--import-definitions-if-empty")
            .output()
            .expect("processor importer should start")
    };
    let first = run_import();
    assert!(
        first.status.success(),
        "first CLI import failed: {}",
        String::from_utf8_lossy(&first.stderr)
    );

    let revision_before_repeat: serde_json::Value = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'revision', revision,
            'definition_version', definition_version,
            'effective_at', effective_at,
            'created_at', created_at,
            'document', document
        ) FROM site_definition_revisions WHERE site_id=$1",
    )
    .bind(&site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let audit_count_before_repeat: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM configuration_audit WHERE resource->>'kind'='conversion_funnel_definitions' AND resource->>'site_id'=$1",
    )
    .bind(&site_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let replacement_definitions = json!({
        "version":"cli-import-must-not-overwrite",
        "sites":[{"site_id":site_id,"conversions":[{"id":"purchase","name":"Changed","event_name":"other"}],"funnels":[]}]
    });
    std::fs::write(
        &definitions_path,
        serde_json::to_vec(&replacement_definitions).unwrap(),
    )
    .unwrap();
    let repeated = run_import();
    let remove_result = std::fs::remove_file(&definitions_path);
    assert!(
        repeated.status.success(),
        "repeated CLI import failed: {}",
        String::from_utf8_lossy(&repeated.stderr)
    );
    remove_result.expect("temporary definitions file should be removed");

    let revision_after_repeat: serde_json::Value = sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'revision', revision,
            'definition_version', definition_version,
            'effective_at', effective_at,
            'created_at', created_at,
            'document', document
        ) FROM site_definition_revisions WHERE site_id=$1",
    )
    .bind(&site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let audit_count_after_repeat: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM configuration_audit WHERE resource->>'kind'='conversion_funnel_definitions' AND resource->>'site_id'=$1",
    )
    .bind(&site_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(revision_before_repeat, revision_after_repeat);
    assert_eq!(audit_count_before_repeat, 1);
    assert_eq!(audit_count_after_repeat, audit_count_before_repeat);
}
