use super::{
    AppState,
    response::{AcceptedResponse, ApiError, json_response, rate_limited_response, with_cors},
};
use crate::{
    geo::{GeoEnrichment, client_ip},
    security::AccessError,
    sink::{SinkError, StoredEvent},
};
use axum::{
    body::Body,
    extract::{ConnectInfo, State},
    http::{HeaderMap, Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use configuration_runtime::{CapabilityId, CapabilitySnapshot};
use http_body_util::{BodyExt, LengthLimitError, Limited};
use serde_json::Value;
use std::net::SocketAddr;
fn is_json_content_type(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .is_some_and(|value| value.eq_ignore_ascii_case("application/json"))
}

const MAX_BODY_SIZE: usize = 64 * 1024;

pub(super) async fn events(State(state): State<AppState>, request: Request<Body>) -> Response {
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

pub(super) async fn validate_batch(
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
pub(super) fn request_origin(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
}
