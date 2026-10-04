use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgPool, postgres::PgPoolOptions};
use thiserror::Error;
use tokio::sync::RwLock;

use crate::{geo::GeoEnrichment, protocol::AnalyticsEvent};

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
    #[error("event sink database operation failed: {0}")]
    Database(#[from] sqlx::Error),
    #[error("event sink failed")]
    Failed,
}

#[async_trait]
pub trait EventSink: Send + Sync {
    async fn accept(&self, events: Vec<StoredEvent>) -> Result<(), SinkError>;
}

#[derive(Clone, Default)]
pub struct InMemorySink {
    events: Arc<RwLock<Vec<AnalyticsEvent>>>,
}

impl InMemorySink {
    pub fn new() -> Self {
        Self::default()
    }

    #[allow(dead_code)]
    pub async fn snapshot(&self) -> Vec<AnalyticsEvent> {
        self.events.read().await.clone()
    }
}

#[async_trait]
impl EventSink for InMemorySink {
    async fn accept(&self, events: Vec<StoredEvent>) -> Result<(), SinkError> {
        let mut stored = self.events.write().await;
        let mut candidates = stored.clone();
        candidates.extend(events.iter().map(|event| event.event.clone()));
        for event in events.iter().filter_map(|e| match &e.event {
            AnalyticsEvent::WebVital(v) => Some(v),
            _ => None,
        }) {
            let linked = candidates.iter().any(|candidate| match candidate {
                AnalyticsEvent::PageView(p) => {
                    p.site_id == event.site_id
                        && p.event_id == event.page_view_event_id
                        && p.path == event.path
                        && p.occurred_at == event.page_view_occurred_at
                }
                _ => false,
            });
            if !linked {
                return Err(SinkError::InvalidWebVitalAssociation);
            }
        }
        stored.extend(events.into_iter().map(|event| event.event));
        Ok(())
    }
}

#[derive(Clone)]
pub struct PostgresSink {
    pool: PgPool,
}

impl PostgresSink {
    pub async fn connect(database_url: &str) -> Result<Self, SinkError> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect_lazy(database_url)?;
        Ok(Self { pool })
    }

    pub fn pool(&self) -> PgPool {
        self.pool.clone()
    }
}

