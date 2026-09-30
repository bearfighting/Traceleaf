use std::{net::SocketAddr, sync::Arc};

use axum::{
    Json, Router,
    body::Body,
    extract::{ConnectInfo, State},
    http::{HeaderMap, Request, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::Utc;
use http_body_util::{BodyExt, LengthLimitError, Limited};
use ipnet::IpNet;
use serde::Serialize;
use serde_json::Value;

use configuration_runtime::{CapabilityId, CapabilityRuntime, CapabilitySnapshot};

use crate::{
    geo::{GeoEnrichment, GeoLookup, client_ip},
    rate_limit::RateLimiter,
    security::{AccessError, KeyPolicy},
    sink::{EventSink, SinkError, StoredEvent},
    validation::Validator,
};

const MAX_BODY_SIZE: usize = 64 * 1024;

#[derive(Clone)]
pub struct AppState {
    validator: Arc<Validator>,
    sink: Arc<dyn EventSink>,
    policy: Arc<KeyPolicy>,
    rate_limiter: Arc<RateLimiter>,
    geo: Option<Arc<GeoLookup>>,
    trusted_proxies: Arc<Vec<IpNet>>,
    capabilities: Option<CapabilityRuntime>,
}

pub fn router<S>(
    validator: Validator,
    sink: S,
    policy: KeyPolicy,
    rate_limiter: RateLimiter,
) -> Router
where
    S: EventSink + 'static,
{
    router_with_geo(validator, sink, policy, rate_limiter, None, Vec::new())
}

pub fn router_with_geo<S>(
    validator: Validator,
    sink: S,
    policy: KeyPolicy,
    rate_limiter: RateLimiter,
    geo: Option<GeoLookup>,
    trusted_proxies: Vec<IpNet>,
) -> Router
where
    S: EventSink + 'static,
{
    router_with_capabilities(
        validator,
        sink,
        policy,
        rate_limiter,
        geo,
        trusted_proxies,
        None,
    )
}

pub fn router_with_capabilities<S>(
    validator: Validator,
    sink: S,
    policy: KeyPolicy,
    rate_limiter: RateLimiter,
    geo: Option<GeoLookup>,
    trusted_proxies: Vec<IpNet>,
    capabilities: Option<CapabilityRuntime>,
) -> Router
where
    S: EventSink + 'static,
{
    Router::new()
        .route("/health", get(health))
        .route("/v1/events", post(events).options(preflight))
        .with_state(AppState {
            validator: Arc::new(validator),
            sink: Arc::new(sink),
            policy: Arc::new(policy),
            rate_limiter: Arc::new(rate_limiter),
            geo: geo.map(Arc::new),
            trusted_proxies: Arc::new(trusted_proxies),
            capabilities,
        })
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn events(State(state): State<AppState>, request: Request<Body>) -> Response {
    let peer_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| info.0.ip());
    let headers = request.headers().clone();
    let has_origin = headers.contains_key(header::ORIGIN);
    let global_cors_origin =
        request_origin(&headers).and_then(|origin| state.policy.preflight_origin_allowed(origin));
    if !is_json_content_type(&headers) {
        return with_cors(
            ApiError::unsupported_media_type().into_response(),
            has_origin,
            global_cors_origin.as_deref(),
        );
    }

    let body = match Limited::new(request.into_body(), MAX_BODY_SIZE + 1)
        .collect()
        .await
    {
        Ok(body) => body.to_bytes(),
        Err(error) if error.downcast_ref::<LengthLimitError>().is_some() => {
            return with_cors(
                ApiError::payload_too_large().into_response(),
                has_origin,
                global_cors_origin.as_deref(),
            );
        }
        Err(error) => {
            tracing::error!(error = %error, "failed to read request body");
            return with_cors(
                ApiError::collector_error().into_response(),
                has_origin,
                global_cors_origin.as_deref(),
            );
        }
    };

    if body.len() > MAX_BODY_SIZE {
        return with_cors(
            ApiError::payload_too_large().into_response(),
            has_origin,
            global_cors_origin.as_deref(),
        );
    }

    let value: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            return with_cors(
                ApiError::invalid_json().into_response(),
                has_origin,
                global_cors_origin.as_deref(),
            );
        }
    };

    let site_id = match batch_site_id(&value) {
        Ok(Some(site_id)) => site_id.to_owned(),
        Ok(None) => {
            return validate_batch(
                &state,
                value,
                has_origin,
                global_cors_origin.as_deref(),
                None,
                None,
            )
            .await;
        }
        Err(()) => {
            return with_cors(
                ApiError::invalid_event_batch().into_response(),
                has_origin,
                global_cors_origin.as_deref(),
            );
        }
    };

    let authorized =
        match state
            .policy
            .authorize(&site_id, request_origin(&headers), request_key(&headers))
        {
            Ok(authorized) => authorized,
            Err(AccessError::SiteNotAllowed) => {
                return with_cors(
                    ApiError::site_not_allowed().into_response(),
                    has_origin,
                    None,
                );
            }
            Err(AccessError::OriginNotAllowed) => {
                return with_cors(
                    ApiError::origin_not_allowed().into_response(),
                    has_origin,
                    None,
                );
            }
            Err(AccessError::InvalidIngestKey { origin }) => {
                return with_cors(
                    ApiError::invalid_ingest_key().into_response(),
                    has_origin,
                    Some(origin.as_str()),
                );
            }
        };

    if !state.rate_limiter.try_acquire_with_limit(
        &site_id,
        &authorized.origin,
        authorized.site.rate_limit_per_minute as u64,
    ) {
        return with_cors(
            rate_limited_response(),
            has_origin,
            Some(authorized.origin.as_str()),
        );
    }

    let capabilities = state
        .capabilities
        .as_ref()
        .and_then(|runtime| runtime.snapshot(&site_id));
    let geo = state
        .geo
        .as_ref()
        .filter(|_| match &state.capabilities {
            // Legacy/test router constructors have no capability source.
            None => true,
            // In production, no snapshot is fail-closed and must not trigger enrichment.
            Some(_) => capabilities
                .as_ref()
                .is_some_and(|capabilities| capabilities.enabled(CapabilityId::Geo)),
        })
        .map(|lookup| {
            let client_ip = client_ip(
                peer_ip,
                headers
                    .get("x-forwarded-for")
                    .and_then(|value| value.to_str().ok()),
                &state.trusted_proxies,
            );
            lookup.lookup(client_ip)
        });
    validate_batch(
        &state,
        value,
        has_origin,
        Some(authorized.origin.as_str()),
        geo,
        capabilities,
    )
    .await
}

