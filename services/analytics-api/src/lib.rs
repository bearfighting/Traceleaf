pub(crate) mod analytics;
pub(crate) mod application;
pub(crate) mod site_management;
pub(crate) mod storage;
pub(crate) mod transport;

use configuration_runtime::CapabilityRegistry;
pub use site_management::auth::AdminTokens;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;

/// Configuration used by the public HTTP router construction entry point.
pub struct RouterConfig {
    pub database_url: String,
    pub definition_version: String,
    pub admin_tokens: Option<AdminTokens>,
}

pub fn build_router(config: RouterConfig) -> anyhow::Result<axum::Router> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy(&config.database_url)?;
    let registry = Arc::new(CapabilityRegistry::canonical()?);
    let analytics_reads = Arc::new(storage::postgres::AnalyticsReadAdapter::new(
        pool.clone(),
        config.definition_version,
    ));
    let analytics_capabilities = configuration_runtime::CapabilityRuntime::with_registry(
        pool.clone(),
        "analytics_api",
        registry.clone(),
    )
    .map_err(anyhow::Error::msg)?;
    let analytics = analytics::state::AnalyticsState::new(analytics_capabilities, analytics_reads);
    let site_management_use_cases = Arc::new(
        storage::postgres::PostgresSiteManagementAdapter::new(pool.clone()),
    );
    let site_management = application::site_management_state::SiteManagementState::new(
        site_management_use_cases,
        registry,
    )
    .map_err(anyhow::Error::msg)?;
    let health_check = Arc::new(storage::postgres::PostgresHealthCheck(pool));
    let state = application::state::AppState::new(analytics, site_management, health_check)
        .with_admin_tokens(config.admin_tokens);
    Ok(application::routes::router(state))
}
