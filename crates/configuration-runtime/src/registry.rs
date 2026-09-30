use std::collections::{HashMap, HashSet};
use std::str::FromStr;

use jsonschema::Draft;
use serde::Deserialize;

const MANIFEST: &str = include_str!("../../../protocol/capabilities/capabilities.json");
const MANIFEST_SCHEMA: &str =
    include_str!("../../../protocol/capabilities/capability-contract.schema.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityId {
    PageViews,
    BrowserContext,
    AnonymousVisitors,
    Sessions,
    Dimensions,
    CustomEvents,
    WebVitals,
    Conversions,
    Funnels,
    Geo,
}

impl CapabilityId {
    pub const ALL: [Self; 10] = [
        Self::PageViews,
        Self::BrowserContext,
        Self::AnonymousVisitors,
        Self::Sessions,
        Self::Dimensions,
        Self::CustomEvents,
        Self::WebVitals,
        Self::Conversions,
        Self::Funnels,
        Self::Geo,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PageViews => "page_views",
            Self::BrowserContext => "browser_context",
            Self::AnonymousVisitors => "anonymous_visitors",
            Self::Sessions => "sessions",
            Self::Dimensions => "dimensions",
            Self::CustomEvents => "custom_events",
            Self::WebVitals => "web_vitals",
            Self::Conversions => "conversions",
            Self::Funnels => "funnels",
            Self::Geo => "geo",
        }
    }
}