async fn validate_batch(
    state: &AppState,
    value: Value,
    has_origin: bool,
    cors_origin: Option<&str>,
    geo: Option<GeoEnrichment>,
    capabilities: Option<CapabilitySnapshot>,
) -> Response {
    let batch = match state.validator.validate(&value) {
        Ok(batch) => batch,
        Err(_) => {
            return with_cors(
                ApiError::invalid_event_batch().into_response(),
                has_origin,
                cors_origin,
            );
        }
    };

    if let Some(runtime) = &state.capabilities {
        if capabilities.is_none() {
            return with_cors(
                ApiError::configuration_unavailable().into_response(),
                has_origin,
                cors_origin,
            );
        }
        let capabilities = capabilities.as_ref().expect("checked above");
        if batch.events.iter().any(|event| match &event.event {
            crate::protocol::AnalyticsEvent::Custom(_) => {
                !capabilities.enabled(CapabilityId::CustomEvents)
            }
            crate::protocol::AnalyticsEvent::WebVital(_) => {
                !capabilities.enabled(CapabilityId::WebVitals)
            }
            crate::protocol::AnalyticsEvent::PageView(_) => {
                !capabilities.enabled(CapabilityId::PageViews)
            }
        }) {
            return with_cors(
                ApiError::capability_disabled().into_response(),
                has_origin,
                cors_origin,
            );
        }
        let _runtime_is_installed = runtime;
    }
    let accepted = batch.events.len();
    let received_at = Utc::now();
    let latest_allowed = received_at + chrono::Duration::minutes(5);
    if batch.events.iter().any(|event| {
        chrono::DateTime::<Utc>::from_timestamp_millis(event.event.occurred_at())
            .is_none_or(|occurred_at| occurred_at > latest_allowed)
    }) {
        return with_cors(
            ApiError::invalid_occurred_at().into_response(),
            has_origin,
            cors_origin,
        );
    }
    let events = batch
        .events
        .into_iter()
        .map(|mut event| {
            let capability = capabilities.as_ref();
            match &mut event.event {
                crate::protocol::AnalyticsEvent::PageView(page_view) => {
                    if capability.is_some_and(|caps| !caps.enabled(CapabilityId::BrowserContext)) {
                        page_view.context = None;
                        page_view.context_schema_version = None;
                    }
                    if capability.is_some_and(|caps| !caps.enabled(CapabilityId::AnonymousVisitors))
                    {
                        page_view.visitor_id = None;
                    }
                }
                crate::protocol::AnalyticsEvent::Custom(custom) => {
                    if capability.is_some_and(|caps| !caps.enabled(CapabilityId::AnonymousVisitors))
                    {
                        custom.visitor_id = None;
                    }
                }
                crate::protocol::AnalyticsEvent::WebVital(_) => {}
            }
            let is_page_view = matches!(event.event, crate::protocol::AnalyticsEvent::PageView(_));
            let mut payload = event.payload;
            if let Some(object) = payload.as_object_mut() {
                if capability.is_some_and(|caps| !caps.enabled(CapabilityId::BrowserContext)) {
                    object.remove("context");
                    object.remove("context_schema_version");
                }
                if capability.is_some_and(|caps| !caps.enabled(CapabilityId::AnonymousVisitors)) {
                    object.remove("visitor_id");
                }
            }
            StoredEvent {
                event: event.event,
                payload,
                received_at,
                geo: if is_page_view { geo.clone() } else { None },
            }
        })
        .collect();
    if let Err(error) = state.sink.accept(events).await {
        tracing::error!(error = %error, "event sink failed");
        let response = match error {
            SinkError::InvalidWebVitalAssociation => {
                ApiError::invalid_event_batch().into_response()
            }
            _ => ApiError::collector_error().into_response(),
        };
        return with_cors(response, has_origin, cors_origin);
    }

    with_cors(
        json_response(StatusCode::ACCEPTED, AcceptedResponse { accepted }),
        has_origin,
        cors_origin,
    )
}

