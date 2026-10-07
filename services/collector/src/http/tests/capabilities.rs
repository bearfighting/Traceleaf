use super::*;
use crate::{
    config::{SiteConfig, SiteRegistry},
    http::{AppState, events::validate_batch},
    rate_limit::RateLimiter,
    security::KeyPolicy,
    sink::StoredEvent,
    validation::Validator,
};
use axum::http::StatusCode;
use chrono::Utc;
use configuration_runtime::{CapabilityRuntime, CapabilitySnapshot};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use std::sync::{Arc, Mutex};

#[tokio::test]
async fn capability_runtime_rejects_disabled_events_and_redacts_page_view_fields() {
    let document = json!({
        "schema_version": 1, "site_id": "site_example", "version": 1,
        "updated_at": "2026-09-25T00:00:00Z",
        "capabilities": {
            "page_views": {"enabled": true, "settings": {}},
            "browser_context": {"enabled": false, "settings": {}},
            "anonymous_visitors": {"enabled": false, "settings": {}},
            "sessions": {"enabled": false, "settings": {}},
            "dimensions": {"enabled": false, "settings": {}},
            "custom_events": {"enabled": false, "settings": {}},
            "web_vitals": {"enabled": false, "settings": {}},
            "conversions": {"enabled": false, "settings": {}},
            "funnels": {"enabled": false, "settings": {}},
            "geo": {"enabled": false, "settings": {}}
        },
        "consent_policy": "required",
        "privacy_constraints": ["no_ip_persistence", "no_fingerprinting", "consent_required"]
    });
    let capabilities = CapabilitySnapshot::from_document(
        &configuration_runtime::CapabilitySchemaValidator::new().unwrap(),
        "site_example",
        1,
        &document,
    )
    .unwrap();
    let database = PgPoolOptions::new()
        .connect_lazy("postgres://analytics:analytics@127.0.0.1:5432/unused")
        .unwrap();
    let runtime = CapabilityRuntime::new(database, "collector").unwrap();
    let registry = SiteRegistry::from_sites(vec![{
        let mut site = SiteConfig::new("site_example", "production", true, "production-key");
        site.allowed_origins = vec!["https://example.com".into()];
        site
    }])
    .unwrap();
    let captured = Arc::new(Mutex::new(Vec::<StoredEvent>::new()));
    let state = AppState {
        validator: Arc::new(Validator::new().unwrap()),
        sink: Arc::new(CaptureSink(captured.clone())),
        policy: Arc::new(KeyPolicy::new(registry)),
        rate_limiter: Arc::new(RateLimiter::new()),
        geo: None,
        trusted_proxies: Arc::new(Vec::new()),
        capabilities: Some(runtime),
    };
    let event = json!({
        "schema_version": 1, "event_id": "01J00000000000000000000001",
        "type": "page_view", "site_id": "site_example", "occurred_at": Utc::now().timestamp_millis(),
        "path": "/about", "visitor_id": "550e8400-e29b-41d4-a716-446655440000",
        "context_schema_version": 1,
        "context": {
            "language":"en-CA", "timezone":"America/Toronto",
            "viewport_width":1440, "viewport_height":900,
            "screen_width":2560, "screen_height":1440, "user_agent":"Mozilla/5.0"
        }
    });
    let response = validate_batch(
        &state,
        json!({"schema_version":1,"events":[event]}),
        true,
        Some("https://example.com"),
        None,
        Some(capabilities.clone()),
    )
    .await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    {
        let stored = captured.lock().unwrap();
        let event = &stored[0];
        assert!(event.payload.get("context").is_none());
        assert!(event.payload.get("visitor_id").is_none());
        match &event.event {
            crate::protocol::AnalyticsEvent::PageView(page_view) => {
                assert!(page_view.context.is_none());
                assert!(page_view.visitor_id.is_none());
            }
            _ => panic!("expected page view"),
        }
    }

    let disabled_custom_event = json!({
        "schema_version":1,
        "events":[{"schema_version":1,"event_id":"01J00000000000000000000002","type":"custom_event","site_id":"site_example","occurred_at":Utc::now().timestamp_millis(),"event_name":"signup","properties":{}}]
    });
    let response = validate_batch(
        &state,
        disabled_custom_event,
        true,
        Some("https://example.com"),
        None,
        Some(capabilities),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "capability_disabled"
    );
}
