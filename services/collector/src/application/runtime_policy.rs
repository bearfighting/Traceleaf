#[allow(dead_code)]
#[path = "../generated/environment_policy.rs"]
mod generated_environment_policy;

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use crate::application::runtime_policy_repository::RuntimePolicyRepository;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use getrandom::fill as random_fill;
use jsonschema::{Draft, Validator};
use serde_json::Value;

use crate::domain::{
    config::{SiteConfig, SiteRegistry},
    security::KeyPolicy,
};

pub const CONFIG_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
pub const STATUS_HEARTBEAT_TTL: Duration = Duration::from_secs(15);
const STATUS_PRUNE_INTERVAL: Duration = Duration::from_secs(3600);
const STATUS_RETENTION: &str = "1 day";
const POLICY_SCHEMA: &str = include_str!(
    "../../../../protocol/contracts/configuration/current/environment-policy.schema.json"
);

type Identity = (String, String);

pub fn stored_policy_validator() -> Result<Validator, String> {
    let schema: Value = serde_json::from_str(POLICY_SCHEMA).map_err(|error| error.to_string())?;
    jsonschema::options()
        .with_draft(Draft::Draft202012)
        .should_validate_formats(true)
        .build(&schema)
        .map_err(|error| error.to_string())
}

use configuration_runtime::EnvironmentPolicyView as StoredPolicy;

#[derive(Debug, Clone)]
struct DatabasePolicy {
    site: SiteConfig,
    version: i64,
}

#[derive(Debug, Clone)]
struct Report {
    identity: Identity,
    applied_version: Option<i64>,
    stale: bool,
}

pub struct RuntimePolicyManager {
    repository: Arc<dyn RuntimePolicyRepository>,
    policy: KeyPolicy,
    validator: Validator,
    instance_id: String,
    last_database: Mutex<HashMap<Identity, DatabasePolicy>>,
    last_prune: Mutex<Instant>,
}

impl RuntimePolicyManager {
    pub fn with_repository(
        repository: Arc<dyn RuntimePolicyRepository>,
        policy: KeyPolicy,
        validator: Validator,
    ) -> Result<Arc<Self>, getrandom::Error> {
        let mut instance_bytes = [0_u8; 16];
        random_fill(&mut instance_bytes)?;
        Ok(Arc::new(Self {
            repository,
            policy,
            validator,
            instance_id: URL_SAFE_NO_PAD.encode(instance_bytes),
            last_database: Mutex::new(HashMap::new()),
            last_prune: Mutex::new(Instant::now() - STATUS_PRUNE_INTERVAL),
        }))
    }

