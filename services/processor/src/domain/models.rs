use chrono::{DateTime, Utc};
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct RawEvent {
    pub(crate) id: i64,
    pub(crate) event_id: String,
    pub(crate) site_id: String,
    pub(crate) occurred_at: DateTime<Utc>,
    pub(crate) received_at: DateTime<Utc>,
    pub(crate) path: String,
    pub(crate) visitor_id: Option<String>,
    pub(crate) context_schema_version: Option<i32>,
    pub(crate) payload: Value,
}
