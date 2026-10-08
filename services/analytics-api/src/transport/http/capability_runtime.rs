use axum::{
    Json,
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use configuration_runtime::CapabilityId;
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
        if is_historical_page_view_route(path)
            && let Ok(true) = state
                .reads
                .registry_site_without_capabilities(site_id)
                .await
        {
            return next.run(request).await;
        }
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error":{"code":"configuration_unavailable","message":"Capability configuration is unavailable"}})),
        ).into_response();
    };

    // PR1 keeps existing historical reports queryable after a capability is disabled.
    // Conversion and Funnel history is explicitly non-queryable after disable.
    let disabled_nonhistorical_capability = capability_for_path(path);
    if disabled_nonhistorical_capability.is_some_and(|capability| !snapshot.enabled(capability)) {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error":{"code":"capability_not_enabled","message":"This report capability is not enabled"}})),
        ).into_response();
    }
    next.run(request).await
}

fn capability_for_path(path: &str) -> Option<CapabilityId> {
    if path.contains("/dimensions/") {
        return Some(CapabilityId::Dimensions);
    }
    let report = path.rsplit('/').next()?;
    match report {
        "overview" | "timeline" | "pages" => Some(CapabilityId::PageViews),
        "visitors" => Some(CapabilityId::AnonymousVisitors),
        "sessions" => Some(CapabilityId::Sessions),
        "dimensions" => Some(CapabilityId::Dimensions),
        "events" => Some(CapabilityId::CustomEvents),
        "web-vitals" => Some(CapabilityId::WebVitals),
        "conversions" => Some(CapabilityId::Conversions),
        "funnels" => Some(CapabilityId::Funnels),
        "geo" => Some(CapabilityId::Geo),
        _ => None,
    }
}

fn is_historical_page_view_route(path: &str) -> bool {
    ["overview", "timeline", "pages"]
        .iter()
        .any(|report| path.ends_with(&format!("/{report}")))
}

#[cfg(test)]
mod tests {
    use super::{capability_for_path, is_historical_page_view_route};
    use configuration_runtime::CapabilityId;

    #[test]
    fn capability_routes_are_mapped_explicitly() {
        assert_eq!(
            capability_for_path("/v1/sites/site/reports/a/b/conversions"),
            Some(CapabilityId::Conversions)
        );
        assert_eq!(
            capability_for_path("/v1/sites/site/reports/a/b/funnels"),
            Some(CapabilityId::Funnels)
        );
        for (route, capability) in [
            ("overview", CapabilityId::PageViews),
            ("timeline", CapabilityId::PageViews),
            ("pages", CapabilityId::PageViews),
            ("visitors", CapabilityId::AnonymousVisitors),
            ("sessions", CapabilityId::Sessions),
            ("events", CapabilityId::CustomEvents),
            ("web-vitals", CapabilityId::WebVitals),
            ("geo", CapabilityId::Geo),
        ] {
            assert_eq!(
                capability_for_path(&format!("/v1/sites/site/reports/a/b/{route}")),
                Some(capability),
                "{route}"
            );
        }
        assert_eq!(
            capability_for_path("/v1/sites/site/reports/a/b/dimensions/browser"),
            Some(CapabilityId::Dimensions)
        );
    }

    #[test]
    fn historical_fallback_only_covers_page_view_reports() {
        for report in ["overview", "timeline", "pages"] {
            assert!(is_historical_page_view_route(&format!(
                "/v1/sites/site/reports/a/b/{report}"
            )));
        }
        for report in [
            "events",
            "web-vitals",
            "geo",
            "conversions",
            "funnels",
            "visitors",
            "sessions",
        ] {
            assert!(!is_historical_page_view_route(&format!(
                "/v1/sites/site/reports/a/b/{report}"
            )));
        }
    }
}
