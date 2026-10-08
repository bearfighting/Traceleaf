use axum::{
    Json,
    extract::{Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header::ETAG},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use serde_json::{Value, json};

use super::{
    AdminAuth,
    errors::{ConfigurationApiError, ConfigurationValidationDetail},
    state::SiteManagementState,
};

#[derive(Deserialize)]
pub(crate) struct Page {
    limit: Option<String>,
    cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MetadataPatch {
    display_name: Option<String>,
    website_url: Option<String>,
}

fn response(status: StatusCode, body: Value, version: Option<i64>) -> Response {
    let mut out = (status, Json(body)).into_response();
    if let Some(version) = version {
        out.headers_mut().insert(
            ETAG,
            HeaderValue::from_str(&format!("\"{version}\"")).unwrap(),
        );
    }
    out
}

pub(crate) async fn list_sites(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Query(page): Query<Page>,
) -> Result<Response, ConfigurationApiError> {
    let limit = match page.limit {
        None => 50,
        Some(value) => value
            .parse::<i64>()
            .ok()
            .filter(|n| (1..=100).contains(n))
            .ok_or_else(|| validation("/limit"))?,
    };
    let after = match page.cursor {
        None => None,
        Some(value) => {
            let decoded = URL_SAFE_NO_PAD
                .decode(&value)
                .ok()
                .filter(|bytes| URL_SAFE_NO_PAD.encode(bytes) == value);
            let text = decoded
                .and_then(|bytes| String::from_utf8(bytes).ok())
                .filter(|text| !text.is_empty());
            Some(text.ok_or_else(|| validation("/cursor"))?)
        }
    };
    let rows = state
        .use_cases
        .list_sites(after, limit + 1)
        .await
        .map_err(map_application_error)?;
    let has_more = rows.len() > limit as usize;
    let items = rows.into_iter().take(limit as usize).collect::<Vec<_>>();
    let next_cursor = if has_more {
        items
            .last()
            .map(|s| URL_SAFE_NO_PAD.encode(s.site_id.as_bytes()))
    } else {
        None
    };
    Ok(response(
        StatusCode::OK,
        json!({"items":items,"next_cursor":next_cursor}),
        None,
    ))
}

pub(crate) async fn get_site(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
) -> Result<Response, ConfigurationApiError> {
    let value = state
        .use_cases
        .get_site(&site_id)
        .await
        .map_err(map_application_error)?
        .ok_or(ConfigurationApiError::NotFound)?;
    Ok(response(
        StatusCode::OK,
        json!({"site":value}),
        Some(value.version),
    ))
}

pub(crate) async fn patch_site(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
    body: Result<Json<MetadataPatch>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    let expected = parse_if_match(&headers)?;
    let Json(patch) = body.map_err(|_| validation(""))?;
    let updated = state
        .use_cases
        .patch_metadata(&site_id, expected, patch.display_name, patch.website_url)
        .await
        .map_err(map_application_error)?;
    Ok(response(
        StatusCode::OK,
        json!({"site":updated}),
        Some(updated.version),
    ))
}

pub(crate) async fn archive_site(
    auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    lifecycle(auth, state, site_id, headers, "archived").await
}
pub(crate) async fn restore_site(
    auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    lifecycle(auth, state, site_id, headers, "active").await
}

async fn lifecycle(
    _auth: AdminAuth,
    state: SiteManagementState,
    site_id: String,
    headers: HeaderMap,
    target: &str,
) -> Result<Response, ConfigurationApiError> {
    let expected = parse_if_match(&headers)?;
    let updated = state
        .use_cases
        .update_lifecycle(&site_id, expected, target)
        .await
        .map_err(map_application_error)?;
    Ok(response(
        StatusCode::OK,
        json!({"site":updated}),
        Some(updated.version),
    ))
}

fn map_application_error(
    error: crate::application::site_management::SiteManagementError,
) -> ConfigurationApiError {
    use crate::application::site_management::SiteManagementError;
    match error {
        SiteManagementError::Unavailable => ConfigurationApiError::Unavailable,
        SiteManagementError::NotFound => ConfigurationApiError::NotFound,
        SiteManagementError::VersionConflict => ConfigurationApiError::SiteVersionConflict,
        SiteManagementError::InvalidMetadata(path) => validation(path),
        SiteManagementError::Validation {
            path,
            code,
            message,
        } => ConfigurationApiError::validation(path, code, message),
        SiteManagementError::IdempotencyConflict => ConfigurationApiError::SiteIdempotencyConflict,
    }
}

fn parse_if_match(headers: &HeaderMap) -> Result<i64, ConfigurationApiError> {
    let version_text = headers
        .get("if-match")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix('"')?.strip_suffix('"'))
        .filter(|value| {
            !value.is_empty()
                && !value.starts_with('0')
                && value.bytes().all(|byte| byte.is_ascii_digit())
        })
        .ok_or(ConfigurationApiError::PreconditionRequired)?;
    let value = version_text
        .parse::<i64>()
        .ok()
        .filter(|version| *version > 0)
        .ok_or(ConfigurationApiError::PreconditionRequired)?;
    Ok(value)
}

fn validation(path: &str) -> ConfigurationApiError {
    ConfigurationApiError::Validation(vec![ConfigurationValidationDetail {
        path: path.to_owned(),
        code: "invalid_value",
        message: "Value does not satisfy the Site Management contract.",
    }])
}
