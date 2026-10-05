use axum::{
    Json,
    extract::{Path, RawQuery, State},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use sqlx::Postgres;

use crate::analytics::{
    errors::{ApiError, HandlerError},
    models::{
        DimensionItem, DimensionReportResponse, VisitorSessionItem, VisitorSessionReportResponse,
    },
    queries,
    state::AnalyticsState,
    validation,
};

async fn read_only_report_transaction<'a>(
    state: &'a AnalyticsState,
    _site_id: &str,
) -> Result<sqlx::Transaction<'a, Postgres>, HandlerError> {
    let mut transaction = state.pool.begin().await.map_err(ApiError::database)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *transaction)
        .await
        .map_err(ApiError::database)?;
    Ok(transaction)
}

fn common_watermark(
    rows: &[crate::analytics::models::WatermarkRow],
    required_sources: &[&str],
) -> Option<DateTime<Utc>> {
    required_sources
        .iter()
        .map(|source| {
            rows.iter()
                .find(|row| row.source_name == *source)
                .and_then(|row| row.processed_received_watermark)
        })
        .collect::<Option<Vec<_>>>()
        .and_then(|values| values.into_iter().min())
}

pub(crate) async fn visitors(
    State(state): State<AnalyticsState>,
    Path((site_id, from, to)): Path<(String, String, String)>,
) -> Result<Response, HandlerError> {
    let range = validation::parse_range(&from, &to)?;
    let mut transaction = read_only_report_transaction(&state, &site_id).await?;
    let Some(generation) = queries::active_generation(&mut transaction, &site_id)
        .await
        .map_err(ApiError::database)?
    else {
        let freshness_status =
            queries::freshness_status_without_generation(&mut transaction, &site_id)
                .await
                .map_err(ApiError::database)?;
        transaction.commit().await.map_err(ApiError::database)?;
        return Ok(Json(VisitorSessionReportResponse {
            site_id,
            from,
            to,
            page_views: 0,
            unique_visitors: 0,
            sessions: 0,
            items: Vec::new(),
            data_as_of: None,
            freshness_status,
            aggregation_version: 1,
        })
        .into_response());
    };
    let (page_views, unique_visitors, sessions) = queries::visitor_session_counts(
        &mut transaction,
        &site_id,
        &generation.generation_id,
        range,
    )
    .await
    .map_err(ApiError::database)?;
    let items = queries::visitor_session_daily(
        &mut transaction,
        &site_id,
        &generation.generation_id,
        range,
    )
    .await
    .map_err(ApiError::database)?
    .into_iter()
    .map(|row| VisitorSessionItem {
        day: row.day,
        page_views: row.page_views,
        unique_visitors: row.unique_visitors,
        sessions: row.sessions,
    })
    .collect::<Vec<_>>();
    let watermark_rows = queries::watermarks(
        &mut transaction,
        &site_id,
        &generation.generation_id,
        "visitor_session",
    )
    .await
    .map_err(ApiError::database)?;
    let data_as_of = if page_views == 0 && unique_visitors == 0 && sessions == 0 {
        None
    } else {
        common_watermark(&watermark_rows, &["page_views", "visitor_session"])
    };
    let freshness_status = queries::freshness_status(
        &mut transaction,
        &site_id,
        &generation.generation_id,
        "visitor_session",
    )
    .await
    .map_err(ApiError::database)?;
    transaction.commit().await.map_err(ApiError::database)?;
    Ok(Json(VisitorSessionReportResponse {
        site_id,
        from,
        to,
        page_views,
        unique_visitors,
        sessions,
        items,
        data_as_of,
        freshness_status,
        aggregation_version: generation.aggregation_version,
    })
    .into_response())
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
    let mut transaction = read_only_report_transaction(&state, &site_id).await?;
    let range = match validation::parse_range(&from, &to) {
        Ok(range) => range,
        Err(error) => {
            transaction.rollback().await.map_err(ApiError::database)?;
            return Err(error.into());
        }
    };
    if let Err(error) = validation::validate_dimension(&dimension) {
        transaction.rollback().await.map_err(ApiError::database)?;
        return Err(error.into());
    }
    let limit = match validation::parse_limit_query(raw_query.as_deref()) {
        Ok(limit) => limit,
        Err(error) => {
            transaction.rollback().await.map_err(ApiError::database)?;
            return Err(error.into());
        }
    };
    let Some(generation) = queries::active_generation(&mut transaction, &site_id)
        .await
        .map_err(ApiError::database)?
    else {
        let freshness_status =
            queries::freshness_status_without_generation(&mut transaction, &site_id)
                .await
                .map_err(ApiError::database)?;
        transaction.commit().await.map_err(ApiError::database)?;
        return Ok(Json(DimensionReportResponse {
            site_id,
            from,
            to,
            dimension,
            items: Vec::new(),
            data_as_of: None,
            freshness_status,
            aggregation_version: 1,
        })
        .into_response());
    };
    let rows = queries::dimension_rows(
        &mut transaction,
        &site_id,
        &generation.generation_id,
        &dimension,
        range,
        limit,
    )
    .await
    .map_err(ApiError::database)?;
    let has_items = !rows.is_empty();
    let items = rows
        .into_iter()
        .map(|row| DimensionItem {
            value: row.value,
            page_views: row.page_views,
            unique_visitors: row.unique_visitors,
            sessions: row.sessions,
        })
        .collect();
    let watermark_rows = queries::watermarks(
        &mut transaction,
        &site_id,
        &generation.generation_id,
        "dimensions",
    )
    .await
    .map_err(ApiError::database)?;
    let data_as_of = has_items
        .then(|| common_watermark(&watermark_rows, &["page_views", "dimensions"]))
        .flatten();
    let freshness_status = queries::freshness_status(
        &mut transaction,
        &site_id,
        &generation.generation_id,
        "dimensions",
    )
    .await
    .map_err(ApiError::database)?;
    transaction.commit().await.map_err(ApiError::database)?;
    Ok(Json(DimensionReportResponse {
        site_id,
        from,
        to,
        dimension,
        items,
        data_as_of,
        freshness_status,
        aggregation_version: generation.aggregation_version,
    })
    .into_response())
}
