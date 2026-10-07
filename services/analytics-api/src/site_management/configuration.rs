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

mod preconditions;
use preconditions::{parse_if_match, require_if_none_match, response_with_etag};
mod validation;
use validation::validate_identity;
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
