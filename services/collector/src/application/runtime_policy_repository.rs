use async_trait::async_trait;
use serde_json::Value;
use std::error::Error;

#[derive(Debug, Clone)]
pub struct StoredPolicyRow {
    pub site_id: String,
    pub environment: String,
    pub version: i64,
    pub document: Value,
}

pub type RuntimePolicyRepositoryError = Box<dyn Error + Send + Sync>;

#[async_trait]
pub trait RuntimePolicyRepository: Send + Sync {
    async fn active_policies(&self) -> Result<Vec<StoredPolicyRow>, RuntimePolicyRepositoryError>;
    async fn record_applied_policy(
        &self,
        instance: &str,
        site: &str,
        environment: &str,
        version: Option<i64>,
        status: &str,
    ) -> Result<(), RuntimePolicyRepositoryError>;
    async fn delete_applied_policy(
        &self,
        instance: &str,
        site: &str,
        environment: &str,
    ) -> Result<(), RuntimePolicyRepositoryError>;
    async fn heartbeat(
        &self,
        instance: &str,
        status: &str,
    ) -> Result<(), RuntimePolicyRepositoryError>;
    async fn prune_expired(&self, retention: &str) -> Result<(), RuntimePolicyRepositoryError>;
}
