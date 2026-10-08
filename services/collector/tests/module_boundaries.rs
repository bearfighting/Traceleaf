#[test]
fn application_and_transport_do_not_depend_on_storage_adapters() {
    let application_sources = [
        include_str!("../src/application/capabilities.rs"),
        include_str!("../src/application/config.rs"),
        include_str!("../src/application/event_sink.rs"),
        include_str!("../src/application/geo_lookup.rs"),
        include_str!("../src/application/ingestion.rs"),
        include_str!("../src/application/rate_limit.rs"),
        include_str!("../src/application/runtime_policy.rs"),
        include_str!("../src/application/runtime_policy_repository.rs"),
    ];
    let transport_sources = [
        include_str!("../src/transport/http.rs"),
        include_str!("../src/transport/http/client_ip.rs"),
        include_str!("../src/transport/http/events.rs"),
        include_str!("../src/transport/http/preflight.rs"),
        include_str!("../src/transport/http/response.rs"),
    ];
    let domain_sources = [
        include_str!("../src/domain/config.rs"),
        include_str!("../src/domain/geo.rs"),
        include_str!("../src/domain/protocol.rs"),
        include_str!("../src/domain/security.rs"),
        include_str!("../src/domain/validation.rs"),
    ];

    assert!(application_sources.iter().all(|source| {
        !source.contains("crate::storage")
            && !source.contains("storage::")
            && !source.contains("sqlx::")
            && !source.contains("axum::")
    }));
    assert!(
        transport_sources
            .iter()
            .all(|source| { !source.contains("crate::storage") && !source.contains("storage::") })
    );
    assert!(domain_sources.iter().all(|source| {
        !source.contains("application::")
            && !source.contains("storage::")
            && !source.contains("transport::")
            && !source.contains("axum::")
    }));
}
