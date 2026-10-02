use std::fmt::Write as _;

use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header::ETAG},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{SecondsFormat, Utc};
use getrandom::fill as random_fill;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use url::Url;

use crate::site_management::{
    auth::AdminAuth,
    config_store::{self, ConfigurationRow, StoreError},
    errors::{ConfigurationApiError, ConfigurationValidationDetail},
    state::SiteManagementState,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CapabilityUpdate {
    capabilities: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PolicyUpdate {
    enabled: bool,
    allowed_origins: Vec<String>,
    rate_limit_per_minute: i64,
}

fn response_with_etag(status: StatusCode, version: i64, body: Value) -> Response {
    let mut response = (status, Json(body)).into_response();
    let etag = HeaderValue::from_str(&format!("\"{version}\""))
        .expect("positive integer versions form valid ETags");
    response.headers_mut().insert(ETAG, etag);
    response
}

fn parse_if_match(headers: &HeaderMap) -> Result<i64, ConfigurationApiError> {
    let Some(value) = headers
        .get("if-match")
        .and_then(|value| value.to_str().ok())
    else {
        return Err(ConfigurationApiError::PreconditionRequired);
    };
    let Some(version_text) = value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
    else {
        return Err(ConfigurationApiError::PreconditionRequired);
    };
    if version_text.is_empty()
        || version_text.starts_with('0')
        || !version_text.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ConfigurationApiError::PreconditionRequired);
    }
    version_text
        .parse::<i64>()
        .ok()
        .filter(|version| *version > 0)
        .ok_or(ConfigurationApiError::PreconditionRequired)
}

fn require_if_none_match(headers: &HeaderMap) -> Result<(), ConfigurationApiError> {
    if headers
        .get("if-none-match")
        .and_then(|value| value.to_str().ok())
        == Some("*")
    {
        Ok(())
    } else {
        Err(ConfigurationApiError::PreconditionRequired)
    }
}

pub(crate) fn validate_schema(
    validator: &jsonschema::Validator,
    value: &Value,
    path: &'static str,
) -> Result<(), ConfigurationApiError> {
    if let Some(error) = validator.iter_errors(value).next() {
        return Err(ConfigurationApiError::Validation(vec![
            ConfigurationValidationDetail {
                path: format!("{path}{}", error.instance_path()),
                code: "schema_validation",
                message: "Value does not match the configuration schema.",
            },
        ]));
    }
    Ok(())
}

