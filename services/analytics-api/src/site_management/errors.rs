#[derive(Debug)]
pub(crate) enum ConfigurationApiError {
    Unauthorized,
    NotFound,
    Conflict,
    SiteVersionConflict,
    SiteIdempotencyConflict,
    PreconditionRequired,
    Validation(Vec<ConfigurationValidationDetail>),
    Unavailable,
}

#[derive(Debug, serde::Serialize)]
pub(crate) struct ConfigurationValidationDetail {
    pub(crate) path: String,
    pub(crate) code: &'static str,
    pub(crate) message: &'static str,
}

impl ConfigurationApiError {
    pub(crate) fn validation(
        path: impl Into<String>,
        code: &'static str,
        message: &'static str,
    ) -> Self {
        Self::Validation(vec![ConfigurationValidationDetail {
            path: path.into(),
            code,
            message,
        }])
    }
}
