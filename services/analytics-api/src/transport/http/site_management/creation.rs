use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, ETAG},
    },
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

use super::AdminAuth;
use crate::{
    application::{
        site_management::{SiteCreationResult, SiteManagementError},
        site_management_state::SiteManagementState,
    },
    site_management::errors::{ConfigurationApiError, ConfigurationValidationDetail},
};

fn validation(
    path: impl Into<String>,
    code: &'static str,
    message: &'static str,
) -> ConfigurationApiError {
    ConfigurationApiError::Validation(vec![ConfigurationValidationDetail {
        path: path.into(),
        code,
        message,
    }])
}

fn idempotency_key(headers: &HeaderMap) -> Result<&str, ConfigurationApiError> {
    match headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
    {
        Some(value)
            if (1..=128).contains(&value.len())
                && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) =>
        {
            Ok(value)
        }
        _ => Err(validation(
            "/headers/Idempotency-Key",
            "invalid_idempotency_key",
            "Idempotency-Key must contain 1 to 128 visible ASCII characters.",
        )),
    }
}

fn response(status: StatusCode, version: i64, body: Value, no_store: bool) -> Response {
    let mut response = (status, Json(body)).into_response();
    response.headers_mut().insert(
        ETAG,
        HeaderValue::from_str(&format!("\"{version}\""))
            .expect("positive Site versions form valid ETags"),
    );
    if no_store {
        response
            .headers_mut()
            .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

pub(crate) async fn create_site(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    headers: HeaderMap,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    let key = idempotency_key(&headers)?.to_owned();
    let Json(request) = body.map_err(ConfigurationApiError::from)?;
    match state
        .use_cases
        .create_site(key, request)
        .await
        .map_err(map_application_error)?
    {
        SiteCreationResult::Created {
            site,
            environment,
            key,
            key_id,
        } => Ok(response(
            StatusCode::CREATED,
            1,
            json!({
                "site": site, "initial_environment": environment, "ingest_key": {"key": key, "key_id": key_id}
            }),
            true,
        )),
        SiteCreationResult::Existing(site) => {
            let version = site.version;
            Ok(response(
                StatusCode::OK,
                version,
                json!({"site": site}),
                false,
            ))
        }
    }
}

fn map_application_error(error: SiteManagementError) -> ConfigurationApiError {
    match error {
        SiteManagementError::Unavailable => ConfigurationApiError::Unavailable,
        SiteManagementError::NotFound => ConfigurationApiError::NotFound,
        SiteManagementError::VersionConflict => ConfigurationApiError::SiteVersionConflict,
        SiteManagementError::InvalidMetadata(path) => ConfigurationApiError::validation(
            path,
            "invalid_value",
            "Value does not satisfy the Site Management contract.",
        ),
        SiteManagementError::Validation {
            path,
            code,
            message,
        } => ConfigurationApiError::validation(path, code, message),
        SiteManagementError::IdempotencyConflict => ConfigurationApiError::SiteIdempotencyConflict,
    }
}

#[cfg(test)]
mod tests {
    use super::idempotency_key;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn idempotency_key_requires_visible_ascii_within_contract_length() {
        let mut headers = HeaderMap::new();
        assert!(idempotency_key(&headers).is_err());
        headers.insert("idempotency-key", HeaderValue::from_static(" "));
        assert!(idempotency_key(&headers).is_err());
        headers.insert("idempotency-key", HeaderValue::from_static("valid-1"));
        assert_eq!(idempotency_key(&headers).unwrap(), "valid-1");
    }
}
