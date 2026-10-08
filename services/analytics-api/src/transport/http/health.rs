use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde_json::json;

use crate::application::state::AppState;

pub(crate) fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .with_state(state)
}

async fn health(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    state.health_check.check().await.map_err(|()| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error":{"code":"analytics_api_error","message":"Analytics API failed to complete the request"}})),
        )
    })?;
    Ok(Json(json!({"status":"ok"})))
}
