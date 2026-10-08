use super::*;

#[cfg(test)]
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
    state
        .use_cases
        .validate_stored_definition_set(row, site_id)
        .map_err(map_store_error)
}

pub(crate) async fn get_definition_set(
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
        .get_definition_set(&site_id)
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

pub(crate) async fn create_definition_set(
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
    require_if_none_match(&headers)?;
    let Json(request) = request.map_err(ConfigurationApiError::from)?;
    let request = state
        .use_cases
        .validate_definition_set(request)
        .map_err(map_store_error)?;
    let row = state
        .use_cases
        .create_definition_set(&site_id, request)
        .await
        .map_err(map_store_error)?;
    Ok(response_with_etag(
        StatusCode::CREATED,
        row.version,
        row.document,
    ))
}

pub(crate) async fn put_definition_set(
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
    let revision = parse_if_match(&headers)?;
    let Json(request) = request.map_err(ConfigurationApiError::from)?;
    let request = state
        .use_cases
        .validate_definition_set(request)
        .map_err(map_store_error)?;
    let row = state
        .use_cases
        .update_definition_set(&site_id, revision, request)
        .await
        .map_err(map_store_error)?;
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        row.document,
    ))
}
