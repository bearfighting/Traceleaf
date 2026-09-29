use super::auth::AdminTokens;
use sqlx::PgPool;

#[derive(Clone)]
pub(crate) struct SiteManagementState {
    pub(crate) pool: PgPool,
    pub(crate) admin_tokens: Option<AdminTokens>,
}

impl SiteManagementState {
    pub(crate) fn new(pool: PgPool) -> Self {
        Self {
            pool,
            admin_tokens: None,
        }
    }
}
