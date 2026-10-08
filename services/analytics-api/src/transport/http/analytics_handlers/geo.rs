use axum::{
    Json,
    extract::{Path, State},
    response::{IntoResponse, Response},
};

use crate::analytics::{
    errors::{ApiError, HandlerError},
    state::AnalyticsState,
    validation,
};
use crate::application::analytics_queries::AnalyticsReportRequest;

pub(crate) async fn countries(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let result = state
        .reads
        .report(AnalyticsReportRequest::Geo { site_id, range })
        .await
        .map_err(ApiError::application)?;
    Ok(Json(result).into_response())
}
