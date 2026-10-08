use crate::{
    analytics::models::{
        DateRange, DimensionItem, DimensionReportResponse, VisitorSessionItem,
        VisitorSessionReportResponse,
    },
    application::errors::AnalyticsApplicationError,
    storage::postgres::{
        query_rows::{ActiveGeneration, DimensionRow, VisitorSessionRow, WatermarkRow},
        report_freshness::common_watermark,
    },
};
use sqlx::{PgPool, Postgres, Transaction};

use super::analytics_queries as queries;

pub(crate) struct PostgresReportTransactionFactory(pub(crate) PgPool);

struct PostgresReportReadTransaction<'a> {
    transaction: Option<Transaction<'a, Postgres>>,
}

#[async_trait::async_trait]
impl ReportTransactionFactory for PostgresReportTransactionFactory {
    async fn begin(&self) -> Result<Box<dyn ReportReadTransaction + '_>, String> {
        let transaction = queries::begin_read_only_report(&self.0)
            .await
            .map_err(|error| error.to_string())?;
        Ok(Box::new(PostgresReportReadTransaction {
            transaction: Some(transaction),
        }))
    }
}

#[async_trait::async_trait]
impl ReportReadTransaction for PostgresReportReadTransaction<'_> {
    async fn visitors(
        &mut self,
        site_id: &str,
        range: DateRange,
    ) -> Result<VisitorReportRead, String> {
        let transaction = self.transaction.as_mut().expect("transaction is active");
        let generation = queries::active_generation(transaction, site_id)
            .await
            .map_err(|error| error.to_string())?;
        let Some(active) = generation.as_ref() else {
            let freshness_status =
                queries::freshness_status_without_generation(transaction, site_id)
                    .await
                    .map_err(|error| error.to_string())?;
            return Ok(VisitorReportRead {
                generation,
                page_views: 0,
                unique_visitors: 0,
                sessions: 0,
                items: vec![],
                marks: vec![],
                freshness_status,
            });
        };
        let (page_views, unique_visitors, sessions) =
            queries::visitor_session_counts(transaction, site_id, &active.generation_id, range)
                .await
                .map_err(|error| error.to_string())?;
        let items =
            queries::visitor_session_daily(transaction, site_id, &active.generation_id, range)
                .await
                .map_err(|error| error.to_string())?;
        let marks = queries::watermarks(
            transaction,
            site_id,
            &active.generation_id,
            "visitor_session",
        )
        .await
        .map_err(|error| error.to_string())?;
        let freshness_status = queries::freshness_status(
            transaction,
            site_id,
            &active.generation_id,
            "visitor_session",
        )
        .await
        .map_err(|error| error.to_string())?;
        Ok(VisitorReportRead {
            generation,
            page_views,
            unique_visitors,
            sessions,
            items,
            marks,
            freshness_status,
        })
    }

    async fn dimensions(
        &mut self,
        site_id: &str,
        dimension: &str,
        limit: i64,
        range: DateRange,
    ) -> Result<DimensionReportRead, String> {
        let transaction = self.transaction.as_mut().expect("transaction is active");
        let generation = queries::active_generation(transaction, site_id)
            .await
            .map_err(|error| error.to_string())?;
        let Some(active) = generation.as_ref() else {
            let freshness_status =
                queries::freshness_status_without_generation(transaction, site_id)
                    .await
                    .map_err(|error| error.to_string())?;
            return Ok(DimensionReportRead {
                generation,
                items: vec![],
                marks: vec![],
                freshness_status,
            });
        };
        let items = queries::dimension_rows(
            transaction,
            site_id,
            &active.generation_id,
            dimension,
            range,
            limit,
        )
        .await
        .map_err(|error| error.to_string())?;
        let marks = queries::watermarks(transaction, site_id, &active.generation_id, "dimensions")
            .await
            .map_err(|error| error.to_string())?;
        let freshness_status =
            queries::freshness_status(transaction, site_id, &active.generation_id, "dimensions")
                .await
                .map_err(|error| error.to_string())?;
        Ok(DimensionReportRead {
            generation,
            items,
            marks,
            freshness_status,
        })
    }

    async fn commit(mut self: Box<Self>) -> Result<(), String> {
        self.transaction
            .take()
            .expect("transaction is active")
            .commit()
            .await
            .map_err(|error| error.to_string())
    }
}

