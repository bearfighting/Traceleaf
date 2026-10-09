use chrono::Utc;
use serde_json::Value;
use thiserror::Error;

use crate::{
    application::{
        capabilities::{CapabilityId, CapabilityState},
        event_sink::{EventSink, SinkError, StoredEvent},
    },
    domain::{
        geo::GeoEnrichment,
        protocol::AnalyticsEvent,
        validation::{ValidatedEvent, Validator},
    },
};

#[derive(Debug, Error)]
pub enum IngestionError {
    #[error("event batch is invalid")]
    InvalidBatch,
    #[error("capability configuration is unavailable")]
    CapabilityUnavailable,
    #[error("event type is disabled")]
    CapabilityDisabled,
    #[error("event timestamp is outside the supported range")]
    InvalidTimestamp,
    #[error(transparent)]
    Sink(#[from] SinkError),
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum BatchSiteIdError {
    #[error("event batch contains multiple site IDs")]
    ConflictingSiteIds,
}

pub async fn ingest_batch(
    validator: &Validator,
    sink: &dyn EventSink,
    value: Value,
    geo: Option<GeoEnrichment>,
    capabilities: CapabilityState,
) -> Result<usize, IngestionError> {
    let batch = validator
        .validate(&value)
        .map_err(|_| IngestionError::InvalidBatch)?;
    if !matches!(&capabilities, CapabilityState::Unconfigured) {
        let capabilities = capabilities
            .snapshot()
            .ok_or(IngestionError::CapabilityUnavailable)?;
        if batch.events.iter().any(|event| match &event.event {
            AnalyticsEvent::Custom(_) => !capabilities.enabled(CapabilityId::CustomEvents),
            AnalyticsEvent::WebVital(_) => !capabilities.enabled(CapabilityId::WebVitals),
            AnalyticsEvent::PageView(_) => !capabilities.enabled(CapabilityId::PageViews),
        }) {
            return Err(IngestionError::CapabilityDisabled);
        }
    }

    let accepted = batch.events.len();
    let received_at = Utc::now();
    let latest_allowed = received_at + chrono::Duration::minutes(5);
    if batch.events.iter().any(|event| {
        chrono::DateTime::<Utc>::from_timestamp_millis(event.event.occurred_at())
            .is_none_or(|occurred_at| occurred_at > latest_allowed)
    }) {
        return Err(IngestionError::InvalidTimestamp);
    }

    let events = batch
        .events
        .into_iter()
        .map(|event| to_stored_event(event, received_at, geo.as_ref(), capabilities.snapshot()))
        .collect();
    sink.accept(events).await?;
    Ok(accepted)
}

pub fn batch_site_id(value: &Value) -> Result<Option<&str>, BatchSiteIdError> {
    let Some(events) = value.get("events").and_then(Value::as_array) else {
        return Ok(None);
    };
    let mut site_id = None;
    for event in events {
        let Some(current) = event.get("site_id").and_then(Value::as_str) else {
            return Ok(None);
        };
        match site_id {
            None => site_id = Some(current),
            Some(expected) if expected == current => {}
            Some(_) => return Err(BatchSiteIdError::ConflictingSiteIds),
        }
    }
    Ok(site_id)
}

fn to_stored_event(
    mut event: ValidatedEvent,
    received_at: chrono::DateTime<Utc>,
    geo: Option<&GeoEnrichment>,
    capabilities: Option<&configuration_runtime::CapabilitySnapshot>,
) -> StoredEvent {
    match &mut event.event {
        AnalyticsEvent::PageView(page_view) => {
            if capabilities.is_some_and(|caps| !caps.enabled(CapabilityId::BrowserContext)) {
                page_view.context = None;
                page_view.context_schema_version = None;
            }
            if capabilities.is_some_and(|caps| !caps.enabled(CapabilityId::AnonymousVisitors)) {
                page_view.visitor_id = None;
            }
        }
        AnalyticsEvent::Custom(custom) => {
            if capabilities.is_some_and(|caps| !caps.enabled(CapabilityId::AnonymousVisitors)) {
                custom.visitor_id = None;
            }
        }
        AnalyticsEvent::WebVital(_) => {}
    }
    let is_page_view = matches!(event.event, AnalyticsEvent::PageView(_));
    let mut payload = event.payload;
    if let Some(object) = payload.as_object_mut() {
        if capabilities.is_some_and(|caps| !caps.enabled(CapabilityId::BrowserContext)) {
            object.remove("context");
            object.remove("context_schema_version");
        }
        if capabilities.is_some_and(|caps| !caps.enabled(CapabilityId::AnonymousVisitors)) {
            object.remove("visitor_id");
        }
    }
    StoredEvent {
        event: event.event,
        payload,
        received_at,
        geo: if is_page_view { geo.cloned() } else { None },
    }
}
