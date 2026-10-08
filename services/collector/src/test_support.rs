use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::{
    application::event_sink::{EventSink, SinkError, StoredEvent},
    domain::protocol::AnalyticsEvent,
};

#[derive(Clone, Default)]
pub struct InMemorySink {
    events: Arc<RwLock<Vec<AnalyticsEvent>>>,
}

impl InMemorySink {
    pub fn new() -> Self {
        Self::default()
    }

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
        for event in events.iter().filter_map(|event| match &event.event {
            AnalyticsEvent::WebVital(vital) => Some(vital),
            _ => None,
        }) {
            let linked = candidates.iter().any(|candidate| match candidate {
                AnalyticsEvent::PageView(page_view) => {
                    page_view.site_id == event.site_id
                        && page_view.event_id == event.page_view_event_id
                        && page_view.path == event.path
                        && page_view.occurred_at == event.page_view_occurred_at
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