impl FromStr for CapabilityId {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|capability| capability.as_str() == value)
            .ok_or(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityStatus {
    Implemented,
    Planned,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeCapability {
    pub id: CapabilityId,
    pub status: CapabilityStatus,
    pub depends_on: Vec<CapabilityId>,
}

#[derive(Debug, Clone)]
pub struct CapabilityRegistry {
    capabilities: HashMap<CapabilityId, RuntimeCapability>,
    order: Vec<CapabilityId>,
}

#[derive(Debug)]
pub enum CapabilityRegistryError {
    Json(serde_json::Error),
    Schema(String),
    UnsupportedSchemaVersion(u8),
    InvalidCount { expected: usize, actual: usize },
    DuplicateId(String),
    UnknownDependency(String, String),
    PlannedRuntimeSurface(String),
    DependencyCycle,
    RuntimeIdDrift,
}

#[derive(Deserialize)]
struct Manifest {
    capability_schema_version: u8,
    capabilities: Vec<ManifestCapability>,
}

#[derive(Deserialize)]
struct ManifestCapability {
    id: CapabilityId,
    status: CapabilityStatus,
    depends_on: Vec<CapabilityId>,
    api: serde_json::Value,
    dashboard: serde_json::Value,
}

impl CapabilityRegistry {
    pub fn canonical() -> Result<Self, CapabilityRegistryError> {
        Self::from_json(MANIFEST)
    }

    pub fn from_json(json: &str) -> Result<Self, CapabilityRegistryError> {
        let value: serde_json::Value = serde_json::from_str(json)?;
        let schema: serde_json::Value = serde_json::from_str(MANIFEST_SCHEMA)?;
        let validator = jsonschema::options()
            .with_draft(Draft::Draft202012)
            .build(&schema)
            .map_err(|error| CapabilityRegistryError::Schema(error.to_string()))?;
        if validator.validate(&value).is_err() {
            return Err(CapabilityRegistryError::Schema(
                validator
                    .iter_errors(&value)
                    .map(|error| error.to_string())
                    .collect::<Vec<_>>()
                    .join("; "),
            ));
        }
        let manifest: Manifest = serde_json::from_value(value)?;
        if manifest.capability_schema_version != 1 {
            return Err(CapabilityRegistryError::UnsupportedSchemaVersion(
                manifest.capability_schema_version,
            ));
        }
        if manifest.capabilities.len() != CapabilityId::ALL.len() {
            return Err(CapabilityRegistryError::InvalidCount {
                expected: CapabilityId::ALL.len(),
                actual: manifest.capabilities.len(),
            });
        }
        let mut capabilities = HashMap::new();
        let mut order = Vec::with_capacity(manifest.capabilities.len());
        for capability in manifest.capabilities {
            let id = capability.id;
            order.push(id);
            if capabilities
                .insert(
                    id,
                    RuntimeCapability {
                        id,
                        status: capability.status,
                        depends_on: capability.depends_on,
                    },
                )
                .is_some()
            {
                return Err(CapabilityRegistryError::DuplicateId(id.as_str().to_owned()));
            }
            if capability.status == CapabilityStatus::Planned
                && (!has_string_field(&capability.api, "query_surface", "future_report")
                    || !has_empty_array_field(&capability.api, "routes")
                    || !has_string_field(&capability.dashboard, "surface", "future_report"))
            {
                return Err(CapabilityRegistryError::PlannedRuntimeSurface(
                    id.as_str().to_owned(),
                ));
            }
        }

        let expected: HashSet<_> = CapabilityId::ALL.into_iter().collect();
        let actual: HashSet<_> = capabilities.keys().copied().collect();
        if expected != actual {
            return Err(CapabilityRegistryError::RuntimeIdDrift);
        }
        for capability in capabilities.values() {
            for dependency in &capability.depends_on {
                if !capabilities.contains_key(dependency) {
                    return Err(CapabilityRegistryError::UnknownDependency(
                        capability.id.as_str().to_owned(),
                        dependency.as_str().to_owned(),
                    ));
                }
            }
        }
        if has_dependency_cycle(&capabilities) {
            return Err(CapabilityRegistryError::DependencyCycle);
        }
        Ok(Self {
            capabilities,
            order,
        })
    }

    pub fn get(&self, id: CapabilityId) -> Option<&RuntimeCapability> {
        self.capabilities.get(&id)
    }

    pub fn dependencies(&self, id: CapabilityId) -> &[CapabilityId] {
        self.get(id)
            .map_or(&[], |capability| &capability.depends_on)
    }

    pub fn is_implemented(&self, id: CapabilityId) -> bool {
        matches!(
            self.get(id).map(|capability| capability.status),
            Some(CapabilityStatus::Implemented)
        )
    }

    pub fn ids(&self) -> impl Iterator<Item = CapabilityId> + '_ {
        self.order.iter().copied()
    }
}

fn has_string_field(value: &serde_json::Value, field: &str, expected: &str) -> bool {
    value.get(field).and_then(serde_json::Value::as_str) == Some(expected)
}

fn has_empty_array_field(value: &serde_json::Value, field: &str) -> bool {
    value
        .get(field)
        .and_then(serde_json::Value::as_array)
        .is_some_and(Vec::is_empty)
}

fn has_dependency_cycle(capabilities: &HashMap<CapabilityId, RuntimeCapability>) -> bool {
    fn visit(
        id: CapabilityId,
        capabilities: &HashMap<CapabilityId, RuntimeCapability>,
        visiting: &mut HashSet<CapabilityId>,
        visited: &mut HashSet<CapabilityId>,
    ) -> bool {
        if visiting.contains(&id) {
            return true;
        }
        if visited.contains(&id) {
            return false;
        }
        visiting.insert(id);
        if capabilities.get(&id).is_some_and(|entry| {
            entry
                .depends_on
                .iter()
                .any(|dep| visit(*dep, capabilities, visiting, visited))
        }) {
            return true;
        }
        visiting.remove(&id);
        visited.insert(id);
        false
    }
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    capabilities
        .keys()
        .copied()
        .any(|id| visit(id, capabilities, &mut visiting, &mut visited))
}

impl From<serde_json::Error> for CapabilityRegistryError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl std::fmt::Display for CapabilityRegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for CapabilityRegistryError {}

#[cfg(test)]
mod tests {
    use super::{CapabilityId, CapabilityRegistry, CapabilityRegistryError, CapabilityStatus};

    #[test]
    fn canonical_registry_matches_runtime_ids_and_manifest_dependencies() {
        let registry = CapabilityRegistry::canonical().unwrap();
        let mut ids = registry.ids().map(CapabilityId::as_str).collect::<Vec<_>>();
        ids.sort_unstable();
        let mut expected = CapabilityId::ALL.map(CapabilityId::as_str).to_vec();
        expected.sort_unstable();
        assert_eq!(ids, expected);
        assert_eq!(
            registry.dependencies(CapabilityId::Sessions),
            &[CapabilityId::AnonymousVisitors]
        );
        assert!(registry.is_implemented(CapabilityId::PageViews));
    }

    #[test]
    fn rejects_unsupported_manifest_versions_and_unknown_fields() {
        let canonical: serde_json::Value = serde_json::from_str(include_str!(
            "../../../protocol/capabilities/capabilities.json"
        ))
        .unwrap();
        let mut unsupported = canonical.clone();
        unsupported["capability_schema_version"] = serde_json::json!(2);
        assert!(CapabilityRegistry::from_json(&unsupported.to_string()).is_err());
        let mut unknown = canonical;
        unknown["unexpected"] = serde_json::json!(true);
        assert!(matches!(
            CapabilityRegistry::from_json(&unknown.to_string()),
            Err(CapabilityRegistryError::Schema(_))
        ));
    }

    #[test]
    fn rejects_duplicate_ids_unknown_dependencies_cycles_and_planned_runtime_surfaces() {
        let canonical: serde_json::Value = serde_json::from_str(include_str!(
            "../../../protocol/capabilities/capabilities.json"
        ))
        .unwrap();
        let mut duplicate = canonical.clone();
        duplicate["capabilities"][1]["id"] = serde_json::json!("page_views");
        assert!(matches!(
            CapabilityRegistry::from_json(&duplicate.to_string()),
            Err(CapabilityRegistryError::DuplicateId(_))
        ));

        let mut unknown = canonical.clone();
        unknown["capabilities"][1]["depends_on"] = serde_json::json!(["not_real"]);
        assert!(matches!(
            CapabilityRegistry::from_json(&unknown.to_string()),
            Err(CapabilityRegistryError::Schema(_))
        ));

        let mut cycle = canonical.clone();
        cycle["capabilities"][0]["depends_on"] = serde_json::json!(["browser_context"]);
        assert!(matches!(
            CapabilityRegistry::from_json(&cycle.to_string()),
            Err(CapabilityRegistryError::DependencyCycle)
        ));

        let mut planned = canonical;
        planned["capabilities"][0]["status"] = serde_json::json!("planned");
        planned["capabilities"][0]["api"]["query_surface"] = serde_json::json!("overview");
        assert!(matches!(
            CapabilityRegistry::from_json(&planned.to_string()),
            Err(CapabilityRegistryError::PlannedRuntimeSurface(_))
        ));
        assert_eq!(
            CapabilityStatus::Implemented,
            CapabilityRegistry::canonical()
                .unwrap()
                .get(CapabilityId::PageViews)
                .unwrap()
                .status
        );
    }
}
