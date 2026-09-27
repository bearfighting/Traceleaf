use axum::{
    Json,
    extract::{Path, RawQuery, State},
    response::{IntoResponse, Response},
};

use crate::{
    errors::{ApiError, HandlerError},
    models::{
        ConversionReportItem, ConversionReportResponse, EventDailyItem, EventsReportResponse,
        FunnelReportItem, FunnelReportResponse, PageItem, PagesResponse, RangeOverviewResponse,
        TimelineItem, TimelineResponse, WebVitalReportItem, WebVitalReportResponse,
    },
    queries,
    state::AppState,
    validation,
};

pub(crate) async fn range_overview(
    State(state): State<AppState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let page_views = queries::range_overview(&state.pool, &site_id, range)
        .await
        .map_err(ApiError::database)?;
    Ok(Json(RangeOverviewResponse {
        site_id,
        from,
        to,
        page_views,
    })
    .into_response())
}

pub(crate) async fn timeline(
    State(state): State<AppState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let rows = queries::timeline(&state.pool, &site_id, range)
        .await
        .map_err(ApiError::database)?;
    let items = rows
        .into_iter()
        .map(|row| TimelineItem {
            day: row.day,
            page_views: row.page_views,
        })
        .collect();
    Ok(Json(TimelineResponse {
        site_id,
        from,
        to,
        items,
    })
    .into_response())
}

pub(crate) async fn pages(
    State(state): State<AppState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let limit = validation::parse_limit_query(raw_query.as_deref())?;
    let rows = queries::pages(&state.pool, &site_id, range, limit)
        .await
        .map_err(ApiError::database)?;
    let items = rows
        .into_iter()
        .map(|row| PageItem {
            path: row.path,
            page_views: row.page_views,
        })
        .collect();
    Ok(Json(PagesResponse {
        site_id,
        from,
        to,
        items,
    })
    .into_response())
}

pub(crate) async fn events(
    State(state): State<AppState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let (limit, event_name) = validation::parse_events_query(raw_query.as_deref())?;
    let total = queries::custom_event_total(&state.pool, &site_id, range, event_name.as_deref())
        .await
        .map_err(ApiError::database)?;
    let rows = queries::custom_event_daily_rows(
        &state.pool,
        &site_id,
        range,
        event_name.as_deref(),
        limit,
    )
    .await
    .map_err(ApiError::database)?;
    let items = rows
        .into_iter()
        .map(|row| EventDailyItem {
            day: row.day,
            event_name: row.event_name,
            event_count: row.event_count,
        })
        .collect();
    let data_as_of = queries::custom_event_watermark(&state.pool, &site_id)
        .await
        .map_err(ApiError::database)?;
    let freshness_status = queries::custom_event_freshness(&state.pool, &site_id)
        .await
        .map_err(ApiError::database)?;
    Ok(Json(EventsReportResponse {
        site_id,
        from,
        to,
        total,
        items,
        data_as_of,
        freshness_status,
        aggregation_version: 1,
    })
    .into_response())
}

pub(crate) async fn web_vitals(
    State(state): State<AppState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let (limit, path) = validation::parse_web_vitals_query(raw_query.as_deref())?;
    let rows = queries::web_vital_rows(&state.pool, &site_id, range, path.as_deref(), limit)
        .await
        .map_err(ApiError::database)?;
    let total = queries::web_vital_total(&state.pool, &site_id, range, path.as_deref())
        .await
        .map_err(ApiError::database)?;
    let items = rows
        .into_iter()
        .map(|row| WebVitalReportItem {
            path: row.path,
            metric: row.metric,
            count: row.count,
            p75: row.p75,
            good_count: row.good_count,
            needs_improvement_count: row.needs_improvement_count,
            poor_count: row.poor_count,
            status: if row.count < 4 {
                "insufficient_data"
            } else {
                "available"
            }
            .to_owned(),
        })
        .collect();
    let data_as_of = queries::web_vital_watermark(&state.pool, &site_id)
        .await
        .map_err(ApiError::database)?;
    let freshness_status = queries::web_vital_freshness(&state.pool, &site_id)
        .await
        .map_err(ApiError::database)?;
    Ok(Json(WebVitalReportResponse {
        site_id,
        from,
        to,
        total,
        items,
        data_as_of,
        freshness_status,
        aggregation_version: 1,
    })
    .into_response())
}