async fn preflight(State(state): State<AppState>, request: Request<Body>) -> Response {
    let headers = request.headers();
    let Some(raw_origin) = request_origin(headers) else {
        return ApiError::origin_not_allowed().into_response();
    };
    let Some(origin) = state.policy.preflight_origin_allowed(raw_origin) else {
        return with_cors(ApiError::origin_not_allowed().into_response(), true, None);
    };

    let method_allowed = headers
        .get("access-control-request-method")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|method| method.eq_ignore_ascii_case("POST"));
    let headers_allowed = headers
        .get("access-control-request-headers")
        .and_then(|value| value.to_str().ok())
        .map(request_headers_allowed)
        .unwrap_or(true);

    if !method_allowed || !headers_allowed {
        return with_cors(ApiError::origin_not_allowed().into_response(), true, None);
    }

    let mut response = StatusCode::NO_CONTENT.into_response();
    let response_headers = response.headers_mut();
    response_headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        origin
            .parse()
            .expect("normalized origin is a valid header value"),
    );
    response_headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        header::HeaderValue::from_static("POST"),
    );
    response_headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        header::HeaderValue::from_static("Content-Type, X-Ingest-Key"),
    );
    response_headers.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        header::HeaderValue::from_static("600"),
    );
    response_headers.insert(header::VARY, header::HeaderValue::from_static("Origin"));
    response
}