    pub fn spawn(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                manager.refresh_once().await;
                tokio::time::sleep(CONFIG_REFRESH_INTERVAL).await;
            }
        });
    }

    pub async fn refresh_once(&self) -> bool {
        let rows = match self.repository.active_policies().await {
            Ok(rows) => rows,
            Err(_) => {
                tracing::warn!(
                    "configuration refresh failed; retaining last valid Collector policy"
                );
                self.report_last_database_as_stale().await;
                self.write_instance_status("stale").await;
                return false;
            }
        };

        let mut parsed = Vec::with_capacity(rows.len());
        let mut invalid = HashSet::new();
        let mut present = HashSet::new();
        for row in rows {
            let site_id = row.site_id;
            let environment = row.environment;
            let version = row.version;
            let document = row.document;
            let identity = (site_id.clone(), environment.clone());
            present.insert(identity.clone());
            match parse_database_policy(&self.validator, &site_id, &environment, version, &document)
            {
                Ok(policy) => parsed.push(policy),
                Err(()) => {
                    tracing::warn!(
                        "invalid stored environment policy; retaining last valid policy"
                    );
                    invalid.insert(identity);
                }
            }
        }

        let previous = self
            .last_database
            .lock()
            .expect("policy state lock poisoned")
            .clone();
        let (next_database, reports, removed) =
            reconcile_snapshot(&previous, parsed, invalid, &present);
        let mut effective_sites: Vec<_> = next_database
            .values()
            .map(|policy| policy.site.clone())
            .collect();
        effective_sites.sort_by(|a, b| {
            (a.site_id.as_str(), a.environment.as_str())
                .cmp(&(b.site_id.as_str(), b.environment.as_str()))
        });
        match SiteRegistry::from_runtime_sites(effective_sites) {
            Ok(registry) => self.policy.replace_registry(registry),
            Err(_) => {
                tracing::error!("effective Collector policy snapshot failed validation");
                self.report_last_database_as_stale().await;
                self.write_instance_status("stale").await;
                return false;
            }
        }

        *self
            .last_database
            .lock()
            .expect("policy state lock poisoned") = next_database;

        for identity in removed {
            self.clear_report(&identity).await;
        }
        for report in reports {
            self.write_report(&report).await;
        }
        self.write_instance_status("current").await;
        self.prune_expired_status_rows().await;
        true
    }

    async fn report_last_database_as_stale(&self) {
        let previous = self
            .last_database
            .lock()
            .expect("policy state lock poisoned")
            .clone();
        for (identity, row) in previous {
            self.write_report(&Report {
                identity,
                applied_version: Some(row.version),
                stale: true,
            })
            .await;
        }
    }

    async fn write_report(&self, report: &Report) {
        let status = if report.stale { "stale" } else { "current" };
        let result = self
            .repository
            .record_applied_policy(
                &self.instance_id,
                &report.identity.0,
                &report.identity.1,
                report.applied_version,
                status,
            )
            .await;
        if result.is_err() {
            tracing::warn!("Collector applied-version report unavailable");
        }
    }

    async fn clear_report(&self, identity: &Identity) {
        let result = self
            .repository
            .delete_applied_policy(&self.instance_id, &identity.0, &identity.1)
            .await;
        if result.is_err() {
            tracing::warn!("removed Collector policy status cleanup failed");
            self.write_report(&Report {
                identity: identity.clone(),
                applied_version: None,
                stale: true,
            })
            .await;
        }
    }

    async fn prune_expired_status_rows(&self) {
        let should_prune = {
            let mut last = self.last_prune.lock().expect("policy state lock poisoned");
            if last.elapsed() >= STATUS_PRUNE_INTERVAL {
                *last = Instant::now();
                true
            } else {
                false
            }
        };
        if should_prune {
            let result = self.repository.prune_expired(STATUS_RETENTION).await;
            if result.is_err() {
                tracing::warn!("expired Collector runtime state cleanup failed");
            }
        }
    }

    async fn write_instance_status(&self, status: &str) {
        let result = self.repository.heartbeat(&self.instance_id, status).await;
        if result.is_err() {
            tracing::warn!("Collector instance heartbeat unavailable");
        }
    }
}

impl DatabasePolicy {
    fn identity(&self) -> Identity {
        (self.site.site_id.clone(), self.site.environment.clone())
    }
}

fn reconcile_snapshot(
    previous: &HashMap<Identity, DatabasePolicy>,
    parsed: Vec<DatabasePolicy>,
    invalid: HashSet<Identity>,
    present: &HashSet<Identity>,
) -> (
    HashMap<Identity, DatabasePolicy>,
    Vec<Report>,
    Vec<Identity>,
) {
    let mut database = HashMap::new();
    for policy in parsed {
        database.insert(policy.identity(), policy);
    }
    let mut retained_previous: HashMap<Identity, DatabasePolicy> = previous
        .iter()
        .filter(|(identity, _)| present.contains(*identity))
        .map(|(identity, last)| (identity.clone(), last.clone()))
        .collect();
    let mut reports = Vec::with_capacity(database.len() + invalid.len());

    let removed: Vec<_> = previous
        .keys()
        .filter(|identity| !present.contains(*identity))
        .cloned()
        .collect();

    for identity in invalid {
        reports.push(Report {
            identity: identity.clone(),
            applied_version: previous.get(&identity).map(|last| last.version),
            stale: true,
        });
    }

    let mut accepted = HashMap::new();
    let mut ordered: Vec<_> = database.into_iter().collect();
    ordered.sort_by(|a, b| a.0.cmp(&b.0));
    for (identity, candidate) in ordered {
        retained_previous.remove(&identity);
        let mut candidate_sites: Vec<_> = retained_previous
            .values()
            .map(|row| row.site.clone())
            .collect();
        candidate_sites.extend(
            accepted
                .values()
                .map(|row: &DatabasePolicy| row.site.clone()),
        );
        candidate_sites.push(candidate.site.clone());
        match SiteRegistry::from_runtime_sites(candidate_sites) {
            Ok(_) => {
                accepted.insert(identity.clone(), candidate.clone());
                reports.push(Report {
                    identity,
                    applied_version: Some(candidate.version),
                    stale: false,
                });
            }
            Err(_) => {
                tracing::warn!(
                    "environment policy conflicts with another effective Origin or key; retaining last valid policy"
                );
                let last = previous.get(&identity);
                if let Some(last) = last {
                    retained_previous.insert(identity.clone(), last.clone());
                }
                reports.push(Report {
                    identity,
                    applied_version: last.map(|policy| policy.version),
                    stale: true,
                });
            }
        }
    }

    // A successful refresh replaces the snapshot; missing or archived rows cannot survive it.
    let mut next_database = accepted;
    next_database.extend(retained_previous);
    next_database.retain(|identity, _| present.contains(identity));
    (next_database, reports, removed)
}

