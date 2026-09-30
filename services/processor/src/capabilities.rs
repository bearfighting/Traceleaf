use serde::Deserialize;

pub use configuration_runtime::{CapabilityId, CapabilityRegistry, CapabilityStatus};

/// Compatibility representation for callers that need manifest descriptions.
/// Runtime decisions use the shared, minimal CapabilityRegistry.
#[derive(Debug, Clone, Deserialize)]
pub struct CapabilityContract {
    pub id: CapabilityId,
    pub status: CapabilityStatus,
    pub depends_on: Vec<CapabilityId>,
    pub input: serde_json::Value,
    pub raw_event: serde_json::Value,
    pub processor: serde_json::Value,
    pub api: serde_json::Value,
    pub dashboard: serde_json::Value,
    pub security: serde_json::Value,
    pub history: serde_json::Value,
}
