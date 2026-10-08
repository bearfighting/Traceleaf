use super::*;

pub(crate) async fn get_capabilities(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
) -> Result<Response, ConfigurationApiError> {
    state
        .use_cases
        .validate_identity(&site_id, None)
        .map_err(map_store_error)?;
    let row = state
        .use_cases
        .get_capabilities(&site_id)
        .await
        .map_err(map_store_error)?
        .ok_or(ConfigurationApiError::NotFound)?;
    if row.document["site_id"].as_str() != Some(site_id.as_str()) {
        return Err(ConfigurationApiError::Unavailable);
    }
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        capability_response(&row, &state).await?,
    ))
}

pub(crate) async fn create_capabilities(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    state
        .use_cases
        .validate_identity(&site_id, None)
        .map_err(map_store_error)?;
    require_if_none_match(&headers)?;

    let capabilities = state
        .use_cases
        .default_capabilities()
        .map_err(map_store_error)?["capabilities"]
        .clone();
    let row = state
        .use_cases
        .create_capabilities(&site_id, capabilities)
        .await
        .map_err(map_store_error)?;

    Ok(response_with_etag(
        StatusCode::CREATED,
        row.version,
        capability_response(&row, &state).await?,
    ))
}

pub(crate) async fn put_capabilities(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
    request: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    state
        .use_cases
        .validate_identity(&site_id, None)
        .map_err(map_store_error)?;
    let version = parse_if_match(&headers)?;
    let Json(request) = request.map_err(ConfigurationApiError::from)?;
    let request: CapabilityUpdate = serde_json::from_value(request).map_err(|_| {
        ConfigurationApiError::validation("", "invalid_body", "Request body is invalid.")
    })?;
    let capabilities = state
        .use_cases
        .validate_capabilities(serde_json::json!({"capabilities":request.capabilities}))
        .map_err(map_store_error)?["capabilities"]
        .clone();
    let row = state
        .use_cases
        .update_capabilities(&site_id, version, capabilities)
        .await
        .map_err(map_store_error)?;
    if row.document["site_id"].as_str() != Some(site_id.as_str()) {
        return Err(ConfigurationApiError::Unavailable);
    }
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        capability_response(&row, &state).await?,
    ))
}
