use super::auth::AdminTokens;
use sqlx::PgPool;

use super::validation::ConfigurationValidators;

#[derive(Clone)]
pub(crate) struct SiteManagementState {
    pub(crate) pool: PgPool,
    pub(crate) admin_tokens: Option<AdminTokens>,
    pub(crate) validators: ConfigurationValidators,
}

impl SiteManagementState {
    pub(crate) fn new(pool: PgPool) -> Result<Self, String> {
        Ok(Self {
            pool,
            admin_tokens: None,
            validators: ConfigurationValidators::new()?,
        })
    }
}
