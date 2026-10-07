use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProcessorError {
    #[error("processor database operation failed: {0}")]
    Database(#[from] sqlx::Error),
    #[error("capability configuration unavailable for site {0}")]
    CapabilityConfigurationUnavailable(String),
    #[error("capability is disabled for site {0}")]
    CapabilityDisabled(String),
    #[error("analytics definitions are invalid: {0}")]
    InvalidDefinitions(String),
    #[error("raw event {0} has an invalid custom event payload")]
    InvalidCustomEvent(String),
    #[error("processed raw event {0} was not updated")]
    RawEventNotUpdated(i64),
    #[error("no active generation exists for site {site_id}")]
    NoActiveGeneration { site_id: String },
    #[error("generation {generation_id} does not exist for site {site_id}")]
    GenerationNotFound {
        site_id: String,
        generation_id: String,
    },
    #[error("generation {generation_id} cannot be rollback target because it is {status}")]
    InvalidRollbackTarget {
        generation_id: String,
        status: String,
    },
    #[error("analytics is disabled for site {site_id}")]
    AnalyticsDisabled { site_id: String },
    #[error("unsupported parser version {0}")]
    UnsupportedParserVersion(String),
    #[error("rebuild scope starts after it ends")]
    InvalidRebuildScope,
    #[error("rebuild queue {0} was already completed or failed")]
    RebuildQueueAlreadyHandled(i64),
    #[error("rebuild queue {0} is paused because analytics is disabled")]
    RebuildQueuePaused(i64),
}
