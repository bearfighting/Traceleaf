//! Processor connection lifecycle and application workflows.

pub(crate) mod definition_revisions;
pub(crate) mod error;
pub(crate) mod event_facts;
pub(crate) mod event_processing;
pub(crate) mod explicit_rebuilds;
pub(crate) mod generation_rebuild;
mod processor;

pub use error::ProcessorError;
pub use processor::Processor;
