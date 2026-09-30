use configuration_runtime::CapabilityRuntime;
use sqlx::PgPool;

#[derive(Clone)]
pub(crate) struct AnalyticsState {
    pub(crate) pool: PgPool,
    pub(crate) definition_version: String,
    pub(crate) capabilities: CapabilityRuntime,
}

impl AnalyticsState {
    pub(crate) fn new(pool: PgPool, definition_version: String) -> Result<Self, String> {
        Ok(Self {
            capabilities: CapabilityRuntime::new(pool.clone(), "analytics_api")?,
            pool,
            definition_version,
        })
    }
}
