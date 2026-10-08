use sqlx::PgPool;

use crate::{
    application::site,
    application::site_management::{
        AppliedState, ConfigurationDocument, ConfigurationStoreError, RepositorySiteCreationResult,
        SiteCreation, SiteManagementError, SiteManagementRepository,
    },
};

pub(crate) struct PostgresSiteManagementAdapter {
    pool: PgPool,
}

impl PostgresSiteManagementAdapter {
    pub(crate) fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl SiteManagementRepository for PostgresSiteManagementAdapter {
    async fn list_sites(
        &self,
        after: Option<String>,
        limit: i64,
    ) -> Result<Vec<site::Site>, SiteManagementError> {
        crate::storage::postgres::site_creation::list_site_rows(&self.pool, after, limit)
            .await
            .map(|rows| rows.into_iter().map(site::from_database_row).collect())
            .map_err(|error| {
                tracing::error!(%error, "site listing failed");
                SiteManagementError::Unavailable
            })
    }

    async fn get_site(&self, site_id: &str) -> Result<Option<site::Site>, SiteManagementError> {
        crate::storage::postgres::site_creation::read_managed_site(&self.pool, site_id)
            .await
            .map_err(|error| {
                tracing::error!(%error, "site lookup failed");
                SiteManagementError::Unavailable
            })
    }

    async fn update_metadata(
        &self,
        site_id: &str,
        expected_version: i64,
        display_name: Option<String>,
        website_url: Option<String>,
        changed_fields: Vec<String>,
    ) -> Result<site::Site, SiteManagementError> {
        let changed_fields = changed_fields
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        crate::storage::postgres::site_creation::update_site_metadata(
            &self.pool,
            site_id,
            expected_version,
            display_name,
            website_url,
            &changed_fields,
        )
        .await
        .map_err(map_site_mutation_error)
    }

    async fn update_lifecycle(
        &self,
        site_id: &str,
        expected_version: i64,
        target_status: &str,
    ) -> Result<site::Site, SiteManagementError> {
        crate::storage::postgres::site_creation::update_site_lifecycle(
            &self.pool,
            site_id,
            expected_version,
            target_status,
        )
        .await
        .map_err(map_site_mutation_error)
    }

    async fn create_site(
        &self,
        request: SiteCreation,
    ) -> Result<RepositorySiteCreationResult, SiteManagementError> {
        use crate::storage::postgres::site_creation::{
            CreateSiteOutcome, CreateSiteRecords, CreateSiteStoreError,
        };
        let result = crate::storage::postgres::site_creation::create_site(
            &self.pool,
            CreateSiteRecords {
                site_id: &request.site_id,
                display_name: &request.display_name,
                website_url: &request.website_url,
                environment: &request.environment,
                idempotency_key: &request.idempotency_key,
                request_digest: &request.request_digest,
                key_id: &request.key_id,
                key_digest: &request.key_digest,
                capabilities: &request.capabilities,
                allowed_origins: &request.allowed_origins,
            },
        )
        .await
        .map_err(|error| match error {
            CreateSiteStoreError::Database(error) => {
                tracing::error!(%error, "site creation failed");
                SiteManagementError::Unavailable
            }
        })?;
        Ok(match result {
            CreateSiteOutcome::Created { site } => RepositorySiteCreationResult::Created(site),
            CreateSiteOutcome::Existing {
                site_id,
                request_digest,
            } => RepositorySiteCreationResult::Existing {
                site_id,
                request_digest,
            },
        })
    }

    async fn get_capabilities(
        &self,
        site_id: &str,
    ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::get_capabilities(&self.pool, site_id)
            .await
            .map(|row| row.map(map_document))
            .map_err(map_configuration_error)
    }
    async fn create_capabilities(
        &self,
        site_id: &str,
        capabilities: serde_json::Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::create_capabilities(
            &self.pool,
            site_id,
            capabilities,
        )
        .await
        .map(map_document)
        .map_err(map_configuration_error)
    }
    async fn update_capabilities(
        &self,
        site_id: &str,
        version: i64,
        capabilities: serde_json::Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::update_capabilities(
            &self.pool,
            site_id,
            version,
            capabilities,
        )
        .await
        .map(map_document)
        .map_err(map_configuration_error)
    }
    async fn get_ingest_policy(
        &self,
        site_id: &str,
        environment: &str,
    ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::get_ingest_policy(
            &self.pool,
            site_id,
            environment,
        )
        .await
        .map(|row| row.map(map_document))
        .map_err(map_configuration_error)
    }
    async fn create_ingest_policy(
        &self,
        site_id: &str,
        environment: &str,
        enabled: bool,
        origins: serde_json::Value,
        rate_limit: i64,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::create_ingest_policy(
            &self.pool,
            site_id,
            environment,
            enabled,
            origins,
            rate_limit,
        )
        .await
        .map(map_document)
        .map_err(map_configuration_error)
    }
    async fn update_ingest_policy(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
        enabled: bool,
        origins: serde_json::Value,
        rate_limit: i64,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::update_ingest_policy(
            &self.pool,
            site_id,
            environment,
            version,
            enabled,
            origins,
            rate_limit,
        )
        .await
        .map(map_document)
        .map_err(map_configuration_error)
    }
    async fn create_ingest_key(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
        key_id: &str,
        digest: &str,
        created_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::create_ingest_key(
            &self.pool,
            site_id,
            environment,
            version,
            key_id,
            digest,
            created_at,
        )
        .await
        .map(map_document)
        .map_err(map_configuration_error)
    }
    async fn revoke_ingest_key(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
        key_id: &str,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::revoke_ingest_key(
            &self.pool,
            site_id,
            environment,
            version,
            key_id,
        )
        .await
        .map(map_document)
        .map_err(map_configuration_error)
    }
    async fn get_definition_set(
        &self,
        site_id: &str,
    ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::get_current_definition_set(
            &self.pool, site_id,
        )
        .await
        .map(|row| row.map(map_document))
        .map_err(map_configuration_error)
    }
    async fn create_definition_set(
        &self,
        site_id: &str,
        definitions: serde_json::Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::create_definition_set(
            &self.pool,
            site_id,
            None,
            definitions,
            None,
        )
        .await
        .map(map_document)
        .map_err(map_configuration_error)
    }
    async fn update_definition_set(
        &self,
        site_id: &str,
        version: i64,
        definitions: serde_json::Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::update_definition_set(
            &self.pool,
            site_id,
            version,
            definitions,
        )
        .await
        .map(map_document)
        .map_err(map_configuration_error)
    }
    async fn collector_applied_state(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
    ) -> Result<AppliedState, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::collector_applied_state(
            &self.pool,
            site_id,
            environment,
            version,
        )
        .await
        .map(|state| AppliedState {
            status: state.status,
            applied_version: state.applied_version,
        })
        .map_err(map_configuration_error)
    }
    async fn capability_applied_state(
        &self,
        service: &str,
        site_id: &str,
        version: i64,
    ) -> Result<AppliedState, ConfigurationStoreError> {
        crate::storage::postgres::site_configuration::capability_applied_state(
            &self.pool, service, site_id, version,
        )
        .await
        .map(|state| AppliedState {
            status: state.status,
            applied_version: state.applied_version,
        })
        .map_err(map_configuration_error)
    }
}

