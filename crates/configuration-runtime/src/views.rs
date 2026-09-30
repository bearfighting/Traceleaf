use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnvironmentPolicyView {
    pub schema_version: u32,
    pub site_id: String,
    pub environment: String,
    pub version: i64,
    pub updated_at: String,
    pub enabled: bool,
    pub allowed_origins: Vec<String>,
    pub ingest_keys: Vec<IngestKeyView>,
    pub rate_limit_per_minute: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IngestKeyView {
    pub key_id: String,
    pub sha256_digest: String,
    pub created_at: String,
}

impl EnvironmentPolicyView {
    pub fn parse_validated(
        value: &Value,
        site_id: &str,
        environment: &str,
        version: i64,
    ) -> Result<Self, String> {
        let view: Self =
            serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
        if view.schema_version != 1
            || view.site_id != site_id
            || view.environment != environment
            || view.version != version
            || version < 1
            || view.rate_limit_per_minute < 1
        {
            return Err(
                "policy identity, schema version, or limits do not match the stored row".into(),
            );
        }
        Ok(view)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DefinitionRevisionView {
    pub schema_version: u32,
    pub site_id: String,
    pub revision: i64,
    pub definition_version: String,
    pub updated_at: String,
    pub effective_at: Option<String>,
    pub conversions: Vec<Value>,
    pub funnels: Vec<Value>,
}

pub fn is_valid_definition_version(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 64
}

impl DefinitionRevisionView {
    pub fn parse(
        value: &Value,
        site_id: &str,
        revision: Option<i64>,
        definition_version: Option<&str>,
    ) -> Result<Self, String> {
        let view: Self =
            serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
        if view.schema_version != 1
            || view.site_id != site_id
            || view.revision < 1
            || revision.is_some_and(|expected| expected != view.revision)
            || definition_version.is_some_and(|expected| expected != view.definition_version)
            || !is_valid_definition_version(&view.definition_version)
        {
            return Err("definition revision identity or metadata is invalid".into());
        }
        Ok(view)
    }
}

#[cfg(test)]
mod tests {
    use super::{DefinitionRevisionView, EnvironmentPolicyView};
    use serde_json::json;

    #[test]
    fn policy_view_checks_storage_identity_and_accepts_legacy_timestamp_format() {
        let document = json!({"schema_version":1,"site_id":"site_a","environment":"production","version":2,"updated_at":"legacy timestamp","enabled":true,"allowed_origins":["https://example.test"],"ingest_keys":[],"rate_limit_per_minute":600});
        assert!(
            EnvironmentPolicyView::parse_validated(&document, "site_a", "production", 2).is_ok()
        );
        assert!(
            EnvironmentPolicyView::parse_validated(&document, "site_b", "production", 2).is_err()
        );
        assert!(
            EnvironmentPolicyView::parse_validated(&document, "site_a", "production", 3).is_err()
        );
    }

    #[test]
    fn definition_revision_view_checks_identity_and_metadata() {
        let document = json!({"schema_version":1,"site_id":"site_a","revision":4,"definition_version":"r4-token","updated_at":"2026-09-30T00:00:00Z","effective_at":null,"conversions":[],"funnels":[]});
        assert!(
            DefinitionRevisionView::parse(&document, "site_a", Some(4), Some("r4-token")).is_ok()
        );
        assert!(
            DefinitionRevisionView::parse(&document, "site_b", Some(4), Some("r4-token")).is_err()
        );
        assert!(
            DefinitionRevisionView::parse(&document, "site_a", Some(3), Some("r4-token")).is_err()
        );
        let mut invalid_version = document.clone();
        invalid_version["definition_version"] = json!("   ");
        assert!(DefinitionRevisionView::parse(&invalid_version, "site_a", Some(4), None).is_err());
        invalid_version["definition_version"] = json!("v".repeat(65));
        assert!(DefinitionRevisionView::parse(&invalid_version, "site_a", Some(4), None).is_err());
    }
}
