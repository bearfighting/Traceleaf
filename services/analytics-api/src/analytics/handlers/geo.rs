use axum::{
    Json,
    extract::{Path, State},
    response::{IntoResponse, Response},
};

use crate::analytics::{
    errors::{ApiError, HandlerError},
    models::{GeoCountryItem, GeoCountryReportResponse},
    queries,
    state::AnalyticsState,
    validation,
};

pub(crate) async fn countries(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let items = queries::geo_country_rows(&state.pool, &site_id, range)
        .await
        .map_err(ApiError::database)?
        .into_iter()
        .map(|row| GeoCountryItem {
            country_code: row.country_code,
            page_views: row.page_views,
        })
        .collect();
    let coverage_from = queries::geo_country_coverage_from(&state.pool, &site_id)
        .await
        .map_err(ApiError::database)?;
    let providers = queries::geo_country_providers(&state.pool, &site_id, range)
        .await
        .map_err(ApiError::database)?;
    let data_as_of = queries::page_view_watermark(&state.pool, &site_id)
        .await
        .map_err(ApiError::database)?;
    let freshness_status = queries::geo_country_freshness(&state.pool, &site_id)
        .await
        .map_err(ApiError::database)?;
    Ok(Json(GeoCountryReportResponse {
        site_id,
        from,
        to,
        coverage_from,
        providers,
        items,
        data_as_of,
        freshness_status,
        aggregation_version: 1,
    })
    .into_response())
}
