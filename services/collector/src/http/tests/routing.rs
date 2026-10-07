use super::*;
use axum::{body::Body, http::Request};

#[tokio::test]
async fn health_returns_ok_json() {
    let response = app(InMemorySink::new())
        .oneshot(
            Request::get("/health")
                .body(Body::empty())
                .expect("request should build"),
        )
        .await
        .expect("health request should complete");

    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["content-type"], "application/json");
    assert_eq!(
        response_json(response).await,
        serde_json::json!({"status": "ok"})
    );
}
