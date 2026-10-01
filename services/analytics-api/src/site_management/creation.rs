use std::{
    collections::BTreeMap,
    fmt::Write as _,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, ETAG},
    },
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use getrandom::fill as random_fill;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use ulid::Ulid;
use unicode_normalization::UnicodeNormalization;
use url::Url;

use crate::site_management::{
    auth::AdminAuth,
    configuration::{validate_capability_dependencies, validate_policy_origins, validate_schema},
    errors::{ConfigurationApiError, ConfigurationValidationDetail},
    site_store::{self, CreateSiteOutcome, CreateSiteRecords, CreateSiteStoreError},
    sites,
    state::SiteManagementState,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SiteCreateRequest {
    display_name: String,
    website_url: String,
    environment: String,
    #[serde(default)]
    capabilities: BTreeMap<String, bool>,
    allowed_origins: Vec<String>,
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
) -> ConfigurationApiError {
    ConfigurationApiError::Validation(vec![ConfigurationValidationDetail {
        path: path.into(),
        code,
        message,
    }])
}

fn idempotency_key(headers: &HeaderMap) -> Result<&str, ConfigurationApiError> {
    let value = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok());
    match value {
        Some(value)
            if (1..=128).contains(&value.len())
                && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) =>
        {
            Ok(value)
        }
        _ => Err(validation(
            "/headers/Idempotency-Key",
            "invalid_idempotency_key",
            "Idempotency-Key must contain 1 to 128 visible ASCII characters.",
        )),
    }
}

