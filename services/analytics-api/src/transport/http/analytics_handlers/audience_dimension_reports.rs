use crate::analytics::{
    errors::{ApiError, HandlerError},
    state::AnalyticsState,
    validation,
};
use axum::{
    Json,
    extract::{Path, RawQuery, State},
    response::{IntoResponse, Response},
};

pub(crate) async fn visitors(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let value = state
        .reads
        .visitors_report(&site_id, range)
        .await
        .map_err(ApiError::application)?;
    Ok(Json(value).into_response())
}

pub(crate) async fn sessions(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
) -> Result<Response, HandlerError> {
    visitors(State(state), Path((site_id, from, to))).await
}

pub(crate) async fn dimensions(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to, dimension)): Path<(String, String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    validation::validate_dimension(&dimension)?;
    let limit = validation::parse_limit_query(raw_query.as_deref())?;
    let value = state
        .reads
        .dimensions_report(&site_id, dimension, limit, range)
        .await
        .map_err(ApiError::application)?;
    Ok(Json(value).into_response())
}
