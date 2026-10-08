use crate::application::analytics_queries::AnalyticsReadUseCases;
use configuration_runtime::CapabilityRuntime;
use std::sync::Arc;

#[derive(Clone)]
pub(crate) struct AnalyticsState {
    pub(crate) capabilities: CapabilityRuntime,
    pub(crate) reads: std::sync::Arc<dyn AnalyticsReadUseCases>,
}

impl AnalyticsState {
    pub(crate) fn new(
        capabilities: CapabilityRuntime,
        reads: Arc<dyn AnalyticsReadUseCases>,
    ) -> Self {
        Self {
            capabilities,
            reads,
        }
    }
}
