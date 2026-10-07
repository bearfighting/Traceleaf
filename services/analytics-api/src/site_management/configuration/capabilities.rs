use super::*;

pub(in crate::site_management) async fn get_capabilities(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, None)?;
    let row = config_store::get_capabilities(&state.pool, &site_id)
        .await
        .map_err(map_store_error)?
        .ok_or(ConfigurationApiError::NotFound)?;
    if row.document["site_id"].as_str() != Some(site_id.as_str()) {
        return Err(ConfigurationApiError::Unavailable);
    }
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        capability_response(&state.pool, &row, &state).await?,
    ))
}

pub(in crate::site_management) async fn create_capabilities(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, None)?;
    require_if_none_match(&headers)?;

    let mut capabilities = serde_json::Map::new();
    for id in state.capabilities.ids() {
        let id = id.as_str();
        capabilities.insert(
            id.to_owned(),
            json!({"enabled": id == "page_views", "settings": {}}),
        );
    }
    let capabilities = Value::Object(capabilities);
    validate_capability_dependencies(&json!({"capabilities":capabilities}), &state.capabilities)?;
    let row = config_store::create_capabilities(&state.pool, &site_id, capabilities)
        .await
        .map_err(map_store_error)?;

    Ok(response_with_etag(
        StatusCode::CREATED,
        row.version,
        capability_response(&state.pool, &row, &state).await?,
    ))
}

pub(in crate::site_management) async fn put_capabilities(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
    request: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, None)?;
    let version = parse_if_match(&headers)?;
    let Json(request) = request.map_err(ConfigurationApiError::from)?;
    validate_schema(&state.validators.capabilities, &request, "")?;
    let request: CapabilityUpdate = serde_json::from_value(request).map_err(|_| {
        ConfigurationApiError::validation("", "invalid_body", "Request body is invalid.")
    })?;
    validate_capability_dependencies(
        &json!({"capabilities":request.capabilities}),
        &state.capabilities,
    )?;
    let row =
        config_store::update_capabilities(&state.pool, &site_id, version, request.capabilities)
            .await
            .map_err(map_store_error)?;
    if row.document["site_id"].as_str() != Some(site_id.as_str()) {
        return Err(ConfigurationApiError::Unavailable);
    }
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        capability_response(&state.pool, &row, &state).await?,
    ))
}
