use axum::{
    Json,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;

pub(super) fn with_cors(
    mut response: Response,
    has_origin: bool,
    allowed_origin: Option<&str>,
) -> Response {
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

pub(super) fn json_response<T: Serialize>(status: StatusCode, value: T) -> Response {
    (status, Json(value)).into_response()
}

#[derive(Debug, Serialize)]
pub(super) struct HealthResponse {
    pub(super) status: &'static str,
}

#[derive(Debug, Serialize)]
pub(super) struct AcceptedResponse {
    pub(super) accepted: usize,
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

pub(super) struct ApiError(ErrorResponse, StatusCode);

impl ApiError {
    pub(super) fn new(code: &'static str, message: &'static str, status: StatusCode) -> Self {
        Self(
            ErrorResponse {
                error: ErrorBody { code, message },
            },
            status,
        )
    }

    pub(super) fn invalid_json() -> Self {
        Self::new(
            "invalid_json",
            "Request body must be valid JSON",
            StatusCode::BAD_REQUEST,
        )
    }

    pub(super) fn invalid_event_batch() -> Self {
        Self::new(
            "invalid_event_batch",
            "Event batch validation failed",
            StatusCode::BAD_REQUEST,
        )
    }

    pub(super) fn capability_disabled() -> Self {
        Self::new(
            "capability_disabled",
            "This event capability is disabled",
            StatusCode::FORBIDDEN,
        )
    }

    pub(super) fn configuration_unavailable() -> Self {
        Self::new(
            "configuration_unavailable",
            "Capability configuration is unavailable",
            StatusCode::SERVICE_UNAVAILABLE,
        )
    }

    pub(super) fn invalid_occurred_at() -> Self {
        Self::new(
            "invalid_occurred_at",
            "Event occurred_at is outside the supported range",
            StatusCode::BAD_REQUEST,
        )
    }

    pub(super) fn payload_too_large() -> Self {
        Self::new(
            "payload_too_large",
            "Request body exceeds the maximum size",
            StatusCode::PAYLOAD_TOO_LARGE,
        )
    }

    pub(super) fn unsupported_media_type() -> Self {
        Self::new(
            "unsupported_media_type",
            "Content-Type must be application/json",
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        )
    }

    pub(super) fn collector_error() -> Self {
        Self::new(
            "collector_error",
            "Collector failed to accept the event batch",
            StatusCode::INTERNAL_SERVER_ERROR,
        )
    }

    pub(super) fn invalid_ingest_key() -> Self {
        Self::new(
            "invalid_ingest_key",
            "Ingest Key is missing or invalid",
            StatusCode::UNAUTHORIZED,
        )
    }

    pub(super) fn site_not_allowed() -> Self {
        Self::new(
            "site_not_allowed",
            "Site is not allowed",
            StatusCode::FORBIDDEN,
        )
    }

    pub(super) fn origin_not_allowed() -> Self {
        Self::new(
            "origin_not_allowed",
            "Origin is not allowed",
            StatusCode::FORBIDDEN,
        )
    }
}

pub(super) fn rate_limited_response() -> Response {
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
