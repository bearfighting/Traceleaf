use configuration_runtime::CapabilityRuntime;
use sqlx::PgPool;

#[derive(Clone)]
pub(crate) struct AnalyticsState {
    pub(crate) pool: PgPool,
    pub(crate) definition_version: String,
    pub(crate) capabilities: CapabilityRuntime,
}

impl AnalyticsState {
    pub(crate) fn new(pool: PgPool, definition_version: String) -> Self {
        Self {
            capabilities: CapabilityRuntime::new(pool.clone(), "analytics_api")
                .expect("embedded capability schema must compile"),
            pool,
            definition_version,
        }
    }
}
