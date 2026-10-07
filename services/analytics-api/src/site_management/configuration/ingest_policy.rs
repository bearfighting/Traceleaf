use super::*;

pub(in crate::site_management) async fn get_ingest_policy(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment)): Path<(String, String)>,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, Some(&environment))?;
    let row = config_store::get_ingest_policy(&state.pool, &site_id, &environment)
        .await
        .map_err(map_store_error)?
        .ok_or(ConfigurationApiError::NotFound)?;
    validate_stored_policy(&row, &state, &site_id, &environment)?;
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        policy_response(&state.pool, &row, &state).await?,
    ))
}

pub(in crate::site_management) async fn create_ingest_policy(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment)): Path<(String, String)>,
    headers: HeaderMap,
    request: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, Some(&environment))?;
    require_if_none_match(&headers)?;
    let Json(request) = request.map_err(ConfigurationApiError::from)?;
    validate_schema(&state.validators.environment_policy, &request, "")?;
    let request: PolicyUpdate = serde_json::from_value(request).map_err(|_| {
        ConfigurationApiError::validation("", "invalid_body", "Request body is invalid.")
    })?;
    let origins = validate_policy_origins(&request.allowed_origins)?;
    let row = config_store::create_ingest_policy(
        &state.pool,
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
        policy_response(&state.pool, &row, &state).await?,
    ))
}

pub(in crate::site_management) async fn put_ingest_policy(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment)): Path<(String, String)>,
    headers: HeaderMap,
    request: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, Some(&environment))?;
    let version = parse_if_match(&headers)?;
    let Json(request) = request.map_err(ConfigurationApiError::from)?;
    validate_schema(&state.validators.environment_policy, &request, "")?;
    let request: PolicyUpdate = serde_json::from_value(request).map_err(|_| {
        ConfigurationApiError::validation("", "invalid_body", "Request body is invalid.")
    })?;
    let origins = validate_policy_origins(&request.allowed_origins)?;
    let row = config_store::update_ingest_policy(
        &state.pool,
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
        policy_response(&state.pool, &row, &state).await?,
    ))
}
