use super::*;

pub(crate) async fn get_ingest_policy(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment)): Path<(String, String)>,
) -> Result<Response, ConfigurationApiError> {
    state
        .use_cases
        .validate_identity(&site_id, Some(&environment))
        .map_err(map_store_error)?;
    let row = state
        .use_cases
        .get_ingest_policy(&site_id, &environment)
        .await
        .map_err(map_store_error)?
        .ok_or(ConfigurationApiError::NotFound)?;
    validate_stored_policy(&row, &state, &site_id, &environment)?;
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        policy_response(&row, &state).await?,
    ))
}

pub(crate) async fn create_ingest_policy(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment)): Path<(String, String)>,
    headers: HeaderMap,
    request: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    state
        .use_cases
        .validate_identity(&site_id, Some(&environment))
        .map_err(map_store_error)?;
    require_if_none_match(&headers)?;
    let Json(request) = request.map_err(ConfigurationApiError::from)?;
    let request: PolicyUpdate = serde_json::from_value(request).map_err(|_| {
        ConfigurationApiError::validation("", "invalid_body", "Request body is invalid.")
    })?;
    let origins = state
        .use_cases
        .validate_policy_update(
            request.enabled,
            &request.allowed_origins,
            request.rate_limit_per_minute,
        )
        .map_err(map_store_error)?;
    let row = state
        .use_cases
        .create_ingest_policy(
            &site_id,
            &environment,
            request.enabled,
            origins,
            request.rate_limit_per_minute,
        )
        .await
        .map_err(map_store_error)?;
    Ok(response_with_etag(
        StatusCode::CREATED,
        row.version,
        policy_response(&row, &state).await?,
    ))
}

pub(crate) async fn put_ingest_policy(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment)): Path<(String, String)>,
    headers: HeaderMap,
    request: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    state
        .use_cases
        .validate_identity(&site_id, Some(&environment))
        .map_err(map_store_error)?;
    let version = parse_if_match(&headers)?;
    let Json(request) = request.map_err(ConfigurationApiError::from)?;
    let request: PolicyUpdate = serde_json::from_value(request).map_err(|_| {
        ConfigurationApiError::validation("", "invalid_body", "Request body is invalid.")
    })?;
    let origins = state
        .use_cases
        .validate_policy_update(
            request.enabled,
            &request.allowed_origins,
            request.rate_limit_per_minute,
        )
        .map_err(map_store_error)?;
    let row = state
        .use_cases
        .update_ingest_policy(
            &site_id,
            &environment,
            version,
            request.enabled,
            origins,
            request.rate_limit_per_minute,
        )
        .await
        .map_err(map_store_error)?;
    validate_stored_policy(&row, &state, &site_id, &environment)?;
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        policy_response(&row, &state).await?,
    ))
}
