use crate::{
    analytics::state::AnalyticsState,
    site_management::{auth::AdminTokens, state::SiteManagementState},
};
use configuration_runtime::CapabilityRegistry;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub(crate) analytics: AnalyticsState,
    pub(crate) site_management: SiteManagementState,
}

pub fn state_with_definition_version(
    pool: PgPool,
    definition_version: String,
) -> Result<AppState, String> {
    let registry = Arc::new(CapabilityRegistry::canonical().map_err(|error| error.to_string())?);
    Ok(AppState {
        analytics: AnalyticsState::new(pool.clone(), definition_version, registry.clone())?,
        site_management: SiteManagementState::new(pool, registry)?,
    })
}

pub fn state_with_admin_tokens(mut state: AppState, admin_tokens: Option<AdminTokens>) -> AppState {
    state.site_management.admin_tokens = admin_tokens;
    state
}

pub fn state(pool: PgPool) -> Result<AppState, String> {
    state_with_definition_version(pool, "1".to_owned())
}
