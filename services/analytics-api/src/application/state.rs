use crate::{
    analytics::state::AnalyticsState, application::site_management_state::SiteManagementState,
    site_management::auth::AdminTokens,
};
use std::sync::Arc;

#[async_trait::async_trait]
pub(crate) trait HealthCheck: Send + Sync {
    async fn check(&self) -> Result<(), ()>;
}

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) analytics: AnalyticsState,
    pub(crate) site_management: SiteManagementState,
    pub(crate) health_check: Arc<dyn HealthCheck>,
}

impl AppState {
    pub(crate) fn new(
        analytics: AnalyticsState,
        site_management: SiteManagementState,
        health_check: Arc<dyn HealthCheck>,
    ) -> Self {
        Self {
            analytics,
            site_management,
            health_check,
        }
    }

    pub(crate) fn with_admin_tokens(mut self, admin_tokens: Option<AdminTokens>) -> Self {
        self.site_management.admin_tokens = admin_tokens;
        self
    }
}
