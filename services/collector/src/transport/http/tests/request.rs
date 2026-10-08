use super::*;

#[tokio::test]
async fn accepts_single_event_and_stores_it() {
    let sink = InMemorySink::new();
    let response = app(sink.clone())
        .oneshot(request(&format!(
            r#"{{"schema_version":1,"events":[{VALID_EVENT}]}}"#
        )))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 202);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({"accepted": 1})
    );
    assert_eq!(sink.snapshot().await.len(), 1);
}

#[tokio::test]
async fn accepts_multiple_events_and_charset_content_type() {
    let sink = InMemorySink::new();
    let body = format!(
        r#"{{"schema_version":1,"events":[{VALID_EVENT},{VALID_EVENT}],"future_field":true}}"#
    );
    let response = app(sink.clone())
        .oneshot(request_with_content_type(
            &body,
            "application/json; charset=utf-8",
        ))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 202);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({"accepted": 2})
    );
    assert_eq!(sink.snapshot().await.len(), 2);
}

#[tokio::test]
async fn rejects_invalid_json_without_writing() {
    let sink = InMemorySink::new();
    let response = app(sink.clone())
        .oneshot(request("{"))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 400);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "invalid_json"
    );
    assert!(sink.snapshot().await.is_empty());
}

#[tokio::test]
async fn rejects_unsupported_content_type() {
    let response = app(InMemorySink::new())
        .oneshot(
            Request::post("/v1/events")
                .header("content-type", "text/plain")
                .body(Body::from(VALID_EVENT))
                .expect("request should build"),
        )
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 415);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "unsupported_media_type"
    );
}

#[tokio::test]
async fn rejects_missing_content_type() {
    let response = app(InMemorySink::new())
        .oneshot(
            Request::post("/v1/events")
                .body(Body::from(VALID_EVENT))
                .expect("request should build"),
        )
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 415);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "unsupported_media_type"
    );
}

#[tokio::test]
async fn rejects_oversized_body() {
    let response = app(InMemorySink::new())
        .oneshot(
            Request::post("/v1/events")
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    "{{\"padding\":\"{}\"}}",
                    "x".repeat(64 * 1024)
                )))
                .expect("request should build"),
        )
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 413);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "payload_too_large"
    );
}

#[tokio::test]
async fn sink_failure_returns_collector_error() {
    let response = app(FailingSink)
        .oneshot(request(&format!(
            r#"{{"schema_version":1,"events":[{VALID_EVENT}]}}"#
        )))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), 500);
    assert_eq!(
        response_json(response).await["error"]["code"],
        "collector_error"
    );
}
