use super::*;

#[tokio::test]
async fn rejects_invalid_batch_without_writing() {
    let sink = InMemorySink::new();
    let body = r#"{"schema_version":1,"events":[{"schema_version":1,"event_id":"bad","type":"page_view","site_id":"site_example","occurred_at":-1,"path":"about"}]}"#;
    let response = app(sink.clone())
        .oneshot(request(body))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 400);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "invalid_event_batch"
    );
    assert!(sink.snapshot().await.is_empty());
}

#[tokio::test]
async fn rejects_empty_batch() {
    let response = app(InMemorySink::new())
        .oneshot(request(r#"{"schema_version":1,"events":[]}"#))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 400);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "invalid_event_batch"
    );
}

#[tokio::test]
async fn rejects_batch_with_more_than_100_events() {
    let event: serde_json::Value = serde_json::from_str(VALID_EVENT).expect("event should parse");
    let body = serde_json::json!({
        "schema_version": 1,
        "events": (0..101).map(|_| event.clone()).collect::<Vec<_>>(),
    });
    let response = app(InMemorySink::new())
        .oneshot(request(&body.to_string()))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 400);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "invalid_event_batch"
    );
}

#[tokio::test]
async fn rejects_missing_required_field_and_wrong_event_type() {
    for body in [
        r#"{"schema_version":1,"events":[{"schema_version":1,"type":"page_view","site_id":"site_example","occurred_at":1760000000000,"path":"/about"}]}"#,
        r#"{"schema_version":1,"events":[{"schema_version":1,"event_id":"01J00000000000000000000000","type":"custom","site_id":"site_example","occurred_at":1760000000000,"path":"/about"}]}"#,
    ] {
        let response = app(InMemorySink::new())
            .oneshot(request(body))
            .await
            .expect("request should complete");

        assert_eq!(response.status(), 400);
        assert_eq!(
            response_json(response).await["error"]["code"],
            "invalid_event_batch"
        );
    }
}

#[tokio::test]
async fn rejects_invalid_occurred_at() {
    let body = r#"{"schema_version":1,"events":[{"schema_version":1,"event_id":"01J00000000000000000000000","type":"page_view","site_id":"site_example","occurred_at":-1,"path":"/about"}]}"#;
    let response = app(InMemorySink::new())
        .oneshot(request(body))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 400);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "invalid_event_batch"
    );
}

#[tokio::test]
async fn rejects_mixed_batch_atomically() {
    let sink = InMemorySink::new();
    let body = format!(
        r#"{{"schema_version":1,"events":[{VALID_EVENT},{{"schema_version":1,"event_id":"bad","type":"page_view","site_id":"site_example","occurred_at":-1,"path":"/about"}}]}}"#
    );
    let response = app(sink.clone())
        .oneshot(request(&body))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 400);
    assert!(sink.snapshot().await.is_empty());
}
