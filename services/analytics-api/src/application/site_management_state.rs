use configuration_runtime::CapabilityRegistry;
use std::sync::Arc;

use crate::{
    application::site_management::{SiteManagementRepository, SiteManagementService},
    site_management::auth::AdminTokens,
};

#[derive(Clone)]
pub(crate) struct SiteManagementState {
    pub(crate) admin_tokens: Option<AdminTokens>,
    pub(crate) use_cases: Arc<SiteManagementService>,
}

impl SiteManagementState {
    pub(crate) fn new(
        repository: Arc<dyn SiteManagementRepository>,
        capabilities: Arc<CapabilityRegistry>,
    ) -> Result<Self, String> {
        Ok(Self {
            admin_tokens: None,
            use_cases: Arc::new(SiteManagementService::new(
                repository,
                capabilities,
                crate::application::site_management_validation::ConfigurationValidators::new()?,
            )),
        })
    }
}
