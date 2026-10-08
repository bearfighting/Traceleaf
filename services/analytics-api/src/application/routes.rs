use crate::{
    application::state::AppState,
    transport::http::{analytics_routes, site_management::routes as site_management_routes},
};
use axum::Router;

pub(crate) fn router(state: AppState) -> Router {
    Router::new()
        .merge(analytics_routes::router(state.analytics.clone()))
        .merge(site_management_routes::router(
            state.site_management.clone(),
        ))
        .merge(crate::transport::http::health::router(state))
}
