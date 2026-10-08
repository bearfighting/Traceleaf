use axum::{
    Json,
    extract::{Path, State},
};

use crate::analytics::{errors::ApiError, models::OverviewResponse, state::AnalyticsState};

pub(crate) async fn overview(
    State(state): State<AnalyticsState>,
    Path(site_id): Path<String>,
) -> Result<Json<OverviewResponse>, ApiError> {
    let page_views = state
        .reads
        .overview_page_views(&site_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "analytics overview use case failed");
            ApiError
        })?;
    Ok(Json(OverviewResponse {
        site_id,
        page_views,
    }))
}
