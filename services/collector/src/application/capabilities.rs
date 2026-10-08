pub use configuration_runtime::{CapabilityId, CapabilityRuntime, CapabilitySnapshot};

#[derive(Clone, Debug)]
pub enum CapabilityState {
    Unconfigured,
    Unavailable,
    Available(CapabilitySnapshot),
}

impl CapabilityState {
    pub fn snapshot(&self) -> Option<&CapabilitySnapshot> {
        match self {
            Self::Available(snapshot) => Some(snapshot),
            Self::Unconfigured | Self::Unavailable => None,
        }
    }
}
