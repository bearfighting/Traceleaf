use crate::{
    analytics::routes as analytics_routes, site_management::routes as site_management_routes,
    state::AppState,
};
use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde_json::json;

pub(crate) fn router(state: AppState) -> Router {
    Router::new()
        .merge(analytics_routes::router(state.analytics.clone()))
        .merge(site_management_routes::router(
            state.site_management.clone(),
        ))
        .merge(
            Router::new()
                .route("/health", get(health))
                .with_state(state),
        )
}

async fn health(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    sqlx::query("SELECT 1")
        .execute(&state.analytics.pool)
        .await
        .map_err(|error| {
            tracing::error!(%error, "analytics health database check failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error":{"code":"analytics_api_error","message":"Analytics API failed to complete the request"}})),
            )
        })?;
    Ok(Json(json!({"status":"ok"})))
}
