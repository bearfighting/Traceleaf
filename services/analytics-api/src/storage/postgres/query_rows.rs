use chrono::NaiveDate;

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

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct EventDailyRow {
    pub(crate) day: NaiveDate,
    pub(crate) event_name: String,
    pub(crate) event_count: i64,
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

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct ConversionReportRow {
    pub definition_id: String,
    pub day: NaiveDate,
    pub event_count: i64,
    pub converted_sessions: i64,
    pub eligible_sessions: i64,
}

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct FunnelReportRow {
    pub definition_id: String,
    pub day: NaiveDate,
    pub step_index: i32,
    pub sessions: i64,
    pub previous_step_sessions: i64,
}

#[derive(Debug, sqlx::FromRow)]
pub(crate) struct GeoCountryRow {
    pub(crate) country_code: String,
    pub(crate) page_views: i64,
}
