use crate::{
    application::event_sink::{EventSink, SinkError, StoredEvent},
    domain::protocol::AnalyticsEvent,
    test_support::InMemorySink,
};
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
