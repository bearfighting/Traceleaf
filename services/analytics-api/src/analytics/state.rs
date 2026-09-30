use configuration_runtime::{CapabilityRegistry, CapabilityRuntime};
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub(crate) struct AnalyticsState {
    pub(crate) pool: PgPool,
    pub(crate) definition_version: String,
    pub(crate) capabilities: CapabilityRuntime,
}

impl AnalyticsState {
    pub(crate) fn new(
        pool: PgPool,
        definition_version: String,
        registry: Arc<CapabilityRegistry>,
    ) -> Result<Self, String> {
        Ok(Self {
            capabilities: CapabilityRuntime::with_registry(
                pool.clone(),
                "analytics_api",
                registry,
            )?,
            pool,
            definition_version,
        })
    }
}
