use super::*;

pub(super) fn validate_definition_set(definitions: &Value) -> Result<(), ConfigurationApiError> {
    const FORBIDDEN: [&str; 21] = [
        "email",
        "emailaddress",
        "useremail",
        "phone",
        "phonenumber",
        "name",
        "firstname",
        "lastname",
        "fullname",
        "address",
        "homeaddress",
        "streetaddress",
        "ip",
        "ipaddress",
        "useragent",
        "cookie",
        "password",
        "passwd",
        "token",
        "userid",
        "useridentifier",
    ];
    let mut ids = std::collections::HashSet::new();
    for category in ["conversions", "funnels"] {
        for (index, definition) in definitions[category]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let id = definition["id"].as_str().unwrap_or_default();
            if !ids.insert(id) {
                return Err(ConfigurationApiError::validation(
                    format!("/{category}/{index}/id"),
                    "duplicate_definition_id",
                    "Definition IDs must be unique within the site definition set.",
                ));
            }
            let properties = if category == "conversions" {
                vec![&definition["properties"]]
            } else {
                definition["steps"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|step| &step["properties"])
                    .collect()
            };
            for property_set in properties {
                if let Some(object) = property_set.as_object() {
                    for key in object.keys() {
                        let normalized: String = key
                            .to_ascii_lowercase()
                            .chars()
                            .filter(|character| !matches!(character, '_' | '.' | '-'))
                            .collect();
                        if FORBIDDEN.contains(&normalized.as_str()) {
                            return Err(ConfigurationApiError::validation(
                                "/properties",
                                "sensitive_property_forbidden",
                                "Sensitive personal data cannot be used in definition property matching.",
                            ));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

pub(super) fn validate_stored_definition_set(
    row: &ConfigurationRow,
    state: &SiteManagementState,
    site_id: &str,
) -> Result<(), ConfigurationApiError> {
    let view = configuration_runtime::DefinitionRevisionView::parse(
        &row.document,
        site_id,
        Some(row.version),
        None,
    )
    .map_err(|_| ConfigurationApiError::Unavailable)?;
    let definitions = json!({"conversions": view.conversions, "funnels": view.funnels});
    if state
        .validators
        .definition_set
        .iter_errors(&definitions)
        .next()
        .is_some()
        || validate_definition_set(&definitions).is_err()
    {
        return Err(ConfigurationApiError::Unavailable);
    }
    Ok(())
}

pub(in crate::site_management) async fn get_definition_set(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, None)?;
    let row = config_store::get_current_definition_set(&state.pool, &site_id)
        .await
        .map_err(map_store_error)?
        .ok_or(ConfigurationApiError::NotFound)?;
    validate_stored_definition_set(&row, &state, &site_id)?;
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        row.document,
    ))
}

pub(in crate::site_management) async fn create_definition_set(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
    request: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, None)?;
    require_if_none_match(&headers)?;
    let Json(request) = request.map_err(ConfigurationApiError::from)?;
    validate_schema(&state.validators.definition_set, &request, "")?;
    validate_definition_set(&request)?;
    let row = config_store::create_definition_set(&state.pool, &site_id, None, request, None)
        .await
        .map_err(map_store_error)?;
    Ok(response_with_etag(
        StatusCode::CREATED,
        row.version,
        row.document,
    ))
}

pub(in crate::site_management) async fn put_definition_set(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
    request: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, None)?;
    let revision = parse_if_match(&headers)?;
    let Json(request) = request.map_err(ConfigurationApiError::from)?;
    validate_schema(&state.validators.definition_set, &request, "")?;
    validate_definition_set(&request)?;
    let row = config_store::update_definition_set(&state.pool, &site_id, revision, request)
        .await
        .map_err(map_store_error)?;
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        row.document,
    ))
}
