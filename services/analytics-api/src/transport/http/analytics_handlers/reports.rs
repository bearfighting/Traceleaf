use axum::{
    Json,
    extract::{Path, RawQuery, State},
    response::{IntoResponse, Response},
};

use crate::analytics::{
    errors::{ApiError, HandlerError},
    state::AnalyticsState,
    validation,
};
use crate::application::analytics_queries::AnalyticsReportRequest;

pub(crate) async fn range_overview(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let result = state
        .reads
        .report(AnalyticsReportRequest::RangeOverview { site_id, range })
        .await
        .map_err(ApiError::application)?;
    Ok(Json(result).into_response())
}

pub(crate) async fn timeline(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let result = state
        .reads
        .report(AnalyticsReportRequest::Timeline { site_id, range })
        .await
        .map_err(ApiError::application)?;
    Ok(Json(result).into_response())
}

pub(crate) async fn pages(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let limit = validation::parse_limit_query(raw_query.as_deref())?;
    let result = state
        .reads
        .report(AnalyticsReportRequest::Pages {
            site_id,
            limit,
            range,
        })
        .await
        .map_err(ApiError::application)?;
    Ok(Json(result).into_response())
}

pub(crate) async fn events(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let (limit, event_name) = validation::parse_events_query(raw_query.as_deref())?;
    let result = state
        .reads
        .report(AnalyticsReportRequest::Events {
            site_id,
            limit,
            event_name,
            range,
        })
        .await
        .map_err(ApiError::application)?;
    Ok(Json(result).into_response())
}

pub(crate) async fn web_vitals(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let (limit, path) = validation::parse_web_vitals_query(raw_query.as_deref())?;
    let result = state
        .reads
        .report(AnalyticsReportRequest::WebVitals {
            site_id,
            limit,
            path,
            range,
        })
        .await
        .map_err(ApiError::application)?;
    Ok(Json(result).into_response())
}

pub(crate) async fn conversions(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let (limit, definition_id, requested_version) =
        validation::parse_definition_query(raw_query.as_deref())?;
    let definition_version = state
        .reads
        .resolve_definition_version(&site_id, requested_version.as_deref())
        .await
        .map_err(ApiError::application)?
        .ok_or(crate::application::errors::RequestError::InvalidDefinitionVersion)?;
    let result = state
        .reads
        .report(AnalyticsReportRequest::Conversions {
            site_id,
            limit,
            definition_id,
            definition_version,
            range,
        })
        .await
        .map_err(ApiError::application)?;
    Ok(Json(result).into_response())
}

pub(crate) async fn funnels(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let (limit, definition_id, requested_version) =
        validation::parse_definition_query(raw_query.as_deref())?;
    let definition_version = state
        .reads
        .resolve_definition_version(&site_id, requested_version.as_deref())
        .await
        .map_err(ApiError::application)?
        .ok_or(crate::application::errors::RequestError::InvalidDefinitionVersion)?;
    let result = state
        .reads
        .report(AnalyticsReportRequest::Funnels {
            site_id,
            limit,
            definition_id,
            definition_version,
            range,
        })
        .await
        .map_err(ApiError::application)?;
    Ok(Json(result).into_response())
}
