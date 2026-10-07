//! Rebuild a complete, generation-scoped analytics snapshot.

mod facts;
mod generation;
mod queue;

use chrono::NaiveDate;

const AGGREGATION_VERSION: i32 = 1;

#[derive(Debug, Clone)]
struct RebuildRequest {
    queue_id: Option<i64>,
    site_id: String,
    scope_from: NaiveDate,
    scope_to: NaiveDate,
    parser_version: String,
    rebuild_reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RebuildSummary {
    pub events: usize,
    pub visitors: usize,
    pub scope_from: NaiveDate,
    pub scope_to: NaiveDate,
}