fn parse_database_policy(
    validator: &Validator,
    site_id: &str,
    environment: &str,
    version: i64,
    value: &Value,
) -> Result<DatabasePolicy, ()> {
    if validator.iter_errors(value).next().is_some() {
        return Err(());
    }
    let stored =
        StoredPolicy::parse_validated(value, site_id, environment, version).map_err(|_| ())?;
    let _updated_at_is_validated_by_schema = stored.updated_at;
    let mut digests = Vec::with_capacity(stored.ingest_keys.len());
    for key in stored.ingest_keys {
        let _metadata_is_validated_by_schema = (&key.key_id, &key.created_at);
        digests.push(decode_digest(&key.sha256_digest).ok_or(())?);
    }
    Ok(DatabasePolicy {
        site: SiteConfig {
            site_id: stored.site_id,
            environment: stored.environment,
            enabled: stored.enabled,
            allowed_origins: stored.allowed_origins,
            ingest_keys: Vec::new(),
            rate_limit_per_minute: stored.rate_limit_per_minute,
            ingest_key_digests: digests,
        },
        version,
    })
}

fn decode_digest(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 {
        return None;
    }
    let mut digest = [0_u8; 32];
    let (pairs, remainder) = value.as_bytes().as_chunks::<2>();
    if !remainder.is_empty() {
        return None;
    }
    for (index, chunk) in pairs.iter().enumerate() {
        let pair = std::str::from_utf8(chunk).ok()?;
        digest[index] = u8::from_str_radix(pair, 16).ok()?;
    }
    Some(digest)
}

#[cfg(test)]
mod tests {
    use super::{
        CONFIG_REFRESH_INTERVAL, DatabasePolicy, Identity, Report, STATUS_HEARTBEAT_TTL,
        decode_digest, parse_database_policy, reconcile_snapshot, stored_policy_validator,
    };
    use crate::domain::config::SiteConfig;
    use serde_json::Value;
    use std::collections::{HashMap, HashSet};

    fn database_policy(
        site_id: &str,
        environment: &str,
        version: i64,
        key_digest: [u8; 32],
    ) -> DatabasePolicy {
        DatabasePolicy {
            site: SiteConfig {
                site_id: site_id.to_owned(),
                environment: environment.to_owned(),
                enabled: true,
                allowed_origins: vec![format!("https://{site_id}.example.test")],
                ingest_keys: Vec::new(),
                rate_limit_per_minute: 600,
                ingest_key_digests: vec![key_digest],
            },
            version,
        }
    }

