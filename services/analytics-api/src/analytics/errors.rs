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
