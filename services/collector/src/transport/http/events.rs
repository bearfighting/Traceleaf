use super::{
    AppState,
    client_ip::client_ip,
    response::{AcceptedResponse, ApiError, json_response, rate_limited_response, with_cors},
};
use crate::{
    application::{
        capabilities::CapabilityState,
        event_sink::SinkError,
        ingestion::{BatchSiteIdError, IngestionError, batch_site_id, ingest_batch},
    },
    domain::{geo::GeoEnrichment, security::AccessError},
};
use axum::{
    body::Body,
    extract::{ConnectInfo, State},
    http::{HeaderMap, Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use configuration_runtime::CapabilityId;
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
                if state.capabilities.is_some() {
                    CapabilityState::Unavailable
                } else {
                    CapabilityState::Unconfigured
                },
            )
            .await;
        }
        Err(BatchSiteIdError::ConflictingSiteIds) => {
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
    let capability_state = match (&state.capabilities, capabilities) {
        (None, _) => CapabilityState::Unconfigured,
        (Some(_), Some(snapshot)) => CapabilityState::Available(snapshot),
        (Some(_), None) => CapabilityState::Unavailable,
    };
    validate_batch(
        &state,
        value,
        has_origin,
        Some(authorized.origin.as_str()),
        geo,
        capability_state,
    )
    .await
}

pub(super) async fn validate_batch(
    state: &AppState,
    value: Value,
    has_origin: bool,
    cors_origin: Option<&str>,
    geo: Option<GeoEnrichment>,
    capabilities: CapabilityState,
) -> Response {
    match ingest_batch(
        &state.validator,
        state.sink.as_ref(),
        value,
        geo,
        capabilities,
    )
    .await
    {
        Ok(accepted) => with_cors(
            json_response(StatusCode::ACCEPTED, AcceptedResponse { accepted }),
            has_origin,
            cors_origin,
        ),
        Err(error) => {
            let response = match error {
                IngestionError::InvalidBatch
                | IngestionError::Sink(SinkError::InvalidWebVitalAssociation) => {
                    ApiError::invalid_event_batch().into_response()
                }
                IngestionError::CapabilityUnavailable => {
                    ApiError::configuration_unavailable().into_response()
                }
                IngestionError::CapabilityDisabled => {
                    ApiError::capability_disabled().into_response()
                }
                IngestionError::InvalidTimestamp => ApiError::invalid_occurred_at().into_response(),
                IngestionError::Sink(_) => ApiError::collector_error().into_response(),
            };
            if let IngestionError::Sink(error) = &error {
                tracing::error!(error = %error, "event sink failed");
            }
            with_cors(response, has_origin, cors_origin)
        }
    }
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