    fn report_for<'a>(reports: &'a [Report], identity: &Identity) -> &'a Report {
        reports
            .iter()
            .find(|report| &report.identity == identity)
            .expect("snapshot reconciliation should report every invalid or parsed policy")
    }

    #[test]
    fn refresh_and_heartbeat_intervals_match_the_configuration_contract() {
        assert_eq!(CONFIG_REFRESH_INTERVAL.as_secs(), 5);
        assert_eq!(STATUS_HEARTBEAT_TTL.as_secs(), 15);
    }

    #[test]
    fn invalid_policy_retains_last_good_and_first_time_invalid_policy_fails_closed() {
        let good_identity = ("site_good".to_owned(), "production".to_owned());
        let invalid_identity = ("site_new".to_owned(), "production".to_owned());
        let previous = HashMap::from([(
            good_identity.clone(),
            database_policy("site_good", "production", 3, [3; 32]),
        )]);
        let present = HashSet::from([good_identity.clone(), invalid_identity.clone()]);
        let invalid = HashSet::from([good_identity.clone(), invalid_identity.clone()]);

        let (snapshot, reports, removed) =
            reconcile_snapshot(&previous, Vec::new(), invalid, &present);

        assert_eq!(snapshot.get(&good_identity).map(|row| row.version), Some(3));
        assert!(!snapshot.contains_key(&invalid_identity));
        assert!(removed.is_empty());
        assert_eq!(
            report_for(&reports, &good_identity).applied_version,
            Some(3)
        );
        assert!(report_for(&reports, &good_identity).stale);
        assert_eq!(
            report_for(&reports, &invalid_identity).applied_version,
            None
        );
        assert!(report_for(&reports, &invalid_identity).stale);
    }

    #[test]
    fn removed_policy_is_returned_for_applied_state_cleanup() {
        let removed_identity = ("site_archived".to_owned(), "production".to_owned());
        let previous = HashMap::from([(
            removed_identity.clone(),
            database_policy("site_archived", "production", 2, [4; 32]),
        )]);

        let (snapshot, reports, removed) =
            reconcile_snapshot(&previous, Vec::new(), HashSet::new(), &HashSet::new());

        assert!(!snapshot.contains_key(&removed_identity));
        assert!(reports.is_empty());
        assert_eq!(removed, vec![removed_identity]);
    }

    #[test]
    fn conflicting_first_time_policy_fails_closed_and_reports_stale() {
        let existing_identity = ("site_existing".to_owned(), "production".to_owned());
        let conflicting_identity = ("site_new".to_owned(), "production".to_owned());
        let previous = HashMap::new();
        let parsed = vec![
            database_policy("site_existing", "production", 1, [7; 32]),
            database_policy("site_new", "production", 1, [7; 32]),
        ];
        let present = HashSet::from([existing_identity.clone(), conflicting_identity.clone()]);

        let (snapshot, reports, removed) =
            reconcile_snapshot(&previous, parsed, HashSet::new(), &present);

        assert!(removed.is_empty());
        assert_eq!(
            snapshot.get(&existing_identity).map(|row| row.version),
            Some(1)
        );
        assert!(!snapshot.contains_key(&conflicting_identity));
        assert_eq!(
            report_for(&reports, &conflicting_identity).applied_version,
            None
        );
        assert!(report_for(&reports, &conflicting_identity).stale);
    }

    #[test]
    fn conflicting_policy_retains_its_last_good_snapshot_and_reports_stale() {
        let existing_identity = ("site_existing".to_owned(), "production".to_owned());
        let changed_identity = ("site_changed".to_owned(), "production".to_owned());
        let previous = HashMap::from([
            (
                existing_identity.clone(),
                database_policy("site_existing", "production", 4, [7; 32]),
            ),
            (
                changed_identity.clone(),
                database_policy("site_changed", "production", 1, [8; 32]),
            ),
        ]);
        let parsed = vec![
            database_policy("site_changed", "production", 2, [7; 32]),
            database_policy("site_existing", "production", 4, [7; 32]),
        ];
        let present = HashSet::from([existing_identity, changed_identity.clone()]);

        let (snapshot, reports, removed) =
            reconcile_snapshot(&previous, parsed, HashSet::new(), &present);

        assert!(removed.is_empty());
        let retained = snapshot
            .get(&changed_identity)
            .expect("conflicting update should keep its last-good policy");
        assert_eq!(retained.version, 1);
        assert_eq!(retained.site.ingest_key_digests, vec![[8; 32]]);
        assert_eq!(
            report_for(&reports, &changed_identity).applied_version,
            Some(1)
        );
        assert!(report_for(&reports, &changed_identity).stale);
    }

    #[test]
    fn decodes_only_full_sha256_hex_digests() {
        assert!(decode_digest(&"ab".repeat(32)).is_some());
        assert!(decode_digest("ab").is_none());
        assert!(decode_digest(&"zz".repeat(32)).is_none());
    }

    #[test]
    fn parses_schema_valid_empty_key_policy_as_fail_closed_runtime_site() {
        let validator = stored_policy_validator().unwrap();
        let document: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/environment-policy/valid/empty-ingest-keys.json"
        ))
        .unwrap();
        let policy = parse_database_policy(&validator, "site_playground", "preview", 1, &document)
            .unwrap_or_else(|_| {
                panic!(
                    "schema errors: {:?}",
                    validator
                        .iter_errors(&document)
                        .map(|error| error.to_string())
                        .collect::<Vec<_>>()
                )
            });
        assert!(policy.site.ingest_key_digests.is_empty());
        assert_eq!(policy.site.rate_limit_per_minute, 600);
        assert_eq!(policy.version, 1);
    }

    #[test]
    fn rejects_schema_invalid_document_with_startup_validator() {
        let validator = stored_policy_validator().unwrap();
        let document: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/environment-policy/valid/production.json"
        ))
        .unwrap();
        let mut invalid = document;
        invalid["unexpected"] = serde_json::json!(true);
        assert!(
            parse_database_policy(&validator, "site_playground", "preview", 1, &invalid).is_err()
        );
    }

    #[test]
    fn canonical_policy_fixtures_match_runtime_parser() {
        let validator = stored_policy_validator().unwrap();
        let fixture_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/contracts/configuration/current/fixtures/environment-policy");

        for (directory, expected_valid) in [("valid", true), ("invalid", false)] {
            for entry in std::fs::read_dir(fixture_root.join(directory)).unwrap() {
                let path = entry.unwrap().path();
                if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                    continue;
                }
                let document: Value =
                    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                let site_id = document["site_id"].as_str().unwrap_or("site_playground");
                let environment = document["environment"].as_str().unwrap_or("production");
                let version = document["version"].as_i64().unwrap_or(1);
                let accepted =
                    parse_database_policy(&validator, site_id, environment, version, &document)
                        .is_ok();
                let filename = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("");
                let expected_current_service_result = expected_valid;
                assert_eq!(
                    accepted,
                    expected_current_service_result,
                    "fixture: {}",
                    path.display()
                );
                println!(
                    "M0B_POLICY_COLLECTOR_RESULT\t{}\t{}\t{}",
                    directory, filename, accepted
                );
            }
        }
    }

    #[test]
    fn typify_policy_structure_and_explicit_rules_cover_canonical_and_semantic_cases() {
        use super::generated_environment_policy::SiteEnvironmentIngestPolicy;
        use std::collections::HashSet;

        let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/contracts/configuration/current/fixtures/environment-policy");
        for name in ["empty-ingest-keys.json", "production.json"] {
            let value: Value =
                serde_json::from_slice(&std::fs::read(fixtures.join("valid").join(name)).unwrap())
                    .unwrap();
            let typed: SiteEnvironmentIngestPolicy = serde_json::from_value(value).unwrap();
            assert_eq!(typed.schema_version, serde_json::json!(1));
            assert!(!typed.allowed_origins.is_empty());
            assert_eq!(
                typed.allowed_origins.iter().collect::<HashSet<_>>().len(),
                typed.allowed_origins.len()
            );
        }

        let mut base: Value =
            serde_json::from_slice(&std::fs::read(fixtures.join("valid/production.json")).unwrap())
                .unwrap();
        for (name, mutation) in [
            (
                "unsupported schema_version",
                serde_json::json!({"schema_version": 2}),
            ),
            ("empty origins", serde_json::json!({"allowed_origins": []})),
            (
                "duplicate origins",
                serde_json::json!({"allowed_origins": ["https://example.com", "https://example.com"]}),
            ),
        ] {
            let mut candidate = base.clone();
            for (key, value) in mutation.as_object().unwrap() {
                candidate[key] = value.clone();
            }
            let typed: SiteEnvironmentIngestPolicy = serde_json::from_value(candidate).unwrap();
            let unique = typed.allowed_origins.iter().collect::<HashSet<_>>().len()
                == typed.allowed_origins.len();
            let explicit_valid = typed.schema_version == serde_json::json!(1)
                && !typed.allowed_origins.is_empty()
                && unique;
            assert!(!explicit_valid, "explicit policy rule must reject {name}");
        }
        base["unexpected"] = serde_json::json!(true);
        assert!(
            serde_json::from_value::<SiteEnvironmentIngestPolicy>(base).is_err(),
            "Typify structure rejects unknown root fields"
        );
    }

    #[test]
    fn schema_unbounded_policy_integers_exceed_collector_i64_range() {
        let validator = stored_policy_validator().unwrap();
        let base: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/environment-policy/valid/empty-ingest-keys.json"
        )).unwrap();
        for field in ["version", "rate_limit_per_minute"] {
            let mut document = base.clone();
            document[field] = serde_json::json!(1e30);
            assert!(
                validator.iter_errors(&document).next().is_none(),
                "Schema should accept the unbounded integer probe for {field}"
            );
            assert!(
                parse_database_policy(&validator, "site_playground", "preview", 1, &document)
                    .is_err(),
                "Collector i64 parsing rejects out-of-range {field}"
            );
        }
    }

    #[test]
    fn rejects_database_identity_and_version_mismatches() {
        let validator = stored_policy_validator().unwrap();
        let mut document: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/environment-policy/valid/empty-ingest-keys.json"
        ))
        .unwrap();
        document["site_id"] = Value::String("other_site".to_owned());
        assert!(
            parse_database_policy(&validator, "site_playground", "preview", 1, &document).is_err()
        );

        let mut document: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/environment-policy/valid/empty-ingest-keys.json"
        ))
        .unwrap();
        document["version"] = Value::from(2);
        assert!(
            parse_database_policy(&validator, "site_playground", "preview", 1, &document).is_err(),
            "stored document version must match its database row"
        );
        assert!(
            parse_database_policy(&validator, "site_playground", "preview", 2, &document).is_ok(),
            "matching database row and document version is accepted"
        );
    }
}
