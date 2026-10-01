use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

#[derive(Debug)]
pub(crate) enum ConfigurationApiError {
    Unauthorized,
    NotFound,
    Conflict,
    SiteVersionConflict,
    PreconditionRequired,
    Validation(Vec<ConfigurationValidationDetail>),
    Unavailable,
}

#[derive(Debug, Serialize)]
pub(crate) struct ConfigurationValidationDetail {
    pub(crate) path: String,
    pub(crate) code: &'static str,
    pub(crate) message: &'static str,
}

#[derive(Serialize)]
struct ConfigurationErrorResponse {
    error: ConfigurationErrorBody,
}

#[derive(Serialize)]
struct ConfigurationErrorBody {
    code: &'static str,
    message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Vec<ConfigurationValidationDetail>>,
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

    fn response(self) -> (StatusCode, ConfigurationErrorResponse) {
        let (status, code, message, details) = match self {
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Missing or invalid configuration administrator credential.",
                None,
            ),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "not_found",
                "Configuration resource was not found.",
                None,
            ),
            Self::Conflict => (
                StatusCode::CONFLICT,
                "configuration_version_conflict",
                "Configuration changed or already exists.",
                None,
            ),
            Self::SiteVersionConflict => (
                StatusCode::CONFLICT,
                "site_version_conflict",
                "Site version is stale; no mutation was applied.",
                None,
            ),
            Self::PreconditionRequired => (
                StatusCode::PRECONDITION_REQUIRED,
                "configuration_precondition_required",
                "A valid configuration precondition is required.",
                None,
            ),
            Self::Validation(details) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "configuration_validation_failed",
                "Configuration failed validation.",
                Some(details),
            ),
            Self::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "configuration_unavailable",
                "Configuration persistence is unavailable.",
                None,
            ),
        };
        (
            status,
            ConfigurationErrorResponse {
                error: ConfigurationErrorBody {
                    code,
                    message,
                    details,
                },
            },
        )
    }
}

impl From<axum::extract::rejection::JsonRejection> for ConfigurationApiError {
    fn from(_: axum::extract::rejection::JsonRejection) -> Self {
        Self::validation("", "invalid_body", "Request body must be valid JSON.")
    }
}

impl IntoResponse for ConfigurationApiError {
    fn into_response(self) -> Response {
        let (status, body) = self.response();
        (status, Json(body)).into_response()
    }
}
