use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::Value;
use thiserror::Error;

use crate::domain::{geo::GeoEnrichment, protocol::AnalyticsEvent};

#[derive(Debug, Clone)]
pub struct StoredEvent {
    pub event: AnalyticsEvent,
    pub payload: Value,
    pub received_at: DateTime<Utc>,
    pub geo: Option<GeoEnrichment>,
}

#[derive(Debug, Error)]
pub enum SinkError {
    #[error("event timestamp is outside the supported range")]
    InvalidTimestamp,
    #[error("Web Vital event does not match a stored Page View")]
    InvalidWebVitalAssociation,
    #[error("event storage operation failed: {0}")]
    Storage(String),
    #[error("event sink failed")]
    Failed,
}

#[async_trait]
pub trait EventSink: Send + Sync {
    async fn accept(&self, events: Vec<StoredEvent>) -> Result<(), SinkError>;
}
