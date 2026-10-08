use async_trait::async_trait;
use serde_json::Value;
use sqlx::PgPool;

use crate::application::runtime_policy_repository::{
    RuntimePolicyRepository, RuntimePolicyRepositoryError, StoredPolicyRow,
};

#[derive(Clone)]
pub struct PostgresRuntimePolicyRepository {
    pool: PgPool,
}

impl PostgresRuntimePolicyRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RuntimePolicyRepository for PostgresRuntimePolicyRepository {
    async fn active_policies(&self) -> Result<Vec<StoredPolicyRow>, RuntimePolicyRepositoryError> {
        let rows = sqlx::query_as::<_, (String, String, i64, Value)>(
            "SELECT policy.site_id, policy.environment, policy.version, policy.document
             FROM site_environment_policies AS policy
             JOIN site_registry AS site USING (site_id)
             WHERE site.lifecycle_status = 'active'
             ORDER BY policy.site_id, policy.environment",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(
                |(site_id, environment, version, document)| StoredPolicyRow {
                    site_id,
                    environment,
                    version,
                    document,
                },
            )
            .collect())
    }

    async fn record_applied_policy(
        &self,
        instance: &str,
        site: &str,
        environment: &str,
        version: Option<i64>,
        status: &str,
    ) -> Result<(), RuntimePolicyRepositoryError> {
        sqlx::query("INSERT INTO configuration_runtime_state (instance_id, service, site_id, environment, applied_version, refresh_status, last_seen_at) VALUES ($1, 'collector', $2, $3, $4, $5, NOW()) ON CONFLICT (instance_id, site_id, environment) DO UPDATE SET applied_version = EXCLUDED.applied_version, refresh_status = EXCLUDED.refresh_status, last_seen_at = NOW()")
            .bind(instance).bind(site).bind(environment).bind(version).bind(status).execute(&self.pool).await?;
        Ok(())
    }

    async fn delete_applied_policy(
        &self,
        instance: &str,
        site: &str,
        environment: &str,
    ) -> Result<(), RuntimePolicyRepositoryError> {
        sqlx::query("DELETE FROM configuration_runtime_state WHERE instance_id = $1 AND service = 'collector' AND site_id = $2 AND environment = $3")
            .bind(instance).bind(site).bind(environment).execute(&self.pool).await?;
        Ok(())
    }

    async fn heartbeat(
        &self,
        instance: &str,
        status: &str,
    ) -> Result<(), RuntimePolicyRepositoryError> {
        sqlx::query("INSERT INTO configuration_runtime_instances (instance_id, service, refresh_status, last_seen_at) VALUES ($1, 'collector', $2, NOW()) ON CONFLICT (instance_id) DO UPDATE SET refresh_status = EXCLUDED.refresh_status, last_seen_at = NOW()")
            .bind(instance).bind(status).execute(&self.pool).await?;
        Ok(())
    }

    async fn prune_expired(&self, retention: &str) -> Result<(), RuntimePolicyRepositoryError> {
        let state_result = sqlx::query(
            "DELETE FROM configuration_runtime_state WHERE last_seen_at < NOW() - $1::INTERVAL",
        )
        .bind(retention)
        .execute(&self.pool)
        .await;
        let instance_result = sqlx::query(
            "DELETE FROM configuration_runtime_instances WHERE last_seen_at < NOW() - $1::INTERVAL",
        )
        .bind(retention)
        .execute(&self.pool)
        .await;
        state_result?;
        instance_result?;
        Ok(())
    }
}
