use crate::{
    geo::GeoLookup, rate_limit::RateLimiter, security::KeyPolicy, sink::EventSink,
    validation::Validator,
};
use axum::{
    Json, Router,
    routing::{get, post},
};
use configuration_runtime::CapabilityRuntime;
use std::sync::Arc;

mod events;
mod preflight;
mod response;
use events::events;
use preflight::preflight;

#[derive(Clone)]
pub struct AppState {
    pub(super) validator: Arc<Validator>,
    pub(super) sink: Arc<dyn EventSink>,
    pub(super) policy: Arc<KeyPolicy>,
    pub(super) rate_limiter: Arc<RateLimiter>,
    pub(super) geo: Option<Arc<GeoLookup>>,
    pub(super) trusted_proxies: Arc<Vec<ipnet::IpNet>>,
    pub(super) capabilities: Option<CapabilityRuntime>,
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
    trusted_proxies: Vec<ipnet::IpNet>,
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
    trusted_proxies: Vec<ipnet::IpNet>,
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
async fn health() -> Json<response::HealthResponse> {
    Json(response::HealthResponse { status: "ok" })
}

#[cfg(test)]
mod tests;