#[async_trait]
impl EventSink for PostgresSink {
    async fn accept(&self, events: Vec<StoredEvent>) -> Result<(), SinkError> {
        let mut transaction = self.pool.begin().await?;
        let site_ids = events
            .iter()
            .map(|stored| stored.event.site_id().to_owned())
            .collect::<std::collections::BTreeSet<_>>();
        for site_id in site_ids {
            sqlx::query(
                "SELECT pg_advisory_xact_lock(hashtextextended('definition-revision:' || $1, 0))",
            )
            .bind(site_id)
            .execute(&mut *transaction)
            .await?;
        }
        let received_at = sqlx::query_scalar::<_, DateTime<Utc>>("SELECT clock_timestamp()")
            .fetch_one(&mut *transaction)
            .await?;

        let mut web_vital_links = Vec::new();
        for stored in events {
            let occurred_at = DateTime::<Utc>::from_timestamp_millis(stored.event.occurred_at())
                .ok_or(SinkError::InvalidTimestamp)?;
            if let AnalyticsEvent::WebVital(vital) = &stored.event {
                web_vital_links.push((
                    vital.site_id.clone(),
                    vital.page_view_event_id.clone(),
                    vital.path.clone(),
                    DateTime::<Utc>::from_timestamp_millis(vital.page_view_occurred_at)
                        .ok_or(SinkError::InvalidTimestamp)?,
                ));
            }
            let event_type = stored.event.event_type_name();

            let raw_event_id = sqlx::query_scalar::<_, i64>(
                "INSERT INTO raw_events
                (site_id, event_id, schema_version, event_type, occurred_at,
                     received_at, path, url, title, referrer, visitor_id,
                     context_schema_version, payload)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12, $13)
                 ON CONFLICT (site_id, event_id) DO NOTHING
                 RETURNING id",
            )
            .bind(stored.event.site_id())
            .bind(stored.event.event_id())
            .bind(i32::from(stored.event.schema_version()))
            .bind(event_type)
            .bind(occurred_at)
            .bind(received_at)
            .bind(stored.event.path())
            .bind(stored.event.url())
            .bind(stored.event.title())
            .bind(stored.event.referrer())
            .bind(stored.event.visitor_id())
            .bind(stored.event.context_schema_version())
            .bind(stored.payload)
            .fetch_optional(&mut *transaction)
            .await?;

            if let (Some(raw_event_id), Some(geo)) = (raw_event_id, stored.geo)
                && matches!(stored.event, AnalyticsEvent::PageView(_))
            {
                sqlx::query(
                        "INSERT INTO geo_event_metadata
                         (raw_event_id, site_id, country_code, provider, dataset_version, parser_version)
                         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (raw_event_id) DO NOTHING",
                    )
                    .bind(raw_event_id)
                    .bind(stored.event.site_id())
                    .bind(geo.country_code)
                    .bind(geo.provider)
                    .bind(geo.dataset_version)
                    .bind(geo.parser_version)
                    .execute(&mut *transaction)
                    .await?;
            }
        }
        for (site_id, page_view_id, path, page_view_at) in web_vital_links {
            let linked=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM raw_events WHERE site_id=$1 AND event_id=$2 AND event_type='page_view' AND path=$3 AND occurred_at=$4)")
                .bind(site_id).bind(page_view_id).bind(path).bind(page_view_at).fetch_one(&mut *transaction).await?;
            if !linked {
                return Err(SinkError::InvalidWebVitalAssociation);
            }
        }

        transaction.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{EventSink, InMemorySink, SinkError, StoredEvent};
    use crate::protocol::AnalyticsEvent;
    use chrono::Utc;
    use serde_json::{Value, json};

    const PAGE_VIEW_ID: &str = "01J00000000000000000000001";
    const PAGE_VIEW_AT: i64 = 1_760_000_000_000;

    fn stored_event(event: AnalyticsEvent) -> StoredEvent {
        StoredEvent {
            event,
            payload: Value::Null,
            received_at: Utc::now(),
            geo: None,
        }
    }

    fn page_view() -> AnalyticsEvent {
        serde_json::from_value(json!({
            "schema_version": 1,
            "event_id": PAGE_VIEW_ID,
            "type": "page_view",
            "site_id": "site_example",
            "occurred_at": PAGE_VIEW_AT,
            "path": "/about"
        }))
        .expect("test Page View should decode")
    }

    fn web_vital(
        site_id: &str,
        page_view_event_id: &str,
        path: &str,
        page_view_occurred_at: i64,
    ) -> AnalyticsEvent {
        serde_json::from_value(json!({
            "schema_version": 1,
            "event_id": "01J00000000000000000000002",
            "type": "web_vital",
            "site_id": site_id,
            "occurred_at": PAGE_VIEW_AT + 1_000,
            "page_view_event_id": page_view_event_id,
            "path": path,
            "page_view_occurred_at": page_view_occurred_at,
            "metric": "LCP",
            "value": 1_000,
            "rating": "good",
            "navigation_type": "navigate",
            "report_sequence": 1
        }))
        .expect("test Web Vital should decode")
    }

    #[tokio::test]
    async fn web_vital_may_link_to_page_view_in_same_or_prior_batch() {
        let same_batch_sink = InMemorySink::new();
        same_batch_sink
            .accept(vec![
                stored_event(page_view()),
                stored_event(web_vital(
                    "site_example",
                    PAGE_VIEW_ID,
                    "/about",
                    PAGE_VIEW_AT,
                )),
            ])
            .await
            .expect("same-batch association should be accepted");
        assert_eq!(same_batch_sink.snapshot().await.len(), 2);

        let prior_batch_sink = InMemorySink::new();
        prior_batch_sink
            .accept(vec![stored_event(page_view())])
            .await
            .expect("Page View should be accepted");
        prior_batch_sink
            .accept(vec![stored_event(web_vital(
                "site_example",
                PAGE_VIEW_ID,
                "/about",
                PAGE_VIEW_AT,
            ))])
            .await
            .expect("association to a stored Page View should be accepted");
        assert_eq!(prior_batch_sink.snapshot().await.len(), 2);
    }

    #[tokio::test]
    async fn web_vital_rejects_mismatched_page_view_association_atomically() {
        for (site_id, id, path, occurred_at) in [
            ("another_site", PAGE_VIEW_ID, "/about", PAGE_VIEW_AT),
            (
                "site_example",
                "01J00000000000000000000003",
                "/about",
                PAGE_VIEW_AT,
            ),
            ("site_example", PAGE_VIEW_ID, "/other", PAGE_VIEW_AT),
            ("site_example", PAGE_VIEW_ID, "/about", PAGE_VIEW_AT + 1),
        ] {
            let sink = InMemorySink::new();
            let result = sink
                .accept(vec![
                    stored_event(page_view()),
                    stored_event(web_vital(site_id, id, path, occurred_at)),
                ])
                .await;
            assert!(matches!(result, Err(SinkError::InvalidWebVitalAssociation)));
            assert!(sink.snapshot().await.is_empty());
        }
    }
}
