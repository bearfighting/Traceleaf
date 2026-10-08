use super::*;

pub(super) async fn policy_effective_state(
    row: &ConfigurationRow,
    state: &SiteManagementState,
) -> Value {
    state.use_cases.policy_response(row).await.map(|response| response["effective_state"].clone()).unwrap_or_else(|_| {
        tracing::warn!("Collector application state unavailable");
        json!({"status":"pending","stored_version":row.version,"applied_versions":{"collector":null,"processor":null,"analytics_api":null}})
    })
}

pub(super) fn validate_stored_policy(
    row: &ConfigurationRow,
    state: &SiteManagementState,
    site_id: &str,
    environment: &str,
) -> Result<configuration_runtime::EnvironmentPolicyView, ConfigurationApiError> {
    state
        .use_cases
        .validate_stored_policy(row, site_id, environment)
        .map_err(map_store_error)
}

pub(super) async fn policy_response(
    row: &ConfigurationRow,
    state: &SiteManagementState,
) -> Result<Value, ConfigurationApiError> {
    state
        .use_cases
        .policy_response(row)
        .await
        .map_err(map_store_error)
}

#[cfg(test)]
pub(super) fn validate_stored_capabilities(
    row: &ConfigurationRow,
    state: &SiteManagementState,
    site_id: &str,
) -> Result<(), ConfigurationApiError> {
    state
        .use_cases
        .validate_stored_capabilities(row, site_id)
        .map_err(map_store_error)
}

pub(super) async fn capability_response(
    row: &ConfigurationRow,
    state: &SiteManagementState,
) -> Result<Value, ConfigurationApiError> {
    state
        .use_cases
        .capability_response(row)
        .await
        .map_err(map_store_error)
}
