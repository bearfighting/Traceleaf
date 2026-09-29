use axum::{
    Json,
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;

use crate::analytics::state::AnalyticsState;

pub(crate) async fn gate(
    State(state): State<AnalyticsState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if !path.starts_with("/v1/sites/") {
        return next.run(request).await;
    }
    let segments: Vec<_> = path.split('/').filter(|part| !part.is_empty()).collect();
    let Some(site_id) = segments.get(2).copied() else {
        return next.run(request).await;
    };
    let snapshot = match state.capabilities.snapshot(site_id) {
        Some(snapshot) => Some(snapshot),
        None => {
            let _ = state.capabilities.refresh_once().await;
            state.capabilities.snapshot(site_id)
        }
    };
    let Some(snapshot) = snapshot else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error":{"code":"configuration_unavailable","message":"Capability configuration is unavailable"}})),
        ).into_response();
    };

    // PR1 keeps existing historical reports queryable after a capability is disabled.
    // Conversion and Funnel history is explicitly non-queryable after disable.
    let disabled_nonhistorical_capability = if path.ends_with("/conversions") {
        Some("conversions")
    } else if path.ends_with("/funnels") {
        Some("funnels")
    } else {
        None
    };
    if disabled_nonhistorical_capability.is_some_and(|capability| !snapshot.enabled(capability)) {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error":{"code":"capability_not_enabled","message":"This report capability is not enabled"}})),
        ).into_response();
    }
    next.run(request).await
}
