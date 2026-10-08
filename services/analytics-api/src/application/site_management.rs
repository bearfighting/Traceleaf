//! Site management application boundary.

use chrono::{DateTime, Utc};
use configuration_runtime::CapabilityRegistry;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use unicode_normalization::UnicodeNormalization;

use crate::application::site::Site;

#[derive(Debug)]
pub(crate) enum SiteManagementError {
    NotFound,
    VersionConflict,
    Unavailable,
    InvalidMetadata(&'static str),
    Validation {
        path: String,
        code: &'static str,
        message: &'static str,
    },
    IdempotencyConflict,
}

pub(crate) struct SiteCreation {
    pub(crate) site_id: String,
    pub(crate) display_name: String,
    pub(crate) website_url: String,
    pub(crate) environment: String,
    pub(crate) idempotency_key: String,
    pub(crate) request_digest: String,
    pub(crate) key_id: String,
    pub(crate) key_digest: String,
    pub(crate) capabilities: Value,
    pub(crate) allowed_origins: Value,
}

pub(crate) enum SiteCreationResult {
    Created {
        site: Site,
        environment: String,
        key: String,
        key_id: String,
    },
    Existing(Site),
}

pub(crate) enum RepositorySiteCreationResult {
    Created(Site),
    Existing {
        site_id: String,
        request_digest: String,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SiteCreateRequest {
    display_name: String,
    website_url: String,
    environment: String,
    #[serde(default)]
    capabilities: std::collections::BTreeMap<String, bool>,
    allowed_origins: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ConfigurationDocument {
    pub(crate) version: i64,
    pub(crate) document: Value,
}

pub(crate) struct IssuedIngestKey {
    pub(crate) document: ConfigurationDocument,
    pub(crate) key: String,
    pub(crate) key_id: String,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Debug)]
pub(crate) enum ConfigurationStoreError {
    NotFound,
    Conflict,
    AlreadyExists,
    DefinitionRemoval,
    OriginConflict,
    Unavailable,
    Validation {
        path: String,
        code: &'static str,
        message: &'static str,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AppliedState {
    pub(crate) status: &'static str,
    pub(crate) applied_version: Option<i64>,
}

#[async_trait::async_trait]
/// Persistence boundary used by the Site Management application service.
pub(crate) trait SiteManagementRepository: Send + Sync {
    async fn list_sites(
        &self,
        after: Option<String>,
        limit: i64,
    ) -> Result<Vec<Site>, SiteManagementError>;
    async fn get_site(&self, site_id: &str) -> Result<Option<Site>, SiteManagementError>;
    async fn update_metadata(
        &self,
        site_id: &str,
        expected_version: i64,
        display_name: Option<String>,
        website_url: Option<String>,
        changed_fields: Vec<String>,
    ) -> Result<Site, SiteManagementError>;
    async fn update_lifecycle(
        &self,
        site_id: &str,
        expected_version: i64,
        target_status: &str,
    ) -> Result<Site, SiteManagementError>;
    async fn create_site(
        &self,
        request: SiteCreation,
    ) -> Result<RepositorySiteCreationResult, SiteManagementError>;
    async fn get_capabilities(
        &self,
        site_id: &str,
    ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError>;
    async fn create_capabilities(
        &self,
        site_id: &str,
        capabilities: Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError>;
    async fn update_capabilities(
        &self,
        site_id: &str,
        version: i64,
        capabilities: Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError>;
    async fn get_ingest_policy(
        &self,
        site_id: &str,
        environment: &str,
    ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError>;
    async fn create_ingest_policy(
        &self,
        site_id: &str,
        environment: &str,
        enabled: bool,
        origins: Value,
        rate_limit: i64,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError>;
    async fn update_ingest_policy(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
        enabled: bool,
        origins: Value,
        rate_limit: i64,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError>;
    async fn create_ingest_key(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
        key_id: &str,
        digest: &str,
        created_at: DateTime<Utc>,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError>;
    async fn revoke_ingest_key(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
        key_id: &str,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError>;
    async fn get_definition_set(
        &self,
        site_id: &str,
    ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError>;
    async fn create_definition_set(
        &self,
        site_id: &str,
        definitions: Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError>;
    async fn update_definition_set(
        &self,
        site_id: &str,
        version: i64,
        definitions: Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError>;
    async fn collector_applied_state(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
    ) -> Result<AppliedState, ConfigurationStoreError>;
    async fn capability_applied_state(
        &self,
        service: &str,
        site_id: &str,
        version: i64,
    ) -> Result<AppliedState, ConfigurationStoreError>;
}

/// Application facade for Site Management. Keeping the repository behind this
/// facade makes the HTTP state independent of the PostgreSQL implementation.
pub(crate) struct SiteManagementService {
    repository: std::sync::Arc<dyn SiteManagementRepository>,
    capabilities: Arc<CapabilityRegistry>,
    validators: crate::application::site_management_validation::ConfigurationValidators,
}

fn validate_list_arguments(after: &Option<String>, limit: i64) -> Result<(), SiteManagementError> {
    if !(1..=101).contains(&limit) {
        return Err(SiteManagementError::InvalidMetadata("/limit"));
    }
    if after
        .as_ref()
        .is_some_and(|cursor| cursor.is_empty() || cursor.len() > 64)
    {
        return Err(SiteManagementError::InvalidMetadata("/cursor"));
    }
    Ok(())
}

struct NormalizedSiteCreate {
    display_name: String,
    website_url: String,
    environment: String,
    capabilities: Value,
    allowed_origins: Value,
    digest: String,
}

fn validation(
    path: impl Into<String>,
    code: &'static str,
    message: &'static str,
) -> SiteManagementError {
    SiteManagementError::Validation {
        path: path.into(),
        code,
        message,
    }
}

fn normalize_site_request(
    request: SiteCreateRequest,
    registry: &CapabilityRegistry,
) -> Result<NormalizedSiteCreate, SiteManagementError> {
    let display_name = request.display_name.trim().nfc().collect::<String>();
    if display_name.is_empty() {
        return Err(validation(
            "/display_name",
            "blank_value",
            "Display name must not be blank.",
        ));
    }
    if display_name.chars().count() > 120 {
        return Err(validation(
            "/display_name",
            "max_length",
            "Display name must be at most 120 Unicode code points after normalization.",
        ));
    }
    let mut website = url::Url::parse(&request.website_url).map_err(|_| {
        validation(
            "/website_url",
            "invalid_url",
            "Website URL must be a valid HTTP or HTTPS URL.",
        )
    })?;
    if !matches!(website.scheme(), "http" | "https")
        || website.host().is_none()
        || !website.username().is_empty()
        || website.password().is_some()
    {
        return Err(validation(
            "/website_url",
            "invalid_url",
            "Website URL must be HTTP or HTTPS and must not include credentials.",
        ));
    }
    website.set_fragment(None);
    let website_url = website.to_string();
    let website_origin = website.origin().ascii_serialization();
    let mut origins = Vec::new();
    let mut identities = std::collections::HashSet::new();
    for (index, origin) in request.allowed_origins.iter().enumerate() {
        let parsed = url::Url::parse(origin).map_err(|_| validation(format!("/allowed_origins/{index}"), "invalid_origin", "Origin must be an HTTP or HTTPS origin without credentials, path, query, or fragment."))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || !matches!(parsed.path(), "" | "/")
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || parsed.host().is_none()
        {
            return Err(validation(
                format!("/allowed_origins/{index}"),
                "invalid_origin",
                "Origin must be an HTTP or HTTPS origin without credentials, path, query, or fragment.",
            ));
        }
        let identity = parsed.origin().ascii_serialization();
        if !identities.insert(identity.clone()) {
            return Err(validation(
                format!("/allowed_origins/{index}"),
                "duplicate_origin",
                "Origins must be unique after URL normalization.",
            ));
        }
        origins.push(identity);
    }
    origins.sort();
    if !origins.contains(&website_origin) {
        return Err(validation(
            "/allowed_origins",
            "website_origin_required",
            "Allowed Origins must include the Website URL origin.",
        ));
    }
    let mut capability_flags = serde_json::Map::new();
    let mut stored_capabilities = serde_json::Map::new();
    for capability in registry.ids() {
        let id = capability.as_str();
        let enabled = id == "page_views" || request.capabilities.get(id).copied().unwrap_or(false);
        capability_flags.insert(id.to_owned(), Value::Bool(enabled));
        stored_capabilities.insert(
            id.to_owned(),
            serde_json::json!({"enabled": enabled, "settings": {}}),
        );
    }
    let cap_doc = serde_json::json!({"capabilities": stored_capabilities});
    if cap_doc["capabilities"]["page_views"]["enabled"] != true {
        return Err(validation(
            "/capabilities/page_views/enabled",
            "required_capability",
            "Page Views must remain enabled.",
        ));
    }
    for capability in registry.ids() {
        let id = capability.as_str();
        if cap_doc["capabilities"][id]["enabled"] != true {
            continue;
        }
        if !registry.is_implemented(capability) {
            return Err(validation(
                format!("/capabilities/{id}/enabled"),
                "unsupported_capability",
                "A planned capability cannot be enabled.",
            ));
        }
        for dependency in registry.dependencies(capability) {
            if cap_doc["capabilities"][dependency.as_str()]["enabled"] != true {
                return Err(validation(
                    format!("/capabilities/{id}/{}/enabled", dependency.as_str()),
                    "missing_dependency",
                    "An enabled capability requires this dependency.",
                ));
            }
        }
    }
    let canonical = serde_json::json!({"display_name":display_name,"website_url":website_url,"environment":request.environment,"capabilities":capability_flags,"allowed_origins":origins});
    let bytes = serde_jcs::to_vec(&canonical).map_err(|_| SiteManagementError::Unavailable)?;
    let digest = sha256_hex(&bytes);
    Ok(NormalizedSiteCreate {
        display_name,
        website_url,
        environment: request.environment,
        capabilities: Value::Object(stored_capabilities),
        allowed_origins: canonical["allowed_origins"].clone(),
        digest,
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    use std::fmt::Write as _;
    Sha256::digest(bytes)
        .iter()
        .fold(String::new(), |mut out, byte| {
            write!(&mut out, "{byte:02x}").expect("String write is infallible");
            out
        })
}

fn create_site_identifiers() -> Result<(String, String, String, String), SiteManagementError> {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use getrandom::fill;
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut ulid_random = [0_u8; 10];
    let mut key_bytes = [0_u8; 32];
    let mut key_id_bytes = [0_u8; 12];
    fill(&mut ulid_random).map_err(|_| SiteManagementError::Unavailable)?;
    fill(&mut key_bytes).map_err(|_| SiteManagementError::Unavailable)?;
    fill(&mut key_id_bytes).map_err(|_| SiteManagementError::Unavailable)?;
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| SiteManagementError::Unavailable)?
        .as_millis() as u64;
    let mut random_part = [0_u8; 16];
    random_part[6..].copy_from_slice(&ulid_random);
    let site_id = format!(
        "site_{}",
        ulid::Ulid::from_parts(timestamp_ms, u128::from_be_bytes(random_part))
    );
    let key = URL_SAFE_NO_PAD.encode(key_bytes);
    let key_id = format!("ik_{}", URL_SAFE_NO_PAD.encode(key_id_bytes));
    let digest = sha256_hex(key.as_bytes());
    Ok((site_id, key, key_id, digest))
}

impl SiteManagementService {
    pub(crate) fn new(
        repository: std::sync::Arc<dyn SiteManagementRepository>,
        capabilities: Arc<CapabilityRegistry>,
        validators: crate::application::site_management_validation::ConfigurationValidators,
    ) -> Self {
        Self {
            repository,
            capabilities,
            validators,
        }
    }

    pub(crate) fn validate_identity(
        &self,
        site_id: &str,
        environment: Option<&str>,
    ) -> Result<(), ConfigurationStoreError> {
        if site_id.is_empty() || site_id.len() > 64 {
            return Err(ConfigurationStoreError::Validation {
                path: "/site_id".into(),
                code: "invalid_identity",
                message: "Site ID must contain between 1 and 64 bytes.",
            });
        }
        if environment.is_some_and(|value| value.trim().is_empty()) {
            return Err(ConfigurationStoreError::Validation {
                path: "/environment".into(),
                code: "invalid_identity",
                message: "Environment must not be empty.",
            });
        }
        Ok(())
    }

    pub(crate) fn default_capabilities(&self) -> Result<Value, ConfigurationStoreError> {
        let mut capabilities = serde_json::Map::new();
        for capability in self.capabilities.ids() {
            let id = capability.as_str();
            capabilities.insert(
                id.to_owned(),
                serde_json::json!({"enabled": id == "page_views", "settings": {}}),
            );
        }
        self.validate_capabilities(serde_json::json!({"capabilities": capabilities}))
    }

    pub(crate) async fn list_sites(
        &self,
        after: Option<String>,
        limit: i64,
    ) -> Result<Vec<Site>, SiteManagementError> {
        validate_list_arguments(&after, limit)?;
        self.repository.list_sites(after, limit).await
    }
    pub(crate) async fn get_site(
        &self,
        site_id: &str,
    ) -> Result<Option<Site>, SiteManagementError> {
        self.repository.get_site(site_id).await
    }
    pub(crate) async fn patch_metadata(
        &self,
        site_id: &str,
        expected_version: i64,
        display_name: Option<String>,
        website_url: Option<String>,
    ) -> Result<Site, SiteManagementError> {
        use unicode_normalization::UnicodeNormalization;

        if display_name.is_none() && website_url.is_none() {
            return Err(SiteManagementError::InvalidMetadata(""));
        }
        let current = self
            .repository
            .get_site(site_id)
            .await?
            .ok_or(SiteManagementError::NotFound)?;
        let display_name = display_name.map(|value| value.trim().nfc().collect::<String>());
        if display_name
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.chars().count() > 120)
        {
            return Err(SiteManagementError::InvalidMetadata("/display_name"));
        }
        let website_url = website_url
            .map(|value| {
                let parsed = url::Url::parse(&value).ok().filter(|url| {
                    matches!(url.scheme(), "http" | "https")
                        && url.host().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                        && value.len() <= 2048
                });
                parsed
                    .map(|mut url| {
                        url.set_fragment(None);
                        url.to_string()
                    })
                    .ok_or(SiteManagementError::InvalidMetadata("/website_url"))
            })
            .transpose()?;
        let display_name = display_name.or(current.display_name.clone());
        let website_url = website_url.or(current.website_url.clone());
        let mut changed_fields = Vec::new();
        if display_name != current.display_name {
            changed_fields.push("display_name".to_owned());
        }
        if website_url != current.website_url {
            changed_fields.push("website_url".to_owned());
        }
        self.repository
            .update_metadata(
                site_id,
                expected_version,
                display_name,
                website_url,
                changed_fields,
            )
            .await
    }
    pub(crate) async fn update_lifecycle(
        &self,
        site_id: &str,
        expected_version: i64,
        target_status: &str,
    ) -> Result<Site, SiteManagementError> {
        if !matches!(target_status, "active" | "archived") {
            return Err(SiteManagementError::InvalidMetadata("/lifecycle_status"));
        }
        self.repository
            .update_lifecycle(site_id, expected_version, target_status)
            .await
    }
    pub(crate) async fn create_site(
        &self,
        idempotency_key: String,
        raw_request: Value,
    ) -> Result<SiteCreationResult, SiteManagementError> {
        if let Some(error) = self.validators.site_create.iter_errors(&raw_request).next() {
            return Err(SiteManagementError::Validation {
                path: error.instance_path().to_string(),
                code: "schema_validation",
                message: "Value does not match the configuration schema.",
            });
        }
        let request: SiteCreateRequest =
            serde_json::from_value(raw_request).map_err(|_| SiteManagementError::Validation {
                path: String::new(),
                code: "invalid_body",
                message: "Request body does not match the Site creation contract.",
            })?;
        let normalized = normalize_site_request(request, &self.capabilities)?;
        let (site_id, key, key_id, key_digest) = create_site_identifiers()?;
        let outcome = self
            .repository
            .create_site(SiteCreation {
                site_id,
                display_name: normalized.display_name,
                website_url: normalized.website_url,
                environment: normalized.environment.clone(),
                idempotency_key,
                request_digest: normalized.digest.clone(),
                key_id: key_id.clone(),
                key_digest,
                capabilities: normalized.capabilities,
                allowed_origins: normalized.allowed_origins,
            })
            .await?;
        match outcome {
            RepositorySiteCreationResult::Created(site) => Ok(SiteCreationResult::Created {
                site,
                environment: normalized.environment,
                key,
                key_id,
            }),
            RepositorySiteCreationResult::Existing {
                site_id,
                request_digest,
            } => {
                if request_digest != normalized.digest {
                    return Err(SiteManagementError::IdempotencyConflict);
                }
                let site = self
                    .repository
                    .get_site(&site_id)
                    .await?
                    .ok_or(SiteManagementError::NotFound)?;
                Ok(SiteCreationResult::Existing(site))
            }
        }
    }
    pub(crate) async fn get_capabilities(
        &self,
        site_id: &str,
    ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError> {
        self.repository.get_capabilities(site_id).await
    }

    pub(crate) fn validate_capabilities(
        &self,
        value: Value,
    ) -> Result<Value, ConfigurationStoreError> {
        self.validate_schema(&self.validators.capabilities, &value)?;
        if value["capabilities"]["page_views"]["enabled"] != true {
            return Err(ConfigurationStoreError::Validation {
                path: "/capabilities/page_views/enabled".into(),
                code: "required_capability",
                message: "Page Views must remain enabled.",
            });
        }
        for capability in self.capabilities.ids() {
            let id = capability.as_str();
            if value["capabilities"][id]["enabled"] != true {
                continue;
            }
            if !self.capabilities.is_implemented(capability) {
                return Err(ConfigurationStoreError::Validation {
                    path: format!("/capabilities/{id}/enabled"),
                    code: "unsupported_capability",
                    message: "A planned capability cannot be enabled.",
                });
            }
            for dependency in self.capabilities.dependencies(capability) {
                if value["capabilities"][dependency.as_str()]["enabled"] != true {
                    return Err(ConfigurationStoreError::Validation {
                        path: format!("/capabilities/{id}/{}/enabled", dependency.as_str()),
                        code: "missing_dependency",
                        message: "An enabled capability requires this dependency.",
                    });
                }
            }
        }
        Ok(value)
    }

    pub(crate) fn validate_stored_capabilities(
        &self,
        row: &ConfigurationDocument,
        site_id: &str,
    ) -> Result<(), ConfigurationStoreError> {
        if self
            .validators
            .stored_capabilities
            .iter_errors(&row.document)
            .next()
            .is_some()
            || row.document["site_id"].as_str() != Some(site_id)
            || row.document["version"].as_i64() != Some(row.version)
        {
            return Err(ConfigurationStoreError::Unavailable);
        }
        if row.document["capabilities"]["page_views"]["enabled"] != true {
            return Err(ConfigurationStoreError::Unavailable);
        }
        for capability in self.capabilities.ids() {
            let id = capability.as_str();
            if row.document["capabilities"][id]["enabled"] != true {
                continue;
            }
            if !self.capabilities.is_implemented(capability)
                || self
                    .capabilities
                    .dependencies(capability)
                    .iter()
                    .any(|dependency| {
                        row.document["capabilities"][dependency.as_str()]["enabled"] != true
                    })
            {
                return Err(ConfigurationStoreError::Unavailable);
            }
        }
        Ok(())
    }

    pub(crate) fn normalize_policy_origins(
        &self,
        origins: &[String],
    ) -> Result<Value, ConfigurationStoreError> {
        let mut values = Vec::with_capacity(origins.len());
        let mut identities = std::collections::HashSet::new();
        for (index, origin) in origins.iter().enumerate() {
            let parsed = url::Url::parse(origin).map_err(|_| ConfigurationStoreError::Validation { path: format!("/allowed_origins/{index}"), code: "invalid_origin", message: "Origin must be an HTTP or HTTPS origin without credentials, path, query, or fragment." })?;
            if !matches!(parsed.scheme(), "http" | "https")
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || !matches!(parsed.path(), "" | "/")
                || parsed.query().is_some()
                || parsed.fragment().is_some()
                || parsed.host().is_none()
            {
                return Err(ConfigurationStoreError::Validation {
                    path: format!("/allowed_origins/{index}"),
                    code: "invalid_origin",
                    message: "Origin must be an HTTP or HTTPS origin without credentials, path, query, or fragment.",
                });
            }
            if !identities.insert(parsed.origin().ascii_serialization()) {
                return Err(ConfigurationStoreError::Validation {
                    path: format!("/allowed_origins/{index}"),
                    code: "duplicate_origin",
                    message: "Origins must be unique after URL normalization.",
                });
            }
            values.push(Value::String(origin.clone()));
        }
        Ok(Value::Array(values))
    }

    pub(crate) fn validate_policy_update(
        &self,
        enabled: bool,
        origins: &[String],
        rate_limit: i64,
    ) -> Result<Value, ConfigurationStoreError> {
        let value = serde_json::json!({"enabled": enabled, "allowed_origins": origins, "rate_limit_per_minute": rate_limit});
        self.validate_schema(&self.validators.environment_policy, &value)?;
        self.normalize_policy_origins(origins)
    }

    pub(crate) fn validate_definition_set(
        &self,
        definitions: Value,
    ) -> Result<Value, ConfigurationStoreError> {
        self.validate_schema(&self.validators.definition_set, &definitions)?;
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
                    return Err(ConfigurationStoreError::Validation {
                        path: format!("/{category}/{index}/id"),
                        code: "duplicate_definition_id",
                        message: "Definition IDs must be unique within the site definition set.",
                    });
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
                                return Err(ConfigurationStoreError::Validation {
                                    path: "/properties".into(),
                                    code: "sensitive_property_forbidden",
                                    message: "Sensitive personal data cannot be used in definition property matching.",
                                });
                            }
                        }
                    }
                }
            }
        }
        Ok(definitions)
    }

    pub(crate) fn validate_stored_definition_set(
        &self,
        row: &ConfigurationDocument,
        site_id: &str,
    ) -> Result<(), ConfigurationStoreError> {
        let view = configuration_runtime::DefinitionRevisionView::parse(
            &row.document,
            site_id,
            Some(row.version),
            None,
        )
        .map_err(|_| ConfigurationStoreError::Unavailable)?;
        self.validate_definition_set(
            serde_json::json!({"conversions":view.conversions,"funnels":view.funnels}),
        )
        .map(|_| ())
    }

    pub(crate) async fn capability_response(
        &self,
        row: &ConfigurationDocument,
    ) -> Result<Value, ConfigurationStoreError> {
        let site_id = row.document["site_id"]
            .as_str()
            .ok_or(ConfigurationStoreError::Unavailable)?;
        self.validate_stored_capabilities(row, site_id)?;
        let mut applied = Vec::with_capacity(3);
        let mut all_queries_succeeded = true;
        for service in ["collector", "processor", "analytics_api"] {
            match self
                .repository
                .capability_applied_state(service, site_id, row.version)
                .await
            {
                Ok(state) => applied.push(state),
                Err(_) => {
                    all_queries_succeeded = false;
                    break;
                }
            }
        }
        if !all_queries_succeeded {
            applied = vec![
                AppliedState {
                    status: "pending",
                    applied_version: None
                };
                3
            ];
        }
        let status = if applied.iter().any(|state| state.status == "stale") {
            "stale"
        } else if applied.iter().any(|state| state.status == "pending") {
            "pending"
        } else {
            "current"
        };
        Ok(
            serde_json::json!({"configuration":row.document,"effective_state":{"status":status,"stored_version":row.version,"applied_versions":{"collector":applied[0].applied_version,"processor":applied[1].applied_version,"analytics_api":applied[2].applied_version}}}),
        )
    }

    pub(crate) async fn policy_response(
        &self,
        row: &ConfigurationDocument,
    ) -> Result<Value, ConfigurationStoreError> {
        let site_id = row.document["site_id"]
            .as_str()
            .ok_or(ConfigurationStoreError::Unavailable)?;
        let environment = row.document["environment"]
            .as_str()
            .ok_or(ConfigurationStoreError::Unavailable)?;
        let view = self.validate_stored_policy(row, site_id, environment)?;
        let applied = self
            .repository
            .collector_applied_state(site_id, environment, row.version)
            .await
            .unwrap_or(AppliedState {
                status: "pending",
                applied_version: None,
            });
        let keys = view
            .ingest_keys
            .into_iter()
            .map(|key| serde_json::json!({"key_id":key.key_id,"created_at":key.created_at}))
            .collect::<Vec<_>>();
        Ok(
            serde_json::json!({"policy":{"site_id":view.site_id,"environment":view.environment,"version":view.version,"enabled":view.enabled,"allowed_origins":view.allowed_origins,"keys":keys,"rate_limit_per_minute":view.rate_limit_per_minute},"effective_state":{"status":applied.status,"stored_version":row.version,"applied_versions":{"collector":applied.applied_version,"processor":null,"analytics_api":null}}}),
        )
    }

    pub(crate) fn validate_stored_policy(
        &self,
        row: &ConfigurationDocument,
        site_id: &str,
        environment: &str,
    ) -> Result<configuration_runtime::EnvironmentPolicyView, ConfigurationStoreError> {
        if self
            .validators
            .stored_policy
            .iter_errors(&row.document)
            .next()
            .is_some()
            || row.document["site_id"].as_str() != Some(site_id)
            || row.document["environment"].as_str() != Some(environment)
            || row.document["version"].as_i64() != Some(row.version)
        {
            return Err(ConfigurationStoreError::Unavailable);
        }
        configuration_runtime::EnvironmentPolicyView::parse_validated(
            &row.document,
            site_id,
            environment,
            row.version,
        )
        .map_err(|_| ConfigurationStoreError::Unavailable)
    }

    fn validate_schema(
        &self,
        validator: &jsonschema::Validator,
        value: &Value,
    ) -> Result<(), ConfigurationStoreError> {
        if let Some(error) = validator.iter_errors(value).next() {
            return Err(ConfigurationStoreError::Validation {
                path: error.instance_path().to_string(),
                code: "schema_validation",
                message: "Value does not match the configuration schema.",
            });
        }
        Ok(())
    }
    pub(crate) async fn create_capabilities(
        &self,
        site_id: &str,
        value: Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        self.repository.create_capabilities(site_id, value).await
    }
    pub(crate) async fn update_capabilities(
        &self,
        site_id: &str,
        version: i64,
        value: Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        self.repository
            .update_capabilities(site_id, version, value)
            .await
    }
    pub(crate) async fn get_ingest_policy(
        &self,
        site_id: &str,
        environment: &str,
    ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError> {
        self.repository
            .get_ingest_policy(site_id, environment)
            .await
    }
    pub(crate) async fn create_ingest_policy(
        &self,
        site_id: &str,
        environment: &str,
        enabled: bool,
        origins: Value,
        rate_limit: i64,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        self.repository
            .create_ingest_policy(site_id, environment, enabled, origins, rate_limit)
            .await
    }
    pub(crate) async fn update_ingest_policy(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
        enabled: bool,
        origins: Value,
        rate_limit: i64,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        self.repository
            .update_ingest_policy(site_id, environment, version, enabled, origins, rate_limit)
            .await
    }
    pub(crate) async fn issue_ingest_key(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
    ) -> Result<IssuedIngestKey, ConfigurationStoreError> {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        use getrandom::fill;
        let mut key_bytes = [0_u8; 32];
        let mut id_bytes = [0_u8; 12];
        fill(&mut key_bytes).map_err(|_| ConfigurationStoreError::Unavailable)?;
        fill(&mut id_bytes).map_err(|_| ConfigurationStoreError::Unavailable)?;
        let key = URL_SAFE_NO_PAD.encode(key_bytes);
        let key_id = format!("ik_{}", URL_SAFE_NO_PAD.encode(id_bytes));
        let digest = sha256_hex(key.as_bytes());
        let created_at = Utc::now();
        let document = self
            .repository
            .create_ingest_key(site_id, environment, version, &key_id, &digest, created_at)
            .await?;
        Ok(IssuedIngestKey {
            document,
            key,
            key_id,
            created_at,
        })
    }
    pub(crate) async fn revoke_ingest_key(
        &self,
        site_id: &str,
        environment: &str,
        version: i64,
        key_id: &str,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        self.repository
            .revoke_ingest_key(site_id, environment, version, key_id)
            .await
    }
    pub(crate) async fn get_definition_set(
        &self,
        site_id: &str,
    ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError> {
        self.repository.get_definition_set(site_id).await
    }
    pub(crate) async fn create_definition_set(
        &self,
        site_id: &str,
        value: Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        self.repository.create_definition_set(site_id, value).await
    }
    pub(crate) async fn update_definition_set(
        &self,
        site_id: &str,
        version: i64,
        value: Value,
    ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
        self.repository
            .update_definition_set(site_id, version, value)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct FakeRepository {
        created: Mutex<Option<RepositorySiteCreationResult>>,
        site: Mutex<Option<Site>>,
        capability_applied: Mutex<std::collections::VecDeque<Option<AppliedState>>>,
    }

    fn unavailable<T>() -> Result<T, SiteManagementError> {
        Err(SiteManagementError::Unavailable)
    }
    fn config_unavailable<T>() -> Result<T, ConfigurationStoreError> {
        Err(ConfigurationStoreError::Unavailable)
    }

    #[async_trait::async_trait]
    impl SiteManagementRepository for FakeRepository {
        async fn list_sites(
            &self,
            _: Option<String>,
            _: i64,
        ) -> Result<Vec<Site>, SiteManagementError> {
            Ok(vec![])
        }
        async fn get_site(&self, _: &str) -> Result<Option<Site>, SiteManagementError> {
            Ok(self.site.lock().unwrap().clone())
        }
        async fn update_metadata(
            &self,
            _: &str,
            _: i64,
            _: Option<String>,
            _: Option<String>,
            _: Vec<String>,
        ) -> Result<Site, SiteManagementError> {
            unavailable()
        }
        async fn update_lifecycle(
            &self,
            _: &str,
            _: i64,
            _: &str,
        ) -> Result<Site, SiteManagementError> {
            unavailable()
        }
        async fn create_site(
            &self,
            _: SiteCreation,
        ) -> Result<RepositorySiteCreationResult, SiteManagementError> {
            self.created
                .lock()
                .unwrap()
                .take()
                .ok_or(SiteManagementError::Unavailable)
        }
        async fn get_capabilities(
            &self,
            _: &str,
        ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn create_capabilities(
            &self,
            _: &str,
            _: Value,
        ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn update_capabilities(
            &self,
            _: &str,
            _: i64,
            _: Value,
        ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn get_ingest_policy(
            &self,
            _: &str,
            _: &str,
        ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn create_ingest_policy(
            &self,
            _: &str,
            _: &str,
            _: bool,
            _: Value,
            _: i64,
        ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn update_ingest_policy(
            &self,
            _: &str,
            _: &str,
            _: i64,
            _: bool,
            _: Value,
            _: i64,
        ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn create_ingest_key(
            &self,
            _: &str,
            _: &str,
            _: i64,
            _: &str,
            _: &str,
            _: DateTime<Utc>,
        ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn revoke_ingest_key(
            &self,
            _: &str,
            _: &str,
            _: i64,
            _: &str,
        ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn get_definition_set(
            &self,
            _: &str,
        ) -> Result<Option<ConfigurationDocument>, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn create_definition_set(
            &self,
            _: &str,
            _: Value,
        ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn update_definition_set(
            &self,
            _: &str,
            _: i64,
            _: Value,
        ) -> Result<ConfigurationDocument, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn collector_applied_state(
            &self,
            _: &str,
            _: &str,
            _: i64,
        ) -> Result<AppliedState, ConfigurationStoreError> {
            config_unavailable()
        }
        async fn capability_applied_state(
            &self,
            _: &str,
            _: &str,
            _: i64,
        ) -> Result<AppliedState, ConfigurationStoreError> {
            self.capability_applied
                .lock()
                .unwrap()
                .pop_front()
                .flatten()
                .ok_or(ConfigurationStoreError::Unavailable)
        }
    }

    fn service(fake: Arc<FakeRepository>) -> SiteManagementService {
        SiteManagementService::new(
            fake,
            Arc::new(CapabilityRegistry::canonical().unwrap()),
            crate::application::site_management_validation::ConfigurationValidators::new().unwrap(),
        )
    }

    fn site() -> Site {
        Site {
            site_id: "site_01".into(),
            display_name: Some("Example".into()),
            website_url: Some("https://example.test/".into()),
            lifecycle_status: "active".into(),
            setup_status: "ready".into(),
            missing_requirements: vec![],
            version: 1,
            created_at: Utc.timestamp_opt(1, 0).unwrap(),
            updated_at: Utc.timestamp_opt(1, 0).unwrap(),
        }
    }

    #[test]
    fn list_arguments_enforce_repository_bounds() {
        assert!(validate_list_arguments(&None, 1).is_ok());
        assert!(validate_list_arguments(&Some("site_01".into()), 101).is_ok());
        assert!(matches!(
            validate_list_arguments(&None, 0),
            Err(SiteManagementError::InvalidMetadata("/limit"))
        ));
        assert!(matches!(
            validate_list_arguments(&Some(String::new()), 1),
            Err(SiteManagementError::InvalidMetadata("/cursor"))
        ));
    }

    #[tokio::test]
    async fn create_site_rejects_invalid_input_before_repository_call() {
        let fake = Arc::new(FakeRepository::default());
        let result = service(fake.clone()).create_site("request-1".into(), serde_json::json!({"display_name":"", "website_url":"https://example.test", "environment":"production", "allowed_origins":["https://example.test"]})).await;
        assert!(matches!(
            result,
            Err(SiteManagementError::Validation { .. })
        ));
        assert!(fake.created.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn create_site_replay_rejects_a_different_normalized_request_digest() {
        let fake = Arc::new(FakeRepository::default());
        *fake.site.lock().unwrap() = Some(site());
        *fake.created.lock().unwrap() = Some(RepositorySiteCreationResult::Existing {
            site_id: "site_01".into(),
            request_digest: "wrong".into(),
        });
        let body = serde_json::json!({"display_name":" Example ", "website_url":"https://example.test/#top", "environment":"production", "allowed_origins":["https://example.test/"], "capabilities":{}});
        assert!(matches!(
            service(fake.clone())
                .create_site("request-1".into(), body)
                .await,
            Err(SiteManagementError::IdempotencyConflict)
        ));
    }

    #[tokio::test]
    async fn create_site_replay_returns_existing_site_without_issuing_a_key() {
        let fake = Arc::new(FakeRepository::default());
        *fake.site.lock().unwrap() = Some(site());
        let body = serde_json::json!({"display_name":" Example ", "website_url":"https://example.test/#top", "environment":"production", "allowed_origins":["https://example.test/"], "capabilities":{}});
        let request: SiteCreateRequest = serde_json::from_value(body.clone()).unwrap();
        let digest = normalize_site_request(request, &CapabilityRegistry::canonical().unwrap())
            .unwrap()
            .digest;
        *fake.created.lock().unwrap() = Some(RepositorySiteCreationResult::Existing {
            site_id: "site_01".into(),
            request_digest: digest,
        });
        assert!(matches!(
            service(fake).create_site("request-1".into(), body).await,
            Ok(SiteCreationResult::Existing(_))
        ));
    }

    #[tokio::test]
    async fn first_site_creation_returns_generated_key_only_with_created_outcome() {
        let fake = Arc::new(FakeRepository::default());
        *fake.created.lock().unwrap() = Some(RepositorySiteCreationResult::Created(site()));
        let body = serde_json::json!({"display_name":"Example", "website_url":"https://example.test/", "environment":"production", "allowed_origins":["https://example.test"], "capabilities":{}});
        let result = service(fake)
            .create_site("request-1".into(), body)
            .await
            .unwrap();
        match result {
            SiteCreationResult::Created { key, key_id, .. } => {
                assert_eq!(key.len(), 43);
                assert!(key_id.starts_with("ik_"));
            }
            SiteCreationResult::Existing(_) => {
                panic!("first create must return generated ingest key")
            }
        }
    }

    #[test]
    fn application_configuration_validators_enforce_capabilities_origins_and_sensitive_fields() {
        let service = service(Arc::new(FakeRepository::default()));
        let capabilities: Value = serde_json::from_str(include_str!("../../../../protocol/contracts/configuration/current/fixtures/capability-update/valid/all-enabled.json")).unwrap();
        assert!(service.validate_capabilities(capabilities).is_ok());
        let mut disabled_page_views: Value = serde_json::from_str(include_str!("../../../../protocol/contracts/configuration/current/fixtures/capability-update/valid/all-enabled.json")).unwrap();
        disabled_page_views["capabilities"]["page_views"]["enabled"] = Value::Bool(false);
        assert!(matches!(
            service.validate_capabilities(disabled_page_views),
            Err(ConfigurationStoreError::Validation {
                code: "required_capability",
                ..
            })
        ));
        assert!(matches!(
            service.normalize_policy_origins(&["https://example.test/a".into()]),
            Err(ConfigurationStoreError::Validation {
                code: "invalid_origin",
                ..
            })
        ));
        let mut definitions: Value = serde_json::from_str(include_str!("../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/valid/definitions.json")).unwrap();
        let property_set = definitions["conversions"][0]["properties"].as_object_mut();
        if let Some(properties) = property_set {
            properties.insert("email".into(), Value::String("x".into()));
        }
        assert!(matches!(
            service.validate_definition_set(definitions),
            Err(ConfigurationStoreError::Validation {
                code: "sensitive_property_forbidden",
                ..
            })
        ));
    }

    #[tokio::test]
    async fn capability_response_uses_all_applied_states_only_when_every_query_succeeds() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/capabilities/valid/legacy-enabled.json"
        ))
        .unwrap();
        let row = ConfigurationDocument {
            version: 1,
            document: fixture,
        };

        let successful = Arc::new(FakeRepository::default());
        *successful.capability_applied.lock().unwrap() = [
            Some(AppliedState {
                status: "current",
                applied_version: Some(1),
            }),
            Some(AppliedState {
                status: "stale",
                applied_version: Some(0),
            }),
            Some(AppliedState {
                status: "current",
                applied_version: Some(1),
            }),
        ]
        .into();
        let response = service(successful).capability_response(&row).await.unwrap();
        assert_eq!(response["effective_state"]["status"], "stale");
        assert_eq!(
            response["effective_state"]["applied_versions"]["processor"],
            0
        );

        for failed_query in 0..3 {
            let fake = Arc::new(FakeRepository::default());
            let states = (0..3)
                .map(|query| {
                    (query != failed_query).then_some(AppliedState {
                        status: "current",
                        applied_version: Some(1),
                    })
                })
                .collect::<Vec<_>>();
            *fake.capability_applied.lock().unwrap() = states.into();
            let response = service(fake).capability_response(&row).await.unwrap();
            assert_eq!(response["effective_state"]["status"], "pending");
            assert_eq!(
                response["effective_state"]["applied_versions"]["collector"],
                Value::Null
            );
            assert_eq!(
                response["effective_state"]["applied_versions"]["processor"],
                Value::Null
            );
            assert_eq!(
                response["effective_state"]["applied_versions"]["analytics_api"],
                Value::Null
            );
        }
    }
}
