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

const CAPABILITY_SCHEMA: &str = include_str!(
    "../../../../protocol/contracts/configuration/current/capability-update.schema.json"
);
const POLICY_UPDATE_SCHEMA: &str = include_str!(
    "../../../../protocol/contracts/configuration/current/environment-policy-update.schema.json"
);
const CAPABILITY_MANIFEST: &str =
    include_str!("../../../../protocol/capabilities/capabilities.json");

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

#[derive(Deserialize)]
struct CapabilityManifest {
    capabilities: Vec<ManifestCapability>,
}

#[derive(Deserialize)]
struct ManifestCapability {
    id: String,
    depends_on: Vec<String>,
}

#[derive(Deserialize)]
struct KeyDocument {
    key_id: String,
    created_at: String,
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

fn validate_schema(
    schema_text: &str,
    value: &Value,
    path: &'static str,
) -> Result<(), ConfigurationApiError> {
    let schema: Value =
        serde_json::from_str(schema_text).map_err(|_| ConfigurationApiError::Unavailable)?;
    let validator = jsonschema::options()
        .with_draft(jsonschema::Draft::Draft202012)
        .build(&schema)
        .map_err(|_| ConfigurationApiError::Unavailable)?;
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

fn validate_capability_dependencies(value: &Value) -> Result<(), ConfigurationApiError> {
    let manifest: CapabilityManifest = serde_json::from_str(CAPABILITY_MANIFEST)
        .map_err(|_| ConfigurationApiError::Unavailable)?;
    let capabilities = &value["capabilities"];
    if capabilities["page_views"]["enabled"] != true {
        return Err(ConfigurationApiError::validation(
            "/capabilities/page_views/enabled",
            "required_capability",
            "Page Views must remain enabled.",
        ));
    }
    for capability in manifest.capabilities {
        if capabilities[&capability.id]["enabled"] != true {
            continue;
        }
        for dependency in capability.depends_on {
            if capabilities[&dependency]["enabled"] != true {
                return Err(ConfigurationApiError::validation(
                    format!("/capabilities/{}/{}/enabled", capability.id, dependency),
                    "missing_dependency",
                    "An enabled capability requires this dependency.",
                ));
            }
        }
    }
    Ok(())
}

fn validate_policy_origins(origins: &[String]) -> Result<Value, ConfigurationApiError> {
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

async fn policy_response(pool: &sqlx::PgPool, row: &ConfigurationRow) -> Value {
    let keys = row.document["ingest_keys"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|value| serde_json::from_value::<KeyDocument>(value.clone()).ok())
        .map(|key| json!({"key_id": key.key_id, "created_at": key.created_at}))
        .collect::<Vec<_>>();
    json!({
        "policy": {
            "site_id": row.document["site_id"],
            "environment": row.document["environment"],
            "version": row.version,
            "enabled": row.document["enabled"],
            "allowed_origins": row.document["allowed_origins"],
            "keys": keys,
            "rate_limit_per_minute": row.document["rate_limit_per_minute"],
        },
        "effective_state": policy_effective_state(pool, row).await,
    })
}

async fn capability_response(pool: &sqlx::PgPool, row: &ConfigurationRow) -> Value {
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
    json!({
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
    })
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
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        capability_response(&state.pool, &row).await,
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
    validate_schema(CAPABILITY_SCHEMA, &request, "")?;
    let request: CapabilityUpdate = serde_json::from_value(request).map_err(|_| {
        ConfigurationApiError::validation("", "invalid_body", "Request body is invalid.")
    })?;
    validate_capability_dependencies(&json!({"capabilities":request.capabilities}))?;
    let row =
        config_store::update_capabilities(&state.pool, &site_id, version, request.capabilities)
            .await
            .map_err(map_store_error)?;
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        capability_response(&state.pool, &row).await,
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
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        policy_response(&state.pool, &row).await,
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
    validate_schema(POLICY_UPDATE_SCHEMA, &request, "")?;
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
        policy_response(&state.pool, &row).await,
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
    validate_schema(POLICY_UPDATE_SCHEMA, &request, "")?;
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
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        policy_response(&state.pool, &row).await,
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
    Ok(response_with_etag(
        StatusCode::OK,
        row.version,
        policy_response(&state.pool, &row).await,
    ))
}

const DEFINITION_SET_UPDATE_SCHEMA: &str = include_str!(
    "../../../../protocol/contracts/configuration/current/conversion-funnel-definition-set-update.schema.json"
);

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
    validate_schema(DEFINITION_SET_UPDATE_SCHEMA, &request, "")?;
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
    validate_schema(DEFINITION_SET_UPDATE_SCHEMA, &request, "")?;
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