pub(crate) fn validate_capability_dependencies(
    value: &Value,
    registry: &configuration_runtime::CapabilityRegistry,
) -> Result<(), ConfigurationApiError> {
    let capabilities = &value["capabilities"];
    if capabilities["page_views"]["enabled"] != true {
        return Err(ConfigurationApiError::validation(
            "/capabilities/page_views/enabled",
            "required_capability",
            "Page Views must remain enabled.",
        ));
    }
    for capability in registry.ids() {
        let id = capability.as_str();
        if capabilities[id]["enabled"] != true {
            continue;
        }
        if !registry.is_implemented(capability) {
            return Err(ConfigurationApiError::validation(
                format!("/capabilities/{id}/enabled"),
                "unsupported_capability",
                "A planned capability cannot be enabled.",
            ));
        }
        for dependency in registry.dependencies(capability) {
            if capabilities[dependency.as_str()]["enabled"] != true {
                return Err(ConfigurationApiError::validation(
                    format!("/capabilities/{}/{}/enabled", id, dependency.as_str()),
                    "missing_dependency",
                    "An enabled capability requires this dependency.",
                ));
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_policy_origins(origins: &[String]) -> Result<Value, ConfigurationApiError> {
    let mut canonical_origins = Vec::with_capacity(origins.len());
    let mut identities = std::collections::HashSet::new();
    for (index, origin) in origins.iter().enumerate() {
        let parsed = Url::parse(origin).map_err(|_| {
            ConfigurationApiError::validation(
                format!("/allowed_origins/{index}"),
                "invalid_origin",
                "Origin must be an HTTP or HTTPS origin without credentials, path, query, or fragment.",
            )
        })?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || !matches!(parsed.path(), "" | "/")
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || parsed.host().is_none()
        {
            return Err(ConfigurationApiError::validation(
                format!("/allowed_origins/{index}"),
                "invalid_origin",
                "Origin must be an HTTP or HTTPS origin without credentials, path, query, or fragment.",
            ));
        }
        let identity = parsed.origin().ascii_serialization();
        if !identities.insert(identity) {
            return Err(ConfigurationApiError::validation(
                format!("/allowed_origins/{index}"),
                "duplicate_origin",
                "Origins must be unique after URL normalization.",
            ));
        }
        canonical_origins.push(Value::String(origin.clone()));
    }
    Ok(Value::Array(canonical_origins))
}

fn map_store_error(error: StoreError) -> ConfigurationApiError {
    match error {
        StoreError::NotFound => ConfigurationApiError::NotFound,
        StoreError::Conflict | StoreError::AlreadyExists => ConfigurationApiError::Conflict,
        StoreError::DefinitionRemoval => ConfigurationApiError::validation(
            "/definitions",
            "definition_id_immutable",
            "Definitions must be soft-deactivated instead of removed.",
        ),
        StoreError::OriginConflict => ConfigurationApiError::validation(
            "/allowed_origins",
            "origin_already_assigned",
            "An Origin is already assigned to another environment for this site.",
        ),
        StoreError::Database(error) => {
            let _ = error;
            tracing::error!("configuration persistence unavailable");
            ConfigurationApiError::Unavailable
        }
    }
}

async fn policy_effective_state(pool: &sqlx::PgPool, row: &ConfigurationRow) -> Value {
    let site_id = row.document["site_id"].as_str().unwrap_or_default();
    let environment = row.document["environment"].as_str().unwrap_or_default();
    let collector = config_store::collector_applied_state(pool, site_id, environment, row.version)
        .await
        .unwrap_or_else(|_| {
            tracing::warn!("Collector application state unavailable");
            config_store::AppliedCollectorState {
                status: "pending",
                applied_version: None,
            }
        });
    json!({
        "status": collector.status,
        "stored_version": row.version,
        "applied_versions": {
            "collector": collector.applied_version,
            "processor": null,
            "analytics_api": null,
        }
    })
}

fn validate_stored_policy(
    row: &ConfigurationRow,
    state: &SiteManagementState,
    site_id: &str,
    environment: &str,
) -> Result<configuration_runtime::EnvironmentPolicyView, ConfigurationApiError> {
    if state
        .validators
        .stored_policy
        .iter_errors(&row.document)
        .next()
        .is_some()
        || row.document["site_id"].as_str() != Some(site_id)
        || row.document["environment"].as_str() != Some(environment)
        || row.document["version"].as_i64() != Some(row.version)
    {
        return Err(ConfigurationApiError::Unavailable);
    }
    configuration_runtime::EnvironmentPolicyView::parse_validated(
        &row.document,
        site_id,
        environment,
        row.version,
    )
    .map_err(|_| ConfigurationApiError::Unavailable)
}

async fn policy_response(
    pool: &sqlx::PgPool,
    row: &ConfigurationRow,
    state: &SiteManagementState,
) -> Result<Value, ConfigurationApiError> {
    let view = validate_stored_policy(
        row,
        state,
        row.document["site_id"].as_str().unwrap_or_default(),
        row.document["environment"].as_str().unwrap_or_default(),
    )?;
    let keys = view
        .ingest_keys
        .into_iter()
        .map(|key| json!({"key_id": key.key_id, "created_at": key.created_at}))
        .collect::<Vec<_>>();
    Ok(json!({
        "policy": {
            "site_id": view.site_id,
            "environment": view.environment,
            "version": view.version,
            "enabled": view.enabled,
            "allowed_origins": view.allowed_origins,
            "keys": keys,
            "rate_limit_per_minute": view.rate_limit_per_minute,
        },
        "effective_state": policy_effective_state(pool, row).await,
    }))
}

fn validate_stored_capabilities(
    row: &ConfigurationRow,
    state: &SiteManagementState,
    site_id: &str,
) -> Result<(), ConfigurationApiError> {
    if state
        .validators
        .stored_capabilities
        .iter_errors(&row.document)
        .next()
        .is_some()
        || row.document["site_id"].as_str() != Some(site_id)
        || row.document["version"].as_i64() != Some(row.version)
        || validate_capability_dependencies(&row.document, &state.capabilities).is_err()
    {
        return Err(ConfigurationApiError::Unavailable);
    }
    Ok(())
}

async fn capability_response(
    pool: &sqlx::PgPool,
    row: &ConfigurationRow,
    state: &SiteManagementState,
) -> Result<Value, ConfigurationApiError> {
    validate_stored_capabilities(
        row,
        state,
        row.document["site_id"].as_str().unwrap_or_default(),
    )?;
    let site_id = row.document["site_id"].as_str().unwrap_or_default();
    let collector =
        config_store::capability_applied_state(pool, "collector", site_id, row.version).await;
    let processor =
        config_store::capability_applied_state(pool, "processor", site_id, row.version).await;
    let analytics_api =
        config_store::capability_applied_state(pool, "analytics_api", site_id, row.version).await;
    let (collector, processor, analytics_api) = match (collector, processor, analytics_api) {
        (Ok(c), Ok(p), Ok(a)) => (c, p, a),
        _ => {
            tracing::warn!("capability application state unavailable");
            (
                config_store::AppliedCapabilityState {
                    status: "pending",
                    applied_version: None,
                },
                config_store::AppliedCapabilityState {
                    status: "pending",
                    applied_version: None,
                },
                config_store::AppliedCapabilityState {
                    status: "pending",
                    applied_version: None,
                },
            )
        }
    };
    let status = if [collector.status, processor.status, analytics_api.status].contains(&"stale") {
        "stale"
    } else if [collector.status, processor.status, analytics_api.status].contains(&"pending") {
        "pending"
    } else {
        "current"
    };
    Ok(json!({
        "configuration": row.document,
        "effective_state": {
            "status": status,
            "stored_version": row.version,
            "applied_versions": {
                "collector": collector.applied_version,
                "processor": processor.applied_version,
                "analytics_api": analytics_api.applied_version,
            }
        }
    }))
}

fn validate_identity(
    site_id: &str,
    environment: Option<&str>,
) -> Result<(), ConfigurationApiError> {
    if site_id.is_empty() || site_id.len() > 64 {
        return Err(ConfigurationApiError::validation(
            "/site_id",
            "invalid_identity",
            "Site ID must contain between 1 and 64 bytes.",
        ));
    }
    if environment.is_some_and(|value| value.trim().is_empty()) {
        return Err(ConfigurationApiError::validation(
            "/environment",
            "invalid_identity",
            "Environment must not be empty.",
        ));
    }
    Ok(())
}

pub(crate) async fn get_capabilities(
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

pub(crate) async fn create_capabilities(
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

pub(crate) async fn put_capabilities(
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

pub(crate) async fn get_ingest_policy(
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

pub(crate) async fn create_ingest_policy(
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

pub(crate) async fn put_ingest_policy(
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

fn digest_hex(key: &str) -> String {
    let digest = Sha256::digest(key.as_bytes());
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn create_key_material()
-> Result<(String, String, String, chrono::DateTime<Utc>), ConfigurationApiError> {
    let mut key_bytes = [0_u8; 32];
    let mut id_bytes = [0_u8; 12];
    random_fill(&mut key_bytes).map_err(|_| ConfigurationApiError::Unavailable)?;
    random_fill(&mut id_bytes).map_err(|_| ConfigurationApiError::Unavailable)?;
    let key = URL_SAFE_NO_PAD.encode(key_bytes);
    let key_id = format!("ik_{}", URL_SAFE_NO_PAD.encode(id_bytes));
    let digest = digest_hex(&key);
    Ok((key, key_id, digest, Utc::now()))
}

pub(crate) async fn create_ingest_key(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path((site_id, environment)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    validate_identity(&site_id, Some(&environment))?;
    let version = parse_if_match(&headers)?;
    let (key, key_id, digest, created_at) = create_key_material()?;
    let row = config_store::create_ingest_key(
        &state.pool,
        &site_id,
        &environment,
        version,
        &key_id,
        &digest,
        created_at,
    )
    .await
    .map_err(map_store_error)?;
    let metadata = json!({
        "key_id": key_id,
        "created_at": created_at.to_rfc3339_opts(SecondsFormat::Micros, true),
    });
    let body = json!({
        "key": key,
        "metadata": metadata,
        "effective_state": policy_effective_state(&state.pool, &row).await,
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
    validate_identity(&site_id, Some(&environment))?;
    let version = parse_if_match(&headers)?;
    let row =
        config_store::revoke_ingest_key(&state.pool, &site_id, &environment, version, &key_id)
            .await
            .map_err(map_store_error)?;
    validate_stored_policy(&row, &state, &site_id, &environment)?;
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        policy_response(&state.pool, &row, &state).await?,
    ))
}

fn validate_definition_set(definitions: &Value) -> Result<(), ConfigurationApiError> {
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

fn validate_stored_definition_set(
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

pub(crate) async fn get_definition_set(
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

pub(crate) async fn create_definition_set(
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

pub(crate) async fn put_definition_set(
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

#[cfg(test)]
mod validator_tests {
    use axum::response::IntoResponse;
    use serde_json::Value;

    use crate::site_management::{
        configuration::validate_schema, validation::ConfigurationValidators,
    };

    #[tokio::test]
    async fn invalid_stored_documents_map_to_unavailable_before_get_response_projection() {
        use super::{
            validate_stored_capabilities, validate_stored_definition_set, validate_stored_policy,
        };
        use crate::site_management::{config_store::ConfigurationRow, state::SiteManagementState};
        use sqlx::postgres::PgPoolOptions;

        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://analytics:analytics@127.0.0.1:1/analytics")
            .unwrap();
        let state = SiteManagementState::new(
            pool,
            std::sync::Arc::new(configuration_runtime::CapabilityRegistry::canonical().unwrap()),
        )
        .unwrap();
        let policy = ConfigurationRow {
            version: 1,
            document: serde_json::json!({"site_id":"site_a","environment":"production","version":1,"unexpected":true}),
        };
        assert!(matches!(
            validate_stored_policy(&policy, &state, "site_a", "production"),
            Err(super::ConfigurationApiError::Unavailable)
        ));
        let capabilities = ConfigurationRow {
            version: 1,
            document: serde_json::json!({"site_id":"site_a","version":1,"unexpected":true}),
        };
        assert!(matches!(
            validate_stored_capabilities(&capabilities, &state, "site_a"),
            Err(super::ConfigurationApiError::Unavailable)
        ));
        let definitions = ConfigurationRow {
            version: 1,
            document: serde_json::json!({"site_id":"site_a","revision":1,"definition_version":"r1-token","unexpected":true}),
        };
        assert!(matches!(
            validate_stored_definition_set(&definitions, &state, "site_a"),
            Err(super::ConfigurationApiError::Unavailable)
        ));
    }

    #[test]
    fn management_updates_reject_enabled_planned_capabilities() {
        let mut manifest: Value = serde_json::from_str(include_str!(
            "../../../../protocol/capabilities/capabilities.json"
        ))
        .unwrap();
        let geo = manifest["capabilities"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|entry| entry["id"] == "geo")
            .unwrap();
        geo["status"] = serde_json::json!("planned");
        geo["api"]["query_surface"] = serde_json::json!("future_report");
        geo["api"]["routes"] = serde_json::json!([]);
        geo["dashboard"]["surface"] = serde_json::json!("future_report");
        let registry =
            configuration_runtime::CapabilityRegistry::from_json(&manifest.to_string()).unwrap();
        let value: Value = serde_json::from_str(include_str!("../../../../protocol/contracts/configuration/current/fixtures/capability-update/valid/all-enabled.json")).unwrap();
        assert!(matches!(
            super::validate_capability_dependencies(&value, &registry),
            Err(super::ConfigurationApiError::Validation(_))
        ));
    }

    #[test]
    fn canonical_update_fixtures_match_management_schema_boundaries() {
        let validators = ConfigurationValidators::new().unwrap();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/contracts/configuration/current/fixtures");
        let cases = [
            ("environment-policy-update", &validators.environment_policy),
            ("capability-update", &validators.capabilities),
            (
                "conversion-funnel-definition-set-update",
                &validators.definition_set,
            ),
        ];
        for (fixture_name, validator) in cases {
            for (kind, expected) in [("valid", true), ("invalid", false)] {
                let directory = root.join(fixture_name).join(kind);
                for entry in std::fs::read_dir(directory).unwrap() {
                    let path = entry.unwrap().path();
                    if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                        continue;
                    }
                    let value: Value =
                        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                    let schema_accepts = validate_schema(validator, &value, "").is_ok();
                    let filename = path.file_name().unwrap().to_string_lossy();
                    let semantic = matches!(
                        (fixture_name, filename.as_ref()),
                        (
                            "conversion-funnel-definition-set-update",
                            "duplicate-ids.json"
                        )
                    );
                    assert_eq!(schema_accepts, expected || semantic, "{}", path.display());
                    let service_accepts = if !schema_accepts {
                        None
                    } else {
                        Some(match fixture_name {
                            "environment-policy-update" => value["allowed_origins"]
                                .as_array()
                                .map(|origins| {
                                    let origins = origins
                                        .iter()
                                        .filter_map(Value::as_str)
                                        .map(str::to_owned)
                                        .collect::<Vec<_>>();
                                    super::validate_policy_origins(&origins).is_ok()
                                })
                                .unwrap_or(false),
                            "capability-update" => super::validate_capability_dependencies(
                                &value,
                                &configuration_runtime::CapabilityRegistry::canonical().unwrap(),
                            )
                            .is_ok(),
                            "conversion-funnel-definition-set-update" => {
                                super::validate_definition_set(&value).is_ok()
                            }
                            _ => unreachable!(),
                        })
                    };
                    assert_eq!(
                        service_accepts,
                        schema_accepts.then_some(!semantic),
                        "{}",
                        path.display()
                    );
                    println!(
                        "M24_FIXTURE_RESULT\t{fixture_name}/{kind}/{filename}\tschema={}\tservice={}",
                        if schema_accepts { "accept" } else { "reject" },
                        match service_accepts {
                            Some(true) => "accept",
                            Some(false) => "reject",
                            None => "not-reached",
                        }
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn canonical_semantic_fixtures_preserve_service_rules_and_error_mapping() {
        let validators = ConfigurationValidators::new().unwrap();
        let mut capability: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/capability-update/valid/all-enabled.json"
        )).unwrap();
        capability["capabilities"]["anonymous_visitors"]["enabled"] = serde_json::json!(false);
        assert!(validate_schema(&validators.capabilities, &capability, "").is_ok());
        let dependency_error = super::validate_capability_dependencies(
            &capability,
            &configuration_runtime::CapabilityRegistry::canonical().unwrap(),
        )
        .unwrap_err();
        let dependency_response = dependency_error.into_response();
        assert_eq!(
            dependency_response.status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let dependency_body = axum::body::to_bytes(dependency_response.into_body(), usize::MAX)
            .await
            .unwrap();
        let dependency_body: Value = serde_json::from_slice(&dependency_body).unwrap();
        assert_eq!(
            dependency_body["error"]["code"],
            "configuration_validation_failed"
        );
        assert_eq!(
            dependency_body["error"]["details"][0]["code"],
            "missing_dependency"
        );
        capability["capabilities"]["browser_context"]["enabled"] = serde_json::json!(true);
        capability["capabilities"]["sessions"]["enabled"] = serde_json::json!(false);
        assert!(
            super::validate_capability_dependencies(
                &capability,
                &configuration_runtime::CapabilityRegistry::canonical().unwrap()
            )
            .is_ok()
        );

        let mut policy_update: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/environment-policy-update/valid/production.json"
        ))
        .unwrap();
        policy_update["allowed_origins"] =
            serde_json::json!(["https://example.com:443/", "https://example.com"]);
        assert!(validate_schema(&validators.environment_policy, &policy_update, "").is_ok());
        let origins = policy_update["allowed_origins"]
            .as_array()
            .unwrap()
            .iter()
            .map(|origin| origin.as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        let origin_error = super::validate_policy_origins(&origins).unwrap_err();
        match origin_error {
            crate::site_management::errors::ConfigurationApiError::Validation(details) => {
                assert_eq!(details[0].code, "duplicate_origin")
            }
            other => panic!("expected duplicate origin validation error, got {other:?}"),
        }

        let duplicate_ids: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/invalid/duplicate-ids.json"
        )).unwrap();
        assert!(validate_schema(&validators.definition_set, &duplicate_ids, "").is_ok());
        let duplicate_error = super::validate_definition_set(&duplicate_ids).unwrap_err();
        match duplicate_error {
            crate::site_management::errors::ConfigurationApiError::Validation(details) => {
                assert_eq!(details[0].code, "duplicate_definition_id")
            }
            other => panic!("expected duplicate ID validation error, got {other:?}"),
        }

        let mut sensitive: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/valid/definitions.json"
        )).unwrap();
        sensitive["conversions"][0]["properties"] =
            serde_json::json!({"email": "person@example.com"});
        assert!(validate_schema(&validators.definition_set, &sensitive, "").is_ok());
        let privacy_error = super::validate_definition_set(&sensitive).unwrap_err();
        match privacy_error {
            crate::site_management::errors::ConfigurationApiError::Validation(details) => {
                assert_eq!(details[0].code, "sensitive_property_forbidden")
            }
            other => panic!("expected privacy validation error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn injected_management_validators_preserve_schema_error_responses() {
        let validators = ConfigurationValidators::new().unwrap();
        let cases = [
            (
                &validators.capabilities,
                include_str!(
                    "../../../../protocol/contracts/configuration/current/fixtures/capability-update/valid/all-enabled.json"
                ),
                include_str!(
                    "../../../../protocol/contracts/configuration/current/fixtures/capability-update/invalid/unknown-capability.json"
                ),
            ),
            (
                &validators.environment_policy,
                include_str!(
                    "../../../../protocol/contracts/configuration/current/fixtures/environment-policy-update/valid/production.json"
                ),
                include_str!(
                    "../../../../protocol/contracts/configuration/current/fixtures/environment-policy-update/invalid/duplicate-origins.json"
                ),
            ),
            (
                &validators.definition_set,
                include_str!(
                    "../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/valid/definitions.json"
                ),
                include_str!(
                    "../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/invalid/missing-active.json"
                ),
            ),
        ];

        for (validator, valid, invalid) in cases {
            let valid: Value = serde_json::from_str(valid).unwrap();
            assert!(validate_schema(validator, &valid, "").is_ok());

            let invalid: Value = serde_json::from_str(invalid).unwrap();
            let error = validate_schema(validator, &invalid, "").unwrap_err();
            let response = error.into_response();
            assert_eq!(
                response.status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["error"]["code"], "configuration_validation_failed");
            assert_eq!(body["error"]["message"], "Configuration failed validation.");
            assert_eq!(body["error"]["details"][0]["code"], "schema_validation");
            assert_eq!(
                body["error"]["details"][0]["message"],
                "Value does not match the configuration schema."
            );
        }
    }
}
