pub(crate) mod analytics_queries;
pub(crate) mod definition_catalog;
mod query_rows;
pub(crate) mod report_freshness;
pub(crate) mod report_transactions;
pub(crate) mod site_configuration;
pub(crate) mod site_creation;
mod site_management_adapter;
pub(crate) use site_management_adapter::PostgresSiteManagementAdapter;

use sqlx::PgPool;

pub(crate) struct PostgresHealthCheck(pub(crate) PgPool);

#[async_trait::async_trait]
impl crate::application::state::HealthCheck for PostgresHealthCheck {
    async fn check(&self) -> Result<(), ()> {
        health_check(&self.0).await.map_err(|error| {
            tracing::error!(%error, "analytics health database check failed");
        })
    }
}

/// Checks that PostgreSQL is reachable by the application.
pub(crate) async fn health_check(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT 1").execute(pool).await.map(|_| ())
}
mod analytics_read_adapter;
pub(crate) use analytics_read_adapter::AnalyticsReadAdapter;