fn normalize_request(
    request: SiteCreateRequest,
    state: &SiteManagementState,
) -> Result<NormalizedSiteCreate, ConfigurationApiError> {
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

    let mut website = Url::parse(&request.website_url).map_err(|_| {
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

    // Reuse the policy validator for the shared HTTP(S), credential, path,
    // query, fragment, and canonical duplicate rules.
    validate_policy_origins(&request.allowed_origins)?;
    let mut allowed_origins = request
        .allowed_origins
        .iter()
        .map(|origin| {
            Url::parse(origin)
                .map(|url| url.origin().ascii_serialization())
                .map_err(|_| {
                    validation(
                        "/allowed_origins",
                        "invalid_origin",
                        "Allowed Origin is invalid.",
                    )
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    allowed_origins.sort();
    if !allowed_origins
        .iter()
        .any(|origin| origin == &website_origin)
    {
        return Err(validation(
            "/allowed_origins",
            "website_origin_required",
            "Allowed Origins must include the Website URL origin.",
        ));
    }

    let mut capabilities = Map::new();
    for capability in state.capabilities.ids() {
        let id = capability.as_str();
        let enabled = if id == "page_views" {
            true
        } else {
            request.capabilities.get(id).copied().unwrap_or(false)
        };
        capabilities.insert(id.to_owned(), json!({ "enabled": enabled, "settings": {} }));
    }
    let capabilities = Value::Object(capabilities);
    validate_capability_dependencies(
        &json!({ "capabilities": capabilities }),
        &state.capabilities,
    )?;

    let canonical_request = json!({
        "display_name": display_name,
        "website_url": website_url,
        "environment": request.environment,
        "capabilities": capabilities
            .as_object()
            .expect("normalized capabilities are an object")
            .iter()
            .map(|(id, capability)| (id.clone(), capability["enabled"].clone()))
            .collect::<Map<String, Value>>(),
        "allowed_origins": allowed_origins,
    });
    let canonical_json =
        serde_jcs::to_vec(&canonical_request).map_err(|_| ConfigurationApiError::Unavailable)?;
    let digest = digest_hex(&canonical_json);

    // Capabilities are stored in the configuration document shape, while the
    // request digest uses the frozen boolean-map shape.
    let normalized_capabilities = canonical_request["capabilities"]
        .as_object()
        .expect("normalized request capabilities are an object")
        .iter()
        .map(|(id, enabled)| (id.clone(), json!({"enabled":enabled,"settings":{}})))
        .collect::<Map<String, Value>>();

    Ok(NormalizedSiteCreate {
        display_name,
        website_url,
        environment: request.environment,
        capabilities: Value::Object(normalized_capabilities),
        allowed_origins: canonical_request["allowed_origins"].clone(),
        digest,
    })
}

fn digest_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn create_identifiers() -> Result<(String, String, String, String), ConfigurationApiError> {
    let mut ulid_random = [0_u8; 10];
    let mut key_bytes = [0_u8; 32];
    let mut key_id_bytes = [0_u8; 12];
    random_fill(&mut ulid_random).map_err(|_| ConfigurationApiError::Unavailable)?;
    random_fill(&mut key_bytes).map_err(|_| ConfigurationApiError::Unavailable)?;
    random_fill(&mut key_id_bytes).map_err(|_| ConfigurationApiError::Unavailable)?;

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ConfigurationApiError::Unavailable)?
        .as_millis() as u64;
    let mut random_part = [0_u8; 16];
    random_part[6..].copy_from_slice(&ulid_random);
    let site_id = format!(
        "site_{}",
        Ulid::from_parts(timestamp_ms, u128::from_be_bytes(random_part))
    );
    let key = URL_SAFE_NO_PAD.encode(key_bytes);
    let key_id = format!("ik_{}", URL_SAFE_NO_PAD.encode(key_id_bytes));
    let key_digest = digest_hex(key.as_bytes());
    Ok((site_id, key, key_id, key_digest))
}

fn response(status: StatusCode, version: i64, body: Value, no_store: bool) -> Response {
    let mut response = (status, Json(body)).into_response();
    response.headers_mut().insert(
        ETAG,
        HeaderValue::from_str(&format!("\"{version}\""))
            .expect("positive Site versions form valid ETags"),
    );
    if no_store {
        response
            .headers_mut()
            .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

pub(crate) async fn create_site(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    headers: HeaderMap,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    let idempotency_key = idempotency_key(&headers)?.to_owned();
    let Json(raw_request) = body.map_err(ConfigurationApiError::from)?;
    validate_schema(&state.validators.site_create, &raw_request, "")?;
    let request: SiteCreateRequest = serde_json::from_value(raw_request).map_err(|_| {
        validation(
            "",
            "invalid_body",
            "Request body does not match the Site creation contract.",
        )
    })?;
    let normalized = normalize_request(request, &state)?;
    let (site_id, key, key_id, key_digest) = create_identifiers()?;

    let outcome = site_store::create_site(
        &state.pool,
        CreateSiteRecords {
            site_id: &site_id,
            display_name: &normalized.display_name,
            website_url: &normalized.website_url,
            environment: &normalized.environment,
            idempotency_key: &idempotency_key,
            request_digest: &normalized.digest,
            key_id: &key_id,
            key_digest: &key_digest,
            capabilities: &normalized.capabilities,
            allowed_origins: &normalized.allowed_origins,
        },
    )
    .await
    .map_err(map_store_error)?;

    match outcome {
        CreateSiteOutcome::Created { site: managed_site } => Ok(response(
            StatusCode::CREATED,
            1,
            json!({
                "site": managed_site,
                "initial_environment": normalized.environment,
                "ingest_key": {"key": key, "key_id": key_id},
            }),
            true,
        )),
        CreateSiteOutcome::Existing {
            site_id: existing_site_id,
            request_digest,
        } => {
            if request_digest != normalized.digest {
                return Err(ConfigurationApiError::SiteIdempotencyConflict);
            }
            let managed_site = sites::read_managed_site(&state.pool, &existing_site_id).await?;
            let version = managed_site.version;
            Ok(response(
                StatusCode::OK,
                version,
                json!({"site":managed_site}),
                false,
            ))
        }
    }
}

fn map_store_error(error: CreateSiteStoreError) -> ConfigurationApiError {
    match error {
        CreateSiteStoreError::Database(error) => {
            tracing::error!(%error, "Site creation persistence failed");
            ConfigurationApiError::Unavailable
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{digest_hex, idempotency_key, normalize_request};
    use crate::site_management::state::SiteManagementState;
    use axum::http::{HeaderMap, HeaderValue};
    use configuration_runtime::CapabilityRegistry;
    use serde_json::{Value, json};
    use sha2::{Digest, Sha256};
    use sqlx::postgres::PgPoolOptions;
    use std::{collections::BTreeMap, sync::Arc};
    use unicode_normalization::UnicodeNormalization;

    fn state() -> SiteManagementState {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgres://invalid:invalid@127.0.0.1:1/invalid")
            .unwrap();
        SiteManagementState::new(pool, Arc::new(CapabilityRegistry::canonical().unwrap())).unwrap()
    }

    #[test]
    fn idempotency_key_requires_visible_ascii_within_contract_length() {
        let mut headers = HeaderMap::new();
        assert!(idempotency_key(&headers).is_err());
        headers.insert("idempotency-key", HeaderValue::from_static(" "));
        assert!(idempotency_key(&headers).is_err());
        headers.insert("idempotency-key", HeaderValue::from_static("valid-1"));
        assert_eq!(idempotency_key(&headers).unwrap(), "valid-1");
    }

    #[tokio::test]
    async fn normalization_matches_frozen_fixture_and_hashes_only_normalized_request() {
        let input: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/site-management-cases.json"
        ))
        .unwrap();
        let request: super::SiteCreateRequest =
            serde_json::from_value(input["normalization"]["input"].clone()).unwrap();
        let normalized = normalize_request(request, &state()).unwrap();
        let expected = &input["normalization"]["canonical"];
        assert_eq!(normalized.display_name, expected["display_name"]);
        assert_eq!(normalized.website_url, expected["website_url"]);
        assert_eq!(normalized.environment, expected["environment"]);
        assert_eq!(normalized.allowed_origins, expected["allowed_origins"]);
        let capability_flags = normalized
            .capabilities
            .as_object()
            .unwrap()
            .iter()
            .map(|(id, capability)| (id.clone(), capability["enabled"].clone()))
            .collect::<serde_json::Map<String, Value>>();
        assert_eq!(Value::Object(capability_flags), expected["capabilities"]);

        let canonical = json!({
            "display_name": expected["display_name"],
            "website_url": expected["website_url"],
            "environment": expected["environment"],
            "capabilities": expected["capabilities"],
            "allowed_origins": expected["allowed_origins"],
        });
        let expected_digest = digest_hex(&serde_jcs::to_vec(&canonical).unwrap());
        assert_eq!(normalized.digest, expected_digest);
    }

    #[tokio::test]
    async fn omitted_optional_capabilities_default_off_and_page_views_remain_on() {
        let request = super::SiteCreateRequest {
            display_name: "First Site".into(),
            website_url: "https://example.test".into(),
            environment: "production".into(),
            capabilities: BTreeMap::new(),
            allowed_origins: vec!["https://example.test".into()],
        };
        let normalized = normalize_request(request, &state()).unwrap();
        assert_eq!(normalized.capabilities["page_views"]["enabled"], true);
        for capability in normalized.capabilities.as_object().unwrap().keys() {
            if capability != "page_views" {
                assert_eq!(normalized.capabilities[capability]["enabled"], false);
            }
        }
    }

    #[tokio::test]
    async fn normalization_rejects_origin_mismatch_duplicate_origins_and_missing_dependencies() {
        let mut request = super::SiteCreateRequest {
            display_name: "First Site".into(),
            website_url: "https://example.test".into(),
            environment: "production".into(),
            capabilities: BTreeMap::new(),
            allowed_origins: vec!["https://other.test".into()],
        };
        assert!(normalize_request(request.clone(), &state()).is_err());

        request.allowed_origins = vec![
            "https://example.test".into(),
            "https://EXAMPLE.test:443/".into(),
        ];
        assert!(normalize_request(request.clone(), &state()).is_err());

        request.allowed_origins = vec!["https://example.test".into()];
        request.capabilities.insert("sessions".into(), true);
        assert!(normalize_request(request, &state()).is_err());
    }

    #[tokio::test]
    async fn normalization_rejects_names_that_exceed_limit_after_nfc() {
        let request = super::SiteCreateRequest {
            display_name: "\u{0344}".repeat(61),
            website_url: "https://example.test".into(),
            environment: "production".into(),
            capabilities: BTreeMap::new(),
            allowed_origins: vec!["https://example.test".into()],
        };
        assert_eq!(request.display_name.chars().count(), 61);
        assert_eq!(request.display_name.nfc().count(), 122);
        assert!(normalize_request(request, &state()).is_err());
    }

    #[test]
    fn digest_hex_is_lowercase_sha256() {
        let bytes = b"site request";
        let expected = Sha256::digest(bytes);
        assert_eq!(
            digest_hex(bytes),
            expected
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        );
    }
}