fn batch_site_id(value: &Value) -> Result<Option<&str>, ()> {
    let Some(events) = value.get("events").and_then(Value::as_array) else {
        return Ok(None);
    };

    let mut site_id = None;
    for event in events {
        let Some(current) = event.get("site_id").and_then(Value::as_str) else {
            return Ok(None);
        };

        match site_id {
            None => site_id = Some(current),
            Some(expected) if expected == current => {}
            Some(_) => return Err(()),
        }
    }

    Ok(site_id)
}

fn request_key(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("x-ingest-key")
        .and_then(|value| value.to_str().ok())
}

fn request_origin(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
}

fn request_headers_allowed(value: &str) -> bool {
    if value.trim().is_empty() {
        return true;
    }
    value.split(',').all(|name| {
        matches!(
            name.trim().to_ascii_lowercase().as_str(),
            "content-type" | "x-ingest-key"
        )
    })
}

fn with_cors(mut response: Response, has_origin: bool, allowed_origin: Option<&str>) -> Response {
    if has_origin {
        response
            .headers_mut()
            .insert(header::VARY, header::HeaderValue::from_static("Origin"));
    }
    if let Some(origin) = allowed_origin {
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            origin
                .parse()
                .expect("normalized origin is a valid header value"),
        );
    }
    response
}

fn is_json_content_type(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .is_some_and(|value| value.eq_ignore_ascii_case("application/json"))
}

