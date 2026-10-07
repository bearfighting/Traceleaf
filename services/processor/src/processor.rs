use sqlx::{PgPool, postgres::PgPoolOptions};

use crate::ProcessorError;

#[derive(Clone)]
pub struct Processor {
    pub(super) pool: PgPool,
    pub(super) definitions: crate::definitions::AnalyticsDefinitions,
    pub(super) database_definitions: bool,
    pub(super) capabilities: crate::CapabilityRuntime,
}

impl Processor {
    pub async fn connect(database_url: &str) -> Result<Self, ProcessorError> {
        let mut processor = Self::connect_with_definitions(
            database_url,
            crate::definitions::AnalyticsDefinitions {
                version: "1".to_owned(),
                sites: Vec::new(),
            },
        )
        .await?;
        processor.database_definitions = true;
        Ok(processor)
    }

    pub async fn connect_with_definitions(
        database_url: &str,
        definitions: crate::definitions::AnalyticsDefinitions,
    ) -> Result<Self, ProcessorError> {
        definitions
            .validate()
            .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        let capabilities =
            crate::CapabilityRuntime::new(pool.clone(), "processor").map_err(|_| {
                ProcessorError::CapabilityConfigurationUnavailable("runtime".to_owned())
            })?;
        capabilities.spawn();
        Ok(Self {
            pool,
            definitions,
            database_definitions: false,
            capabilities,
        })
    }

    pub(super) async fn current_capabilities(
        &self,
        site_id: &str,
    ) -> Result<crate::CapabilitySnapshot, ProcessorError> {
        if let Some(snapshot) = self.capabilities.snapshot(site_id) {
            return Ok(snapshot);
        }
        let _ = self.capabilities.refresh_once().await;
        self.capabilities
            .snapshot(site_id)
            .ok_or_else(|| ProcessorError::CapabilityConfigurationUnavailable(site_id.to_owned()))
    }
}
