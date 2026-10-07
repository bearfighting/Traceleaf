use super::events::request_origin;
use super::{
    AppState,
    response::{ApiError, with_cors},
};
use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode, header},
    response::{IntoResponse, Response},
};

pub(super) async fn preflight(State(state): State<AppState>, request: Request<Body>) -> Response {
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