fn map_document(
    row: crate::storage::postgres::site_configuration::ConfigurationRow,
) -> ConfigurationDocument {
    ConfigurationDocument {
        version: row.version,
        document: row.document,
    }
}

fn map_configuration_error(
    error: crate::storage::postgres::site_configuration::StoreError,
) -> ConfigurationStoreError {
    use crate::storage::postgres::site_configuration::StoreError;
    match error {
        StoreError::NotFound => ConfigurationStoreError::NotFound,
        StoreError::Conflict => ConfigurationStoreError::Conflict,
        StoreError::AlreadyExists => ConfigurationStoreError::AlreadyExists,
        StoreError::DefinitionRemoval => ConfigurationStoreError::DefinitionRemoval,
        StoreError::OriginConflict => ConfigurationStoreError::OriginConflict,
        StoreError::Database(error) => {
            tracing::error!(%error, "site configuration storage failed");
            ConfigurationStoreError::Unavailable
        }
    }
}

fn map_site_mutation_error(
    error: crate::storage::postgres::site_creation::SiteMutationError,
) -> SiteManagementError {
    use crate::storage::postgres::site_creation::SiteMutationError;
    match error {
        SiteMutationError::NotFound => SiteManagementError::NotFound,
        SiteMutationError::VersionConflict => SiteManagementError::VersionConflict,
        SiteMutationError::Database(error) => {
            tracing::error!(%error, "site mutation failed");
            SiteManagementError::Unavailable
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{map_configuration_error, map_site_mutation_error};
    use crate::application::site_management::ConfigurationStoreError;
    use crate::storage::postgres::site_configuration::StoreError;
    use crate::storage::postgres::site_creation::SiteMutationError;

    #[test]
    fn configuration_storage_errors_map_to_application_errors() {
        assert!(matches!(
            map_configuration_error(StoreError::NotFound),
            ConfigurationStoreError::NotFound
        ));
        assert!(matches!(
            map_configuration_error(StoreError::Conflict),
            ConfigurationStoreError::Conflict
        ));
        assert!(matches!(
            map_configuration_error(StoreError::AlreadyExists),
            ConfigurationStoreError::AlreadyExists
        ));
        assert!(matches!(
            map_configuration_error(StoreError::DefinitionRemoval),
            ConfigurationStoreError::DefinitionRemoval
        ));
        assert!(matches!(
            map_configuration_error(StoreError::OriginConflict),
            ConfigurationStoreError::OriginConflict
        ));
        assert!(matches!(
            map_configuration_error(StoreError::Database(sqlx::Error::RowNotFound)),
            ConfigurationStoreError::Unavailable
        ));
    }

    #[test]
    fn site_mutation_errors_map_to_application_errors() {
        use crate::application::site_management::SiteManagementError;
        assert!(matches!(
            map_site_mutation_error(SiteMutationError::NotFound),
            SiteManagementError::NotFound
        ));
        assert!(matches!(
            map_site_mutation_error(SiteMutationError::VersionConflict),
            SiteManagementError::VersionConflict
        ));
        assert!(matches!(
            map_site_mutation_error(SiteMutationError::Database(sqlx::Error::RowNotFound)),
            SiteManagementError::Unavailable
        ));
    }
}
