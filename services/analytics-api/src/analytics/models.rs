use chrono::NaiveDate;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub(crate) struct OverviewResponse {
    pub(crate) site_id: String,
    pub(crate) page_views: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct RangeOverviewResponse {
    pub(crate) site_id: String,
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) page_views: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct TimelineItem {
    pub(crate) day: NaiveDate,
    pub(crate) page_views: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct TimelineResponse {
    pub(crate) site_id: String,
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) items: Vec<TimelineItem>,
}

#[derive(Debug, Serialize)]
pub(crate) struct PageItem {
    pub(crate) path: String,
    pub(crate) page_views: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct PagesResponse {
    pub(crate) site_id: String,
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) items: Vec<PageItem>,
}

#[derive(Debug, Serialize)]
pub(crate) struct VisitorSessionItem {
    pub(crate) day: NaiveDate,
    pub(crate) page_views: i64,
    pub(crate) unique_visitors: i64,
    pub(crate) sessions: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct VisitorSessionReportResponse {
    pub(crate) site_id: String,
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) page_views: i64,
    pub(crate) unique_visitors: i64,
    pub(crate) sessions: i64,
    pub(crate) items: Vec<VisitorSessionItem>,
    pub(crate) data_as_of: Option<chrono::DateTime<chrono::Utc>>,
    pub(crate) freshness_status: String,
    pub(crate) aggregation_version: i32,
}

#[derive(Debug, Serialize)]
pub(crate) struct DimensionItem {
    pub(crate) value: String,
    pub(crate) page_views: i64,
    pub(crate) unique_visitors: i64,
    pub(crate) sessions: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct DimensionReportResponse {
    pub(crate) site_id: String,
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) dimension: String,
    pub(crate) items: Vec<DimensionItem>,
    pub(crate) data_as_of: Option<chrono::DateTime<chrono::Utc>>,
    pub(crate) freshness_status: String,
    pub(crate) aggregation_version: i32,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub(crate) struct VisitorSessionRow {
    pub(crate) day: NaiveDate,
    pub(crate) page_views: i64,
    pub(crate) unique_visitors: i64,
    pub(crate) sessions: i64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub(crate) struct DimensionRow {
    pub(crate) value: String,
    pub(crate) page_views: i64,
    pub(crate) unique_visitors: i64,
    pub(crate) sessions: i64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub(crate) struct WatermarkRow {
    pub(crate) source_name: String,
    pub(crate) processed_received_watermark: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone)]
pub(crate) struct ActiveGeneration {
    pub(crate) generation_id: String,
    pub(crate) aggregation_version: i32,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct DateRange {
    pub(crate) from: NaiveDate,
    pub(crate) to: NaiveDate,
}

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct TimelineRow {
    pub(crate) day: NaiveDate,
    pub(crate) page_views: i64,
}

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct PageRow {
    pub(crate) path: String,
    pub(crate) page_views: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct EventDailyItem {
    pub(crate) day: NaiveDate,
    pub(crate) event_name: String,
    pub(crate) event_count: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct EventsReportResponse {
    pub(crate) site_id: String,
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) total: i64,
    pub(crate) items: Vec<EventDailyItem>,
    pub(crate) data_as_of: Option<chrono::DateTime<chrono::Utc>>,
    pub(crate) freshness_status: String,
    pub(crate) aggregation_version: i32,
}

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct EventDailyRow {
    pub(crate) day: NaiveDate,
    pub(crate) event_name: String,
    pub(crate) event_count: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct WebVitalReportResponse {
    pub site_id: String,
    pub from: String,
    pub to: String,
    pub total: i64,
    pub items: Vec<WebVitalReportItem>,
    pub data_as_of: Option<chrono::DateTime<chrono::Utc>>,
    pub freshness_status: String,
    pub aggregation_version: i32,
}
#[derive(Debug, Serialize)]
pub(crate) struct WebVitalReportItem {
    pub path: String,
    pub metric: String,
    pub count: i64,
    pub p75: Option<f64>,
    pub good_count: i64,
    pub needs_improvement_count: i64,
    pub poor_count: i64,
    pub status: String,
}
#[derive(Debug, sqlx::FromRow)]
pub(crate) struct WebVitalReportRow {
    pub path: String,
    pub metric: String,
    pub count: i64,
    pub p75: Option<f64>,
    pub good_count: i64,
    pub needs_improvement_count: i64,
    pub poor_count: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct ConversionReportItem {
    pub definition_id: String,
    pub day: NaiveDate,
    pub event_count: i64,
    pub converted_sessions: i64,
    pub eligible_sessions: i64,
    pub conversion_rate: f64,
}
#[derive(Debug, Serialize)]
pub(crate) struct ConversionReportResponse {
    pub site_id: String,
    pub from: String,
    pub to: String,
    pub total: i64,
    pub definition_version: String,
    pub items: Vec<ConversionReportItem>,
    pub data_as_of: Option<chrono::DateTime<chrono::Utc>>,
    pub freshness_status: String,
    pub aggregation_version: i32,
}
#[derive(Debug, sqlx::FromRow)]
pub(crate) struct ConversionReportRow {
    pub definition_id: String,
    pub day: NaiveDate,
    pub event_count: i64,
    pub converted_sessions: i64,
    pub eligible_sessions: i64,
}
#[derive(Debug, Serialize)]
pub(crate) struct FunnelReportItem {
    pub definition_id: String,
    pub day: NaiveDate,
    pub step_index: i32,
    pub sessions: i64,
    pub conversion_rate: f64,
}
#[derive(Debug, Serialize)]
pub(crate) struct FunnelReportResponse {
    pub site_id: String,
    pub from: String,
    pub to: String,
    pub total: i64,
    pub definition_version: String,
    pub items: Vec<FunnelReportItem>,
    pub data_as_of: Option<chrono::DateTime<chrono::Utc>>,
    pub freshness_status: String,
    pub aggregation_version: i32,
}
#[derive(Debug, sqlx::FromRow)]
pub(crate) struct FunnelReportRow {
    pub definition_id: String,
    pub day: NaiveDate,
    pub step_index: i32,
    pub sessions: i64,
    pub previous_step_sessions: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct GeoCountryItem {
    pub(crate) country_code: String,
    pub(crate) page_views: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct GeoCountryReportResponse {
    pub(crate) site_id: String,
    pub(crate) from: String,
    pub(crate) to: String,
    pub(crate) coverage_from: Option<NaiveDate>,
    pub(crate) providers: Vec<String>,
    pub(crate) items: Vec<GeoCountryItem>,
    pub(crate) data_as_of: Option<chrono::DateTime<chrono::Utc>>,
    pub(crate) freshness_status: String,
    pub(crate) aggregation_version: i32,
}

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct GeoCountryRow {
    pub(crate) country_code: String,
    pub(crate) page_views: i64,
}
