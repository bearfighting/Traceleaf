use super::auth::AdminTokens;
use configuration_runtime::CapabilityRegistry;
use sqlx::PgPool;
use std::sync::Arc;

use super::validation::ConfigurationValidators;

#[derive(Clone)]
pub(crate) struct SiteManagementState {
    pub(crate) pool: PgPool,
    pub(crate) admin_tokens: Option<AdminTokens>,
    pub(crate) validators: ConfigurationValidators,
    pub(crate) capabilities: Arc<CapabilityRegistry>,
}

impl SiteManagementState {
    pub(crate) fn new(pool: PgPool, capabilities: Arc<CapabilityRegistry>) -> Result<Self, String> {
        Ok(Self {
            pool,
            admin_tokens: None,
            validators: ConfigurationValidators::new()?,
            capabilities,
        })
    }
}
