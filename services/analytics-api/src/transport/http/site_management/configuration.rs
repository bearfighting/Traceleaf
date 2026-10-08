use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header::ETAG},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
#[cfg(test)]
use url::Url;

use super::AdminAuth;
use crate::application::site_management::{
    ConfigurationDocument as ConfigurationRow, ConfigurationStoreError as StoreError,
};
use crate::application::site_management_state::SiteManagementState;
use crate::site_management::errors::ConfigurationApiError;
#[cfg(test)]
use crate::site_management::errors::ConfigurationValidationDetail;

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

mod preconditions;
use preconditions::{parse_if_match, require_if_none_match, response_with_etag};
mod validation;
#[cfg(test)]
pub(super) use validation::{
    validate_capability_dependencies, validate_policy_origins, validate_schema,
};
mod store_errors;
use store_errors::map_store_error;
mod projection;
#[cfg(test)]
use projection::validate_stored_capabilities;
use projection::{
    capability_response, policy_effective_state, policy_response, validate_stored_policy,
};
mod capabilities;
pub(super) use capabilities::{create_capabilities, get_capabilities, put_capabilities};
mod ingest_policy;
pub(super) use ingest_policy::{create_ingest_policy, get_ingest_policy, put_ingest_policy};
mod ingest_keys;
pub(super) use ingest_keys::{create_ingest_key, revoke_ingest_key};
mod definition_sets;
pub(super) use definition_sets::{create_definition_set, get_definition_set, put_definition_set};
#[cfg(test)]
use definition_sets::{validate_definition_set, validate_stored_definition_set};

#[cfg(test)]
mod tests;
