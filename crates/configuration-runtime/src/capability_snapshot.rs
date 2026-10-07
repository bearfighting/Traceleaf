use std::{collections::HashMap, sync::Arc};

use chrono::{DateTime, Utc};
use jsonschema::{Draft, Validator};
use serde::Deserialize;
use serde_json::Value;

use crate::{CapabilityId, CapabilityRegistry};

const SCHEMA: &str =
    include_str!("../../../protocol/contracts/configuration/current/capabilities.schema.json");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapabilitySnapshot {
    pub site_id: String,
    pub version: i64,
    enabled: HashMap<CapabilityId, bool>,
    enabled_since: HashMap<CapabilityId, DateTime<Utc>>,
}

impl CapabilitySnapshot {
    pub fn enabled(&self, capability: CapabilityId) -> bool {
        self.enabled.get(&capability).copied().unwrap_or(false)
    }

    pub fn enabled_since(&self, capability: CapabilityId) -> Option<DateTime<Utc>> {
        self.enabled_since.get(&capability).copied()
    }

    pub(crate) fn with_activation_windows(
        mut self,
        windows: HashMap<CapabilityId, DateTime<Utc>>,
    ) -> Result<Self, String> {
        for (capability, enabled) in &self.enabled {
            if *enabled && !windows.contains_key(capability) {
                return Err(format!(
                    "activation window is missing for {}",
                    capability.as_str()
                ));
            }
        }
        self.enabled_since = windows;
        Ok(self)
    }

    pub fn from_document(
        validator: &CapabilitySchemaValidator,
        site_id: &str,
        version: i64,
        document: &Value,
    ) -> Result<Self, String> {
        if let Some(error) = validator.validator.iter_errors(document).next() {
            return Err(error.to_string());
        }
        let stored: StoredCapability =
            serde_json::from_value(document.clone()).map_err(|error| error.to_string())?;
        if stored.site_id != site_id || stored.version != version || version < 1 {
            return Err("capability identity or version does not match its storage row".into());
        }
        let enabled: HashMap<CapabilityId, bool> = stored
            .capabilities
            .into_iter()
            .map(|(name, state)| {
                name.parse::<CapabilityId>()
                    .map(|id| (id, state.enabled))
                    .map_err(|_| format!("unknown capability {name}"))
            })
            .collect::<Result<_, _>>()?;
        if !enabled
            .get(&CapabilityId::PageViews)
            .copied()
            .unwrap_or(false)
        {
            return Err("Page Views is a mandatory capability".into());
        }
        for capability in validator.registry.ids() {
            if enabled.get(&capability).copied().unwrap_or(false) {
                if !validator.registry.is_implemented(capability) {
                    return Err(format!(
                        "planned capability {} cannot be enabled",
                        capability.as_str()
                    ));
                }
                for dependency in validator.registry.dependencies(capability) {
                    if !enabled.get(dependency).copied().unwrap_or(false) {
                        return Err(format!(
                            "{} requires {}",
                            capability.as_str(),
                            dependency.as_str()
                        ));
                    }
                }
            }
        }
        Ok(Self {
            site_id: site_id.to_owned(),
            version,
            enabled,
            enabled_since: HashMap::new(),
        })
    }
}

#[derive(Clone)]
pub struct CapabilitySchemaValidator {
    validator: Validator,
    registry: Arc<CapabilityRegistry>,
}

impl CapabilitySchemaValidator {
    pub fn new() -> Result<Self, String> {
        let registry = CapabilityRegistry::canonical().map_err(|error| error.to_string())?;
        Self::with_registry(Arc::new(registry))
    }

    pub fn with_registry(registry: Arc<CapabilityRegistry>) -> Result<Self, String> {
        let schema: Value = serde_json::from_str(SCHEMA).map_err(|error| error.to_string())?;
        let validator = jsonschema::options()
            .with_draft(Draft::Draft202012)
            .should_validate_formats(true)
            .build(&schema)
            .map_err(|error| error.to_string())?;
        Ok(Self {
            validator,
            registry,
        })
    }
}

#[derive(Deserialize)]
struct StoredCapability {
    site_id: String,
    version: i64,
    capabilities: HashMap<String, StoredCapabilityState>,
}

#[derive(Deserialize)]
struct StoredCapabilityState {
    enabled: bool,
}

