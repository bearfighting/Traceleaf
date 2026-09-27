use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

const INTERNAL_ERROR_MESSAGE: &str = "Analytics API failed to complete the request";

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: &'static str,
}

#[derive(Debug)]
pub(crate) enum RequestError {
    InvalidDateRange(&'static str),
    DateRangeTooLarge,
    InvalidLimit,
    InvalidDimension,
    InvalidEventName,
    InvalidDefinitionVersion,
}

impl IntoResponse for RequestError {
    fn into_response(self) -> Response {
        let (code, message) = match self {
            Self::InvalidDateRange(message) => ("invalid_date_range", message),
            Self::DateRangeTooLarge => (
                "date_range_too_large",
                "date range must not exceed 366 days",
            ),
            Self::InvalidLimit => ("invalid_limit", "limit must be between 1 and 100"),
            Self::InvalidDimension => ("invalid_dimension", "dimension is not supported"),
            Self::InvalidEventName => (
                "invalid_event_name",
                "event_name must match the custom event name format",
            ),
            Self::InvalidDefinitionVersion => (
                "invalid_definition_version",
                "definition_version must identify a stored site revision",
            ),
        };
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorBody { code, message },
            }),
        )
            .into_response()
    }
}

#[derive(Debug)]
pub(crate) struct ApiError;

impl ApiError {
    pub(crate) fn database(error: sqlx::Error) -> Self {
        tracing::error!(%error, "analytics database query failed");
        Self
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorBody {
                    code: "analytics_api_error",
                    message: INTERNAL_ERROR_MESSAGE,
                },
            }),
        )
            .into_response()
    }
}

#[derive(Debug)]
pub(crate) struct AnalyticsNotEnabled;

impl IntoResponse for AnalyticsNotEnabled {
    fn into_response(self) -> Response {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorBody {
                    code: "analytics_not_enabled",
                    message: "analytics report is not enabled",
                },
            }),
        )
            .into_response()
    }
}

#[derive(Debug)]
pub(crate) struct HealthError;

impl HealthError {
    pub(crate) fn database(error: sqlx::Error) -> Self {
        tracing::error!(%error, "analytics health database check failed");
        Self
    }
}

impl IntoResponse for HealthError {
    fn into_response(self) -> Response {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: ErrorBody {
                    code: "analytics_api_error",
                    message: INTERNAL_ERROR_MESSAGE,
                },
            }),
        )
            .into_response()
    }
}

#[derive(Debug)]
pub(crate) enum HandlerError {
    Request(RequestError),
    Api(ApiError),
    AnalyticsNotEnabled,
}

impl From<RequestError> for HandlerError {
    fn from(error: RequestError) -> Self {
        Self::Request(error)
    }
}

impl From<AnalyticsNotEnabled> for HandlerError {
    fn from(_: AnalyticsNotEnabled) -> Self {
        Self::AnalyticsNotEnabled
    }
}

impl From<ApiError> for HandlerError {
    fn from(error: ApiError) -> Self {
        Self::Api(error)
    }
}

impl IntoResponse for HandlerError {
    fn into_response(self) -> Response {
        match self {
            Self::Request(error) => error.into_response(),
            Self::Api(error) => error.into_response(),
            Self::AnalyticsNotEnabled => AnalyticsNotEnabled.into_response(),
        }
    }
}

#[derive(Debug)]
pub(crate) enum ConfigurationApiError {
    Unauthorized,
    NotFound,
    Conflict,
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