pub(crate) async fn conversions(
    State(state): State<AppState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let (limit, definition_id, requested_version) =
        validation::parse_definition_query(raw_query.as_deref())?;
    let definition_version = resolve_definition_version(
        &state.pool,
        &site_id,
        requested_version.as_deref(),
        &state.definition_version,
    )
    .await
    .map_err(ApiError::database)?
    .ok_or(crate::errors::RequestError::InvalidDefinitionVersion)?;
    let rows = queries::conversion_rows(
        &state.pool,
        &site_id,
        &definition_version,
        range,
        definition_id.as_deref(),
        limit,
    )
    .await
    .map_err(ApiError::database)?;
    let total = queries::conversion_total(
        &state.pool,
        &site_id,
        &definition_version,
        range,
        definition_id.as_deref(),
    )
    .await
    .map_err(ApiError::database)?;
    let items = rows
        .into_iter()
        .map(|row| ConversionReportItem {
            definition_id: row.definition_id,
            day: row.day,
            event_count: row.event_count,
            converted_sessions: row.converted_sessions,
            eligible_sessions: row.eligible_sessions,
            conversion_rate: if row.eligible_sessions == 0 {
                0.0
            } else {
                row.converted_sessions as f64 / row.eligible_sessions as f64
            },
        })
        .collect();
    let data_as_of = queries::definition_revision_watermark(
        &state.pool,
        &site_id,
        "conversions",
        &definition_version,
    )
    .await
    .map_err(ApiError::database)?;
    let freshness_status =
        queries::definition_freshness(&state.pool, &site_id, "conversions", &definition_version)
            .await
            .map_err(ApiError::database)?;
    Ok(Json(ConversionReportResponse {
        site_id,
        from,
        to,
        total,
        definition_version,
        items,
        data_as_of,
        freshness_status,
        aggregation_version: 1,
    })
    .into_response())
}

pub(crate) async fn funnels(
    State(state): State<AppState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
    RawQuery(raw_query): RawQuery,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let (limit, definition_id, requested_version) =
        validation::parse_definition_query(raw_query.as_deref())?;
    let definition_version = resolve_definition_version(
        &state.pool,
        &site_id,
        requested_version.as_deref(),
        &state.definition_version,
    )
    .await
    .map_err(ApiError::database)?
    .ok_or(crate::errors::RequestError::InvalidDefinitionVersion)?;
    let rows = queries::funnel_rows(
        &state.pool,
        &site_id,
        &definition_version,
        range,
        definition_id.as_deref(),
        limit,
    )
    .await
    .map_err(ApiError::database)?;
    let total = queries::funnel_total(
        &state.pool,
        &site_id,
        &definition_version,
        range,
        definition_id.as_deref(),
    )
    .await
    .map_err(ApiError::database)?;
    let items = rows
        .into_iter()
        .map(|row| FunnelReportItem {
            definition_id: row.definition_id,
            day: row.day,
            step_index: row.step_index,
            sessions: row.sessions,
            conversion_rate: if row.previous_step_sessions == 0 {
                0.0
            } else {
                row.sessions as f64 / row.previous_step_sessions as f64
            },
        })
        .collect();
    let data_as_of = queries::definition_revision_watermark(
        &state.pool,
        &site_id,
        "funnels",
        &definition_version,
    )
    .await
    .map_err(ApiError::database)?;
    let freshness_status =
        queries::definition_freshness(&state.pool, &site_id, "funnels", &definition_version)
            .await
            .map_err(ApiError::database)?;
    Ok(Json(FunnelReportResponse {
        site_id,
        from,
        to,
        total,
        definition_version,
        items,
        data_as_of,
        freshness_status,
        aggregation_version: 1,
    })
    .into_response())
}

async fn resolve_definition_version(
    pool: &sqlx::PgPool,
    site_id: &str,
    requested: Option<&str>,
    fallback: &str,
) -> Result<Option<String>, sqlx::Error> {
    if let Some(version) = requested {
        return sqlx::query_scalar::<_, String>("SELECT definition_version FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$2")
            .bind(site_id).bind(version).fetch_optional(pool).await;
    }
    Ok(Some(sqlx::query_scalar::<_, String>("SELECT definition_version FROM site_definition_revisions WHERE site_id=$1 ORDER BY revision DESC LIMIT 1")
        .bind(site_id).fetch_optional(pool).await?.unwrap_or_else(|| fallback.to_owned())))
}
