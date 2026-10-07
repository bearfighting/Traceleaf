use super::*;

pub(super) async fn policy_effective_state(pool: &sqlx::PgPool, row: &ConfigurationRow) -> Value {
    let site_id = row.document["site_id"].as_str().unwrap_or_default();
    let environment = row.document["environment"].as_str().unwrap_or_default();
    let collector = config_store::collector_applied_state(pool, site_id, environment, row.version)
        .await
        .unwrap_or_else(|_| {
            tracing::warn!("Collector application state unavailable");
            config_store::AppliedCollectorState {
                status: "pending",
                applied_version: None,
            }
        });
    json!({
        "status": collector.status,
        "stored_version": row.version,
        "applied_versions": {
            "collector": collector.applied_version,
            "processor": null,
            "analytics_api": null,
        }
    })
}

pub(super) fn validate_stored_policy(
    row: &ConfigurationRow,
    state: &SiteManagementState,
    site_id: &str,
    environment: &str,
) -> Result<configuration_runtime::EnvironmentPolicyView, ConfigurationApiError> {
    if state
        .validators
        .stored_policy
        .iter_errors(&row.document)
        .next()
        .is_some()
        || row.document["site_id"].as_str() != Some(site_id)
        || row.document["environment"].as_str() != Some(environment)
        || row.document["version"].as_i64() != Some(row.version)
    {
        return Err(ConfigurationApiError::Unavailable);
    }
    configuration_runtime::EnvironmentPolicyView::parse_validated(
        &row.document,
        site_id,
        environment,
        row.version,
    )
    .map_err(|_| ConfigurationApiError::Unavailable)
}

pub(super) async fn policy_response(
    pool: &sqlx::PgPool,
    row: &ConfigurationRow,
    state: &SiteManagementState,
) -> Result<Value, ConfigurationApiError> {
    let view = validate_stored_policy(
        row,
        state,
        row.document["site_id"].as_str().unwrap_or_default(),
        row.document["environment"].as_str().unwrap_or_default(),
    )?;
    let keys = view
        .ingest_keys
        .into_iter()
        .map(|key| json!({"key_id": key.key_id, "created_at": key.created_at}))
        .collect::<Vec<_>>();
    Ok(json!({
        "policy": {
            "site_id": view.site_id,
            "environment": view.environment,
            "version": view.version,
            "enabled": view.enabled,
            "allowed_origins": view.allowed_origins,
            "keys": keys,
            "rate_limit_per_minute": view.rate_limit_per_minute,
        },
        "effective_state": policy_effective_state(pool, row).await,
    }))
}

pub(super) fn validate_stored_capabilities(
    row: &ConfigurationRow,
    state: &SiteManagementState,
    site_id: &str,
) -> Result<(), ConfigurationApiError> {
    if state
        .validators
        .stored_capabilities
        .iter_errors(&row.document)
        .next()
        .is_some()
        || row.document["site_id"].as_str() != Some(site_id)
        || row.document["version"].as_i64() != Some(row.version)
        || validate_capability_dependencies(&row.document, &state.capabilities).is_err()
    {
        return Err(ConfigurationApiError::Unavailable);
    }
    Ok(())
}

pub(super) async fn capability_response(
    pool: &sqlx::PgPool,
    row: &ConfigurationRow,
    state: &SiteManagementState,
) -> Result<Value, ConfigurationApiError> {
    validate_stored_capabilities(
        row,
        state,
        row.document["site_id"].as_str().unwrap_or_default(),
    )?;
    let site_id = row.document["site_id"].as_str().unwrap_or_default();
    let collector =
        config_store::capability_applied_state(pool, "collector", site_id, row.version).await;
    let processor =
        config_store::capability_applied_state(pool, "processor", site_id, row.version).await;
    let analytics_api =
        config_store::capability_applied_state(pool, "analytics_api", site_id, row.version).await;
    let (collector, processor, analytics_api) = match (collector, processor, analytics_api) {
        (Ok(c), Ok(p), Ok(a)) => (c, p, a),
        _ => {
            tracing::warn!("capability application state unavailable");
            (
                config_store::AppliedCapabilityState {
                    status: "pending",
                    applied_version: None,
                },
                config_store::AppliedCapabilityState {
                    status: "pending",
                    applied_version: None,
                },
                config_store::AppliedCapabilityState {
                    status: "pending",
                    applied_version: None,
                },
            )
        }
    };
    let status = if [collector.status, processor.status, analytics_api.status].contains(&"stale") {
        "stale"
    } else if [collector.status, processor.status, analytics_api.status].contains(&"pending") {
        "pending"
    } else {
        "current"
    };
    Ok(json!({
        "configuration": row.document,
        "effective_state": {
            "status": status,
            "stored_version": row.version,
            "applied_versions": {
                "collector": collector.applied_version,
                "processor": processor.applied_version,
                "analytics_api": analytics_api.applied_version,
            }
        }
    }))
}
