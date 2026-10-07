mod application;
mod domain;
mod storage;

pub use application::Processor;
pub use application::ProcessorError;
pub use configuration_runtime::{CapabilityRuntime, CapabilitySnapshot};
pub use domain::capabilities::{
    CapabilityContract, CapabilityId, CapabilityRegistry, CapabilityStatus,
};
pub use domain::definitions;
pub use domain::normalizer::{NormalizedContext, normalize_context};
pub use domain::parser::{ParsedUserAgent, UserAgentParser, WOOTHEE_VERSION, WootheeParser};
pub use domain::sessionizer::{
    SessionEventOutput, SessionInput, SessionOutput, deterministic_session_id, sessionize,
};
