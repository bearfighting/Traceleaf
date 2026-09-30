use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};

use chrono::{DateTime, Utc};
use jsonschema::{Draft, Validator};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;

pub const REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const SCHEMA: &str =
    include_str!("../../../protocol/contracts/configuration/current/capabilities.schema.json");
const SERVICES: &[&str] = &["collector", "processor", "analytics_api"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapabilitySnapshot {
    pub site_id: String,
    pub version: i64,
    enabled: HashMap<String, bool>,
    enabled_since: HashMap<String, DateTime<Utc>>,
}

impl CapabilitySnapshot {
    pub fn enabled(&self, capability: &str) -> bool {
        self.enabled.get(capability).copied().unwrap_or(false)
    }

    pub fn enabled_since(&self, capability: &str) -> Option<DateTime<Utc>> {
        self.enabled_since.get(capability).copied()
    }

    fn with_activation_windows(
        mut self,
        windows: HashMap<String, DateTime<Utc>>,
    ) -> Result<Self, String> {
        for (capability, enabled) in &self.enabled {
            if *enabled && !windows.contains_key(capability) {
                return Err(format!("activation window is missing for {capability}"));
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
        let enabled: HashMap<String, bool> = stored
            .capabilities
            .into_iter()
            .map(|(name, state)| (name, state.enabled))
            .collect();
        if !enabled.get("page_views").copied().unwrap_or(false) {
            return Err("Page Views is a mandatory capability".into());
        }
        for (capability, dependency) in [
            ("browser_context", "page_views"),
            ("anonymous_visitors", "page_views"),
            ("sessions", "anonymous_visitors"),
            ("dimensions", "browser_context"),
            ("custom_events", "page_views"),
            ("web_vitals", "page_views"),
            ("conversions", "custom_events"),
            ("funnels", "conversions"),
            ("geo", "page_views"),
        ] {
            if enabled.get(capability).copied().unwrap_or(false)
                && !enabled.get(dependency).copied().unwrap_or(false)
            {
                return Err(format!("{capability} requires {dependency}"));
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
}

impl CapabilitySchemaValidator {
    pub fn new() -> Result<Self, String> {
        let schema: Value = serde_json::from_str(SCHEMA).map_err(|error| error.to_string())?;
        let validator = jsonschema::options()
            .with_draft(Draft::Draft202012)
            .build(&schema)
            .map_err(|error| error.to_string())?;
        Ok(Self { validator })
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

#[derive(Clone)]
pub struct CapabilityRuntime {
    pool: PgPool,
    service: &'static str,
    instance_id: String,
    validator: Arc<CapabilitySchemaValidator>,
    snapshots: Arc<RwLock<HashMap<String, CapabilitySnapshot>>>,
    stale_sites: Arc<RwLock<HashSet<String>>>,
    last_prune: Arc<std::sync::Mutex<Instant>>,
}

impl CapabilityRuntime {
    pub fn new(pool: PgPool, service: &'static str) -> Result<Self, String> {
        if !SERVICES.contains(&service) {
            return Err("unsupported configuration runtime service".into());
        }
        let validator = CapabilitySchemaValidator::new()?;
        let instance_id = format!(
            "{service}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_nanos()
        );
        Ok(Self {
            pool,
            service,
            instance_id,
            validator: Arc::new(validator),
            snapshots: Arc::new(RwLock::new(HashMap::new())),
            stale_sites: Arc::new(RwLock::new(HashSet::new())),
            last_prune: Arc::new(std::sync::Mutex::new(
                Instant::now() - Duration::from_secs(3600),
            )),
        })
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    pub fn snapshot(&self, site_id: &str) -> Option<CapabilitySnapshot> {
        self.snapshots
            .read()
            .expect("capability snapshot lock poisoned")
            .get(site_id)
            .cloned()
    }

    pub fn is_stale(&self, site_id: &str) -> bool {
        self.stale_sites
            .read()
            .expect("capability stale-state lock poisoned")
            .contains(site_id)
    }

    fn mark_snapshots_stale(&self) {
        let sites: Vec<_> = self
            .snapshots
            .read()
            .expect("capability snapshot lock poisoned")
            .keys()
            .cloned()
            .collect();
        self.stale_sites
            .write()
            .expect("capability stale-state lock poisoned")
            .extend(sites);
    }

    pub fn spawn(&self) {
        let runtime = self.clone();
        tokio::spawn(async move {
            loop {
                runtime.refresh_once().await;
                tokio::time::sleep(REFRESH_INTERVAL).await;
            }
        });
    }

    pub async fn refresh_once(&self) -> bool {
        let rows = sqlx::query_as::<_, (String, i64, Value)>(
            "SELECT site_id, version, document FROM site_capability_configurations ORDER BY site_id",
        )
        .fetch_all(&self.pool)
        .await;
        let rows = match rows {
            Ok(rows) => rows,
            Err(_) => {
                self.mark_snapshots_stale();
                tracing::warn!(
                    service = self.service,
                    "capability refresh failed; retaining last valid snapshot"
                );
                self.report_snapshot("stale").await;
                self.report_instance("stale").await;
                return false;
            }
        };

        let window_rows = match sqlx::query_as::<_, (String, String, DateTime<Utc>)>(
            "SELECT site_id, capability_id, enabled_since FROM site_capability_activation_windows",
        )
        .fetch_all(&self.pool)
        .await
        {
            Ok(rows) => rows,
            Err(_) => {
                self.mark_snapshots_stale();
                tracing::warn!(
                    service = self.service,
                    "capability activation window read failed; retaining last valid snapshot"
                );
                self.report_snapshot("stale").await;
                self.report_instance("stale").await;
                return false;
            }
        };
        let mut windows = HashMap::<String, HashMap<String, DateTime<Utc>>>::new();
        for (site_id, capability_id, enabled_since) in window_rows {
            windows
                .entry(site_id)
                .or_default()
                .insert(capability_id, enabled_since);
        }

        let previous = self
            .snapshots
            .read()
            .expect("capability snapshot lock poisoned")
            .clone();
        let mut next = HashMap::new();
        let mut invalid = false;
        let mut reports = Vec::with_capacity(rows.len());
        let mut stale_sites = HashSet::new();
        for (site_id, version, document) in rows {
            let activation_windows = windows.remove(&site_id).unwrap_or_default();
            let parsed =
                CapabilitySnapshot::from_document(&self.validator, &site_id, version, &document)
                    .and_then(|snapshot| snapshot.with_activation_windows(activation_windows));
            match parsed {
                Ok(snapshot) => {
                    reports.push((site_id.clone(), Some(version), "current"));
                    next.insert(site_id, snapshot);
                }
                Err(_) => {
                    stale_sites.insert(site_id.clone());
                    invalid = true;
                    if let Some(snapshot) = previous.get(&site_id) {
                        reports.push((site_id.clone(), Some(snapshot.version), "stale"));
                        next.insert(site_id, snapshot.clone());
                    } else {
                        reports.push((site_id, None, "stale"));
                    }
                }
            }
        }
        *self
            .snapshots
            .write()
            .expect("capability snapshot lock poisoned") = next;
        *self
            .stale_sites
            .write()
            .expect("capability stale-state lock poisoned") = stale_sites;
        // A document can be stale for one site while other site snapshots are current.
        // Keep document-level failures in the per-site rows; reserve the instance
        // status for failures that prevented the refresh cycle itself.
        let _ = invalid;
        self.report_instance("current").await;
        for (site_id, version, status) in reports {
            self.report_site(&site_id, version, status).await;
        }
        self.prune_old_status_rows().await;
        true
    }

    async fn prune_old_status_rows(&self) {
        let due = {
            let mut last = self
                .last_prune
                .lock()
                .expect("capability prune lock poisoned");
            if last.elapsed() >= Duration::from_secs(3600) {
                *last = Instant::now();
                true
            } else {
                false
            }
        };
        if due {
            let _ = sqlx::query("DELETE FROM configuration_capability_runtime_state WHERE last_seen_at < NOW() - INTERVAL '1 day'")
                .execute(&self.pool).await;
            let _ = sqlx::query("DELETE FROM configuration_capability_runtime_instances WHERE last_seen_at < NOW() - INTERVAL '1 day'")
                .execute(&self.pool).await;
        }
    }

    async fn report_snapshot(&self, status: &str) {
        let sites: Vec<_> = self
            .snapshots
            .read()
            .expect("capability snapshot lock poisoned")
            .values()
            .map(|snapshot| (snapshot.site_id.clone(), snapshot.version))
            .collect();
        for (site_id, version) in sites {
            self.report_site(&site_id, Some(version), status).await;
        }
    }

    async fn report_site(&self, site_id: &str, version: Option<i64>, status: &str) {
        if sqlx::query(
            "INSERT INTO configuration_capability_runtime_state
            (instance_id, service, site_id, applied_version, refresh_status, last_seen_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (service, instance_id, site_id) DO UPDATE SET
            applied_version = EXCLUDED.applied_version, refresh_status = EXCLUDED.refresh_status,
            last_seen_at = NOW()",
        )
        .bind(&self.instance_id)
        .bind(self.service)
        .bind(site_id)
        .bind(version)
        .bind(status)
        .execute(&self.pool)
        .await
        .is_err()
        {
            tracing::warn!(
                service = self.service,
                "capability applied-version report unavailable"
            );
        }
    }

    async fn report_instance(&self, status: &str) {
        if sqlx::query(
            "INSERT INTO configuration_capability_runtime_instances
            (instance_id, service, refresh_status, last_seen_at) VALUES ($1, $2, $3, NOW())
            ON CONFLICT (service, instance_id) DO UPDATE SET
            refresh_status = EXCLUDED.refresh_status, last_seen_at = NOW()",
        )
        .bind(&self.instance_id)
        .bind(self.service)
        .bind(status)
        .execute(&self.pool)
        .await
        .is_err()
        {
            tracing::warn!(
                service = self.service,
                "configuration runtime heartbeat unavailable"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use chrono::Utc;
    use serde_json::json;
    use sqlx::postgres::PgPoolOptions;
    use std::time::Duration;

    use super::{CapabilityRuntime, CapabilitySchemaValidator, CapabilitySnapshot};

    fn validator() -> CapabilitySchemaValidator {
        CapabilitySchemaValidator::new().unwrap()
    }

    fn document() -> serde_json::Value {
        json!({
            "schema_version": 1, "site_id": "site_a", "version": 3,
            "updated_at": "2026-09-25T00:00:00Z",
            "capabilities": {
                "page_views": {"enabled": true, "settings": {}},
                "browser_context": {"enabled": true, "settings": {}},
                "anonymous_visitors": {"enabled": false, "settings": {}},
                "sessions": {"enabled": false, "settings": {}},
                "dimensions": {"enabled": false, "settings": {}},
                "custom_events": {"enabled": true, "settings": {}},
                "web_vitals": {"enabled": true, "settings": {}},
                "conversions": {"enabled": true, "settings": {}},
                "funnels": {"enabled": true, "settings": {}},
                "geo": {"enabled": true, "settings": {}}
            },
            "consent_policy": "required",
            "privacy_constraints": ["no_ip_persistence", "no_fingerprinting", "consent_required"]
        })
    }

    #[test]
    fn validates_identity_and_exposes_per_site_flags() {
        let snapshot =
            CapabilitySnapshot::from_document(&validator(), "site_a", 3, &document()).unwrap();
        assert!(snapshot.enabled("page_views"));
        assert!(!snapshot.enabled("anonymous_visitors"));
        assert!(!snapshot.enabled("unknown"));
        assert!(CapabilitySnapshot::from_document(&validator(), "site_b", 3, &document()).is_err());
        assert!(CapabilitySnapshot::from_document(&validator(), "site_a", 2, &document()).is_err());
    }

    #[test]
    fn current_runtime_accepts_invalid_capability_date_time_until_rollout_gate_closes() {
        let validator = validator();
        let invalid_date: serde_json::Value = serde_json::from_str(include_str!(
            "../../../protocol/contracts/configuration/current/fixtures/capabilities/invalid/invalid-updated-at-date-time.json"
        ))
        .unwrap();
        assert!(
            CapabilitySnapshot::from_document(&validator, "site_playground", 1, &invalid_date)
                .is_ok()
        );
    }

    #[test]
    fn canonical_capability_fixtures_match_current_runtime_semantics() {
        let validator = validator();
        let fixture_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/contracts/configuration/current/fixtures/capabilities");
        for (directory, expected_valid) in [("valid", true), ("invalid", false)] {
            for entry in std::fs::read_dir(fixture_root.join(directory)).unwrap() {
                let path = entry.unwrap().path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                    continue;
                }
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default();
                let document: serde_json::Value =
                    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                let accepted =
                    CapabilitySnapshot::from_document(&validator, "site_playground", 1, &document)
                        .is_ok();
                let expected_current =
                    expected_valid || name == "invalid-updated-at-date-time.json";
                assert_eq!(accepted, expected_current, "fixture: {}", path.display());
            }
        }
    }

    #[test]
    fn rejects_schema_invalid_documents_with_the_injected_validator() {
        let validator = validator();
        let mut invalid = document();
        invalid["unexpected"] = serde_json::json!(true);
        assert!(CapabilitySnapshot::from_document(&validator, "site_a", 3, &invalid).is_err());
    }

    #[tokio::test]
    async fn processor_and_api_mark_retained_snapshot_stale_when_storage_is_unavailable() {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_millis(200))
            .connect_lazy("postgres://analytics:analytics@127.0.0.1:1/analytics")
            .unwrap();

        for service in ["processor", "analytics_api"] {
            let runtime = CapabilityRuntime::new(pool.clone(), service).unwrap();
            let snapshot =
                CapabilitySnapshot::from_document(&validator(), "site_a", 3, &document()).unwrap();
            let windows = snapshot
                .enabled
                .keys()
                .filter(|capability| snapshot.enabled(capability))
                .map(|capability| (capability.clone(), Utc::now()))
                .collect();
            let snapshot = snapshot.with_activation_windows(windows).unwrap();
            runtime
                .snapshots
                .write()
                .unwrap()
                .insert("site_a".to_owned(), snapshot.clone());

            assert!(!runtime.refresh_once().await);
            assert_eq!(runtime.snapshot("site_a"), Some(snapshot));
            assert!(runtime.is_stale("site_a"));
        }

        pool.close().await;
    }

    #[test]
    fn activation_windows_are_required_for_enabled_capabilities() {
        let snapshot =
            CapabilitySnapshot::from_document(&validator(), "site_a", 3, &document()).unwrap();
        assert!(
            snapshot
                .clone()
                .with_activation_windows(HashMap::new())
                .is_err()
        );
        let windows = snapshot
            .enabled
            .keys()
            .filter(|capability| snapshot.enabled(capability))
            .map(|capability| {
                (
                    capability.clone(),
                    chrono::DateTime::parse_from_rfc3339("2026-09-25T00:00:00Z")
                        .unwrap()
                        .with_timezone(&Utc),
                )
            })
            .collect();
        let snapshot = snapshot.with_activation_windows(windows).unwrap();
        assert!(snapshot.enabled_since("custom_events").is_some());
        assert_eq!(snapshot.enabled_since("anonymous_visitors"), None);
    }
}