#[cfg(test)]
mod tests {
    use std::{path::Path, sync::Arc};

    use serde_json::json;

    use crate::{CapabilityId, CapabilityRegistry};

    use super::{CapabilitySchemaValidator, CapabilitySnapshot};

    fn validator() -> CapabilitySchemaValidator {
        CapabilitySchemaValidator::new().unwrap()
    }

    #[test]
    fn validates_identity_and_exposes_per_site_flags() {
        let validator = validator();
        let document = crate::test_support::capability_document();
        let snapshot =
            CapabilitySnapshot::from_document(&validator, "site_a", 3, &document).unwrap();
        assert!(snapshot.enabled(CapabilityId::PageViews));
        assert!(!snapshot.enabled(CapabilityId::AnonymousVisitors));
        assert!("unknown".parse::<CapabilityId>().is_err());
        assert!(CapabilitySnapshot::from_document(&validator, "site_b", 3, &document).is_err());
        assert!(CapabilitySnapshot::from_document(&validator, "site_a", 2, &document).is_err());
    }

    #[test]
    fn stored_snapshot_rejects_enabled_planned_capabilities() {
        let mut manifest: serde_json::Value = serde_json::from_str(include_str!(
            "../../../protocol/capabilities/capabilities.json"
        ))
        .unwrap();
        let geo = manifest["capabilities"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|entry| entry["id"] == "geo")
            .unwrap();
        geo["status"] = json!("planned");
        geo["api"]["query_surface"] = json!("future_report");
        geo["api"]["routes"] = json!([]);
        geo["dashboard"]["surface"] = json!("future_report");
        let registry = CapabilityRegistry::from_json(&manifest.to_string()).unwrap();
        let validator = CapabilitySchemaValidator::with_registry(Arc::new(registry)).unwrap();
        assert!(
            CapabilitySnapshot::from_document(
                &validator,
                "site_a",
                3,
                &crate::test_support::capability_document()
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_invalid_capability_date_time_after_preflight() {
        let validator = validator();
        let invalid_date: serde_json::Value = serde_json::from_str(include_str!(
            "../../../protocol/contracts/configuration/current/fixtures/capabilities/invalid/invalid-updated-at-date-time.json"
        ))
        .unwrap();
        assert!(
            CapabilitySnapshot::from_document(&validator, "site_playground", 1, &invalid_date)
                .is_err()
        );
    }

    #[test]
    fn canonical_capability_fixtures_match_current_runtime_semantics() {
        let validator = validator();
        let fixture_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/contracts/configuration/current/fixtures/capabilities");
        for (directory, expected_valid) in [("valid", true), ("invalid", false)] {
            for entry in std::fs::read_dir(fixture_root.join(directory)).unwrap() {
                let path = entry.unwrap().path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                    continue;
                }
                let document: serde_json::Value =
                    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                let accepted =
                    CapabilitySnapshot::from_document(&validator, "site_playground", 1, &document)
                        .is_ok();
                assert_eq!(accepted, expected_valid, "fixture: {}", path.display());
            }
        }
    }

    #[test]
    fn rejects_schema_invalid_documents_with_the_injected_validator() {
        let validator = validator();
        let mut invalid = crate::test_support::capability_document();
        invalid["unexpected"] = json!(true);
        assert!(CapabilitySnapshot::from_document(&validator, "site_a", 3, &invalid).is_err());
    }

    #[test]
    fn activation_windows_are_required_for_enabled_capabilities() {
        let snapshot = CapabilitySnapshot::from_document(
            &validator(),
            "site_a",
            3,
            &crate::test_support::capability_document(),
        )
        .unwrap();
        assert!(
            snapshot
                .clone()
                .with_activation_windows(Default::default())
                .is_err()
        );
        let windows = CapabilityId::ALL
            .into_iter()
            .filter(|capability| snapshot.enabled(*capability))
            .map(|capability| {
                (
                    capability,
                    chrono::DateTime::parse_from_rfc3339("2026-09-25T00:00:00Z")
                        .unwrap()
                        .with_timezone(&chrono::Utc),
                )
            })
            .collect();
        let snapshot = snapshot.with_activation_windows(windows).unwrap();
        assert!(snapshot.enabled_since(CapabilityId::CustomEvents).is_some());
        assert_eq!(
            snapshot.enabled_since(CapabilityId::AnonymousVisitors),
            None
        );
    }
}
