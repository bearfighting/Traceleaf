//! Errors returned by analytics application use cases.

#[derive(Debug)]
pub(crate) enum AnalyticsApplicationError {
    Storage(String),
}

/// Validation failures produced by application-level request parsing.
#[derive(Debug)]
pub(crate) enum RequestError {
    InvalidDateRange(&'static str),
    DateRangeTooLarge,
    InvalidLimit,
    InvalidDimension,
    InvalidEventName,
    InvalidDefinitionVersion,
}

impl std::fmt::Display for AnalyticsApplicationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Storage(message) => write!(formatter, "storage operation failed: {message}"),
        }
    }
}
