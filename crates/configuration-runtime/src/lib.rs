mod capability_snapshot;
mod registry;
mod runtime;
#[cfg(test)]
mod test_support;
mod views;

pub use capability_snapshot::{CapabilitySchemaValidator, CapabilitySnapshot};
pub use registry::{
    CapabilityId, CapabilityRegistry, CapabilityRegistryError, CapabilityStatus, RuntimeCapability,
};
pub use runtime::CapabilityRuntime;
pub use views::{
    DefinitionRevisionView, EnvironmentPolicyView, IngestKeyView, is_valid_definition_version,
};

use std::time::Duration;

pub const REFRESH_INTERVAL: Duration = Duration::from_secs(5);
