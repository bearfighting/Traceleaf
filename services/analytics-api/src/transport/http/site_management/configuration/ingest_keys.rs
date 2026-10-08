use super::*;
use chrono::SecondsFormat;

pub(crate) async fn create_ingest_key(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    state
        .use_cases
        .validate_identity(&site_id, Some(&environment))
        .map_err(map_store_error)?;
    let version = parse_if_match(&headers)?;
    let issued = state
        .use_cases
        .issue_ingest_key(&site_id, &environment, version)
        .await
        .map_err(map_store_error)?;
    let row = issued.document;
    let metadata = json!({
        "key_id": issued.key_id,
        "created_at": issued.created_at.to_rfc3339_opts(SecondsFormat::Micros, true),
    });
    let body = json!({
        "key": issued.key,
        "metadata": metadata,
        "effective_state": policy_effective_state(&row, &state).await,
    });
    let mut response = response_with_etag(StatusCode::CREATED, row.version, body);
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

pub(crate) async fn revoke_ingest_key(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment, key_id)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    state
        .use_cases
        .validate_identity(&site_id, Some(&environment))
        .map_err(map_store_error)?;
    let version = parse_if_match(&headers)?;
    let row = state
        .use_cases
        .revoke_ingest_key(&site_id, &environment, version, &key_id)
        .await
        .map_err(map_store_error)?;
    validate_stored_policy(&row, &state, &site_id, &environment)?;
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        policy_response(&row, &state).await?,
    ))
}
