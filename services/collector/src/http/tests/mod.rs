use super::router;
use crate::sink::{EventSink, InMemorySink, SinkError, StoredEvent};
use async_trait::async_trait;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

const VALID_EVENT: &str = r#"{"schema_version":1,"event_id":"01J00000000000000000000000","type":"page_view","site_id":"site_example","occurred_at":1760000000000,"path":"/about"}"#;

fn app<S>(sink: S) -> axum::Router
where
    S: EventSink + 'static,
{
    let policy = crate::security::KeyPolicy::new(
        crate::config::SiteRegistry::from_sites(vec![
            {
                let mut site = crate::config::SiteConfig::new(
                    "site_example",
                    "production",
                    true,
                    "production-key",
                );
                site.allowed_origins = vec!["https://example.com".into()];
                site
            },
            crate::config::SiteConfig::new("site_disabled", "production", false, "disabled-key"),
        ])
        .expect("test registry should be valid"),
    );
    router(
        crate::validation::Validator::new().expect("schemas should compile"),
        sink,
        policy,
        crate::rate_limit::RateLimiter::new(),
    )
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let body = to_bytes(response.into_body(), 128 * 1024)
        .await
        .expect("response body should be readable");
    serde_json::from_slice(&body).expect("response body should be JSON")
}
fn request(body: &str) -> Request<Body> {
    request_with_content_type(body, "application/json")
}
fn request_with_content_type(body: &str, content_type: &str) -> Request<Body> {
    Request::post("/v1/events")
        .header("content-type", content_type)
        .header("origin", "https://example.com")
        .header("x-ingest-key", "production-key")
        .body(Body::from(body.to_owned()))
        .expect("request should build")
}

struct CaptureSink(Arc<Mutex<Vec<StoredEvent>>>);
#[async_trait]
impl EventSink for CaptureSink {
    async fn accept(&self, events: Vec<StoredEvent>) -> Result<(), SinkError> {
        self.0.lock().unwrap().extend(events);
        Ok(())
    }
}
struct FailingSink;
#[async_trait]
impl EventSink for FailingSink {
    async fn accept(&self, _events: Vec<StoredEvent>) -> Result<(), SinkError> {
        Err(SinkError::Failed)
    }
}

mod batch_validation;
mod capabilities;
mod request;
mod routing;