pub(crate) struct VisitorReportRead {
    pub(crate) generation: Option<ActiveGeneration>,
    pub(crate) page_views: i64,
    pub(crate) unique_visitors: i64,
    pub(crate) sessions: i64,
    pub(crate) items: Vec<VisitorSessionRow>,
    pub(crate) marks: Vec<WatermarkRow>,
    pub(crate) freshness_status: String,
}

pub(crate) struct DimensionReportRead {
    pub(crate) generation: Option<ActiveGeneration>,
    pub(crate) items: Vec<DimensionRow>,
    pub(crate) marks: Vec<WatermarkRow>,
    pub(crate) freshness_status: String,
}

#[async_trait::async_trait]
pub(crate) trait ReportReadTransaction: Send {
    async fn visitors(
        &mut self,
        site_id: &str,
        range: DateRange,
    ) -> Result<VisitorReportRead, String>;
    async fn dimensions(
        &mut self,
        site_id: &str,
        dimension: &str,
        limit: i64,
        range: DateRange,
    ) -> Result<DimensionReportRead, String>;
    async fn commit(self: Box<Self>) -> Result<(), String>;
}

#[async_trait::async_trait]
pub(crate) trait ReportTransactionFactory: Send + Sync {
    async fn begin(&self) -> Result<Box<dyn ReportReadTransaction + '_>, String>;
}

fn storage_error(error: String) -> AnalyticsApplicationError {
    AnalyticsApplicationError::Storage(error)
}

pub(crate) async fn visitors_report(
    factory: &dyn ReportTransactionFactory,
    site_id: &str,
    range: DateRange,
) -> Result<VisitorSessionReportResponse, AnalyticsApplicationError> {
    let mut transaction = factory.begin().await.map_err(storage_error)?;
    let read = transaction
        .visitors(site_id, range)
        .await
        .map_err(storage_error)?;
    transaction.commit().await.map_err(storage_error)?;
    let has_values = read.page_views != 0 || read.unique_visitors != 0 || read.sessions != 0;
    let data_as_of = if has_values {
        common_watermark(&read.marks, &["page_views", "visitor_session"])
    } else {
        None
    };
    Ok(VisitorSessionReportResponse {
        site_id: site_id.to_owned(),
        from: range.from.format("%Y-%m-%d").to_string(),
        to: range.to.format("%Y-%m-%d").to_string(),
        page_views: read.page_views,
        unique_visitors: read.unique_visitors,
        sessions: read.sessions,
        items: read
            .items
            .into_iter()
            .map(|row| VisitorSessionItem {
                day: row.day,
                page_views: row.page_views,
                unique_visitors: row.unique_visitors,
                sessions: row.sessions,
            })
            .collect(),
        data_as_of,
        freshness_status: read.freshness_status,
        aggregation_version: read
            .generation
            .map_or(1, |generation| generation.aggregation_version),
    })
}

pub(crate) async fn dimensions_report(
    factory: &dyn ReportTransactionFactory,
    site_id: &str,
    dimension: String,
    limit: i64,
    range: DateRange,
) -> Result<DimensionReportResponse, AnalyticsApplicationError> {
    let mut transaction = factory.begin().await.map_err(storage_error)?;
    let read = transaction
        .dimensions(site_id, &dimension, limit, range)
        .await
        .map_err(storage_error)?;
    transaction.commit().await.map_err(storage_error)?;
    let has_items = !read.items.is_empty();
    let items = read
        .items
        .into_iter()
        .map(|row| DimensionItem {
            value: row.value,
            page_views: row.page_views,
            unique_visitors: row.unique_visitors,
            sessions: row.sessions,
        })
        .collect();
    let data_as_of = has_items
        .then(|| common_watermark(&read.marks, &["page_views", "dimensions"]))
        .flatten();
    Ok(DimensionReportResponse {
        site_id: site_id.to_owned(),
        from: range.from.format("%Y-%m-%d").to_string(),
        to: range.to.format("%Y-%m-%d").to_string(),
        dimension,
        items,
        data_as_of,
        freshness_status: read.freshness_status,
        aggregation_version: read
            .generation
            .map_or(1, |generation| generation.aggregation_version),
    })
}
