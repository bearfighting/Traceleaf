//! Application boundary for analytics reads.

use crate::analytics::definition_catalog::DefinitionRevision;
use crate::analytics::models::{
    AnalyticsReportResponse, DimensionReportResponse, VisitorSessionReportResponse,
};
use crate::application::errors::AnalyticsApplicationError;
#[async_trait::async_trait]
pub(crate) trait AnalyticsReadUseCases: Send + Sync {
    async fn report(
        &self,
        request: AnalyticsReportRequest,
    ) -> Result<AnalyticsReportResponse, AnalyticsApplicationError>;
    async fn overview_page_views(&self, site_id: &str) -> Result<i64, AnalyticsApplicationError>;
    async fn definition_revisions(
        &self,
        site_id: &str,
    ) -> Result<Vec<DefinitionRevision>, AnalyticsApplicationError>;
    async fn resolve_definition_version(
        &self,
        site_id: &str,
        requested: Option<&str>,
    ) -> Result<Option<String>, AnalyticsApplicationError>;
    async fn registry_site_without_capabilities(
        &self,
        site_id: &str,
    ) -> Result<bool, AnalyticsApplicationError>;
    async fn visitors_report(
        &self,
        site_id: &str,
        range: crate::analytics::models::DateRange,
    ) -> Result<VisitorSessionReportResponse, AnalyticsApplicationError>;
    async fn dimensions_report(
        &self,
        site_id: &str,
        dimension: String,
        limit: i64,
        range: crate::analytics::models::DateRange,
    ) -> Result<DimensionReportResponse, AnalyticsApplicationError>;
}

pub(crate) enum AnalyticsReportRequest {
    RangeOverview {
        site_id: String,
        range: crate::analytics::models::DateRange,
    },
    Timeline {
        site_id: String,
        range: crate::analytics::models::DateRange,
    },
    Pages {
        site_id: String,
        limit: i64,
        range: crate::analytics::models::DateRange,
    },
    Events {
        site_id: String,
        limit: i64,
        event_name: Option<String>,
        range: crate::analytics::models::DateRange,
    },
    WebVitals {
        site_id: String,
        limit: i64,
        path: Option<String>,
        range: crate::analytics::models::DateRange,
    },
    Conversions {
        site_id: String,
        limit: i64,
        definition_id: Option<String>,
        definition_version: String,
        range: crate::analytics::models::DateRange,
    },
    Funnels {
        site_id: String,
        limit: i64,
        definition_id: Option<String>,
        definition_version: String,
        range: crate::analytics::models::DateRange,
    },
    Geo {
        site_id: String,
        range: crate::analytics::models::DateRange,
    },
}