fn json_response<T: Serialize>(status: StatusCode, value: T) -> Response {
    (status, Json(value)).into_response()
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct AcceptedResponse {
    accepted: usize,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: &'static str,
}

struct ApiError(ErrorResponse, StatusCode);

impl ApiError {
    fn new(code: &'static str, message: &'static str, status: StatusCode) -> Self {
        Self(
            ErrorResponse {
                error: ErrorBody { code, message },
            },
            status,
        )
    }

    fn invalid_json() -> Self {
        Self::new(
            "invalid_json",
            "Request body must be valid JSON",
            StatusCode::BAD_REQUEST,
        )
    }

    fn invalid_event_batch() -> Self {
        Self::new(
            "invalid_event_batch",
            "Event batch validation failed",
            StatusCode::BAD_REQUEST,
        )
    }

    fn capability_disabled() -> Self {
        Self::new(
            "capability_disabled",
            "This event capability is disabled",
            StatusCode::FORBIDDEN,
        )
    }

    fn configuration_unavailable() -> Self {
        Self::new(
            "configuration_unavailable",
            "Capability configuration is unavailable",
            StatusCode::SERVICE_UNAVAILABLE,
        )
    }

    fn invalid_occurred_at() -> Self {
        Self::new(
            "invalid_occurred_at",
            "Event occurred_at is outside the supported range",
            StatusCode::BAD_REQUEST,
        )
    }

    fn payload_too_large() -> Self {
        Self::new(
            "payload_too_large",
            "Request body exceeds the maximum size",
            StatusCode::PAYLOAD_TOO_LARGE,
        )
    }

    fn unsupported_media_type() -> Self {
        Self::new(
            "unsupported_media_type",
            "Content-Type must be application/json",
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        )
    }

    fn collector_error() -> Self {
        Self::new(
            "collector_error",
            "Collector failed to accept the event batch",
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    }

    fn invalid_ingest_key() -> Self {
        Self::new(
            "invalid_ingest_key",
            "Ingest Key is missing or invalid",
            StatusCode::UNAUTHORIZED,
        )
    }

    fn site_not_allowed() -> Self {
        Self::new(
            "site_not_allowed",
            "Site is not allowed",
            StatusCode::FORBIDDEN,
        )
    }

    fn origin_not_allowed() -> Self {
        Self::new(
            "origin_not_allowed",
            "Origin is not allowed",
            StatusCode::FORBIDDEN,
        )
    }
}

fn rate_limited_response() -> Response {
    let mut response = ApiError::new(
        "rate_limited",
        "Rate limit exceeded",
        StatusCode::TOO_MANY_REQUESTS,
    )
    .into_response();
    response
        .headers_mut()
        .insert(header::RETRY_AFTER, header::HeaderValue::from_static("60"));
    response
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        json_response(self.1, self.0)
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use axum::{
        body::Body,
        body::to_bytes,
        http::{Request, StatusCode},
    };
    use chrono::Utc;
    use configuration_runtime::{CapabilityRuntime, CapabilitySnapshot};
    use serde_json::json;
    use sqlx::postgres::PgPoolOptions;
    use std::sync::{Arc, Mutex};
    use tower::ServiceExt;

    use super::router;
    use crate::{
        config::{SiteConfig, SiteRegistry},
        http::{AppState, validate_batch},
        rate_limit::RateLimiter,
        security::KeyPolicy,
        sink::{EventSink, InMemorySink, SinkError, StoredEvent},
        validation::Validator,
    };

    const VALID_EVENT: &str = r#"{"schema_version":1,"event_id":"01J00000000000000000000000","type":"page_view","site_id":"site_example","occurred_at":1760000000000,"path":"/about"}"#;

    fn app<S>(sink: S) -> axum::Router
    where
        S: EventSink + 'static,
    {
        let policy = KeyPolicy::new(
            SiteRegistry::from_sites(vec![
                {
                    let mut site =
                        SiteConfig::new("site_example", "production", true, "production-key");
                    site.allowed_origins = vec!["https://example.com".into()];
                    site
                },
                SiteConfig::new("site_disabled", "production", false, "disabled-key"),
            ])
            .expect("test registry should be valid"),
        );
        router(
            Validator::new().expect("schemas should compile"),
            sink,
            policy,
            RateLimiter::new(),
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

    #[tokio::test]
    async fn health_returns_ok_json() {
        let response = app(InMemorySink::new())
            .oneshot(
                Request::get("/health")
                    .body(Body::empty())
                    .expect("request should build"),
            )
            .await
            .expect("health request should complete");

        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], "application/json");
        assert_eq!(
            response_json(response).await,
            serde_json::json!({"status": "ok"})
        );
    }

    #[tokio::test]
    async fn accepts_single_event_and_stores_it() {
        let sink = InMemorySink::new();
        let response = app(sink.clone())
            .oneshot(request(&format!(
                r#"{{"schema_version":1,"events":[{VALID_EVENT}]}}"#
            )))
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 202);
        assert_eq!(
            response_json(response).await,
            serde_json::json!({"accepted": 1})
        );
        assert_eq!(sink.snapshot().await.len(), 1);
    }

    #[tokio::test]
    async fn accepts_multiple_events_and_charset_content_type() {
        let sink = InMemorySink::new();
        let body = format!(
            r#"{{"schema_version":1,"events":[{VALID_EVENT},{VALID_EVENT}],"future_field":true}}"#
        );
        let response = app(sink.clone())
            .oneshot(request_with_content_type(
                &body,
                "application/json; charset=utf-8",
            ))
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 202);
        assert_eq!(
            response_json(response).await,
            serde_json::json!({"accepted": 2})
        );
        assert_eq!(sink.snapshot().await.len(), 2);
    }

    #[tokio::test]
    async fn rejects_invalid_json_without_writing() {
        let sink = InMemorySink::new();
        let response = app(sink.clone())
            .oneshot(request("{"))
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 400);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "invalid_json"
        );
        assert!(sink.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn rejects_invalid_batch_without_writing() {
        let sink = InMemorySink::new();
        let body = r#"{"schema_version":1,"events":[{"schema_version":1,"event_id":"bad","type":"page_view","site_id":"site_example","occurred_at":-1,"path":"about"}]}"#;
        let response = app(sink.clone())
            .oneshot(request(body))
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 400);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "invalid_event_batch"
        );
        assert!(sink.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn rejects_empty_batch() {
        let response = app(InMemorySink::new())
            .oneshot(request(r#"{"schema_version":1,"events":[]}"#))
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 400);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "invalid_event_batch"
        );
    }

    #[tokio::test]
    async fn rejects_batch_with_more_than_100_events() {
        let event: serde_json::Value =
            serde_json::from_str(VALID_EVENT).expect("event should parse");
        let body = serde_json::json!({
            "schema_version": 1,
            "events": (0..101).map(|_| event.clone()).collect::<Vec<_>>(),
        });
        let response = app(InMemorySink::new())
            .oneshot(request(&body.to_string()))
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 400);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "invalid_event_batch"
        );
    }

    #[tokio::test]
    async fn rejects_missing_required_field_and_wrong_event_type() {
        for body in [
            r#"{"schema_version":1,"events":[{"schema_version":1,"type":"page_view","site_id":"site_example","occurred_at":1760000000000,"path":"/about"}]}"#,
            r#"{"schema_version":1,"events":[{"schema_version":1,"event_id":"01J00000000000000000000000","type":"custom","site_id":"site_example","occurred_at":1760000000000,"path":"/about"}]}"#,
        ] {
            let response = app(InMemorySink::new())
                .oneshot(request(body))
                .await
                .expect("request should complete");

            assert_eq!(response.status(), 400);
            assert_eq!(
                response_json(response).await["error"]["code"],
                "invalid_event_batch"
            );
        }
    }

    #[tokio::test]
    async fn rejects_invalid_occurred_at() {
        let body = r#"{"schema_version":1,"events":[{"schema_version":1,"event_id":"01J00000000000000000000000","type":"page_view","site_id":"site_example","occurred_at":-1,"path":"/about"}]}"#;
        let response = app(InMemorySink::new())
            .oneshot(request(body))
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 400);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "invalid_event_batch"
        );
    }

    #[tokio::test]
    async fn rejects_mixed_batch_atomically() {
        let sink = InMemorySink::new();
        let body = format!(
            r#"{{"schema_version":1,"events":[{VALID_EVENT},{{"schema_version":1,"event_id":"bad","type":"page_view","site_id":"site_example","occurred_at":-1,"path":"/about"}}]}}"#
        );
        let response = app(sink.clone())
            .oneshot(request(&body))
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 400);
        assert!(sink.snapshot().await.is_empty());
    }

    #[tokio::test]
    async fn rejects_unsupported_content_type() {
        let response = app(InMemorySink::new())
            .oneshot(
                Request::post("/v1/events")
                    .header("content-type", "text/plain")
                    .body(Body::from(VALID_EVENT))
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 415);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "unsupported_media_type"
        );
    }

    #[tokio::test]
    async fn rejects_missing_content_type() {
        let response = app(InMemorySink::new())
            .oneshot(
                Request::post("/v1/events")
                    .body(Body::from(VALID_EVENT))
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 415);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "unsupported_media_type"
        );
    }

    #[tokio::test]
    async fn rejects_oversized_body() {
        let response = app(InMemorySink::new())
            .oneshot(
                Request::post("/v1/events")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        "{{\"padding\":\"{}\"}}",
                        "x".repeat(64 * 1024)
                    )))
                    .expect("request should build"),
            )
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 413);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "payload_too_large"
        );
    }

    #[tokio::test]
    async fn sink_failure_returns_collector_error() {
        let response = app(FailingSink)
            .oneshot(request(&format!(
                r#"{{"schema_version":1,"events":[{VALID_EVENT}]}}"#
            )))
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 500);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "collector_error"
        );
    }

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
}
