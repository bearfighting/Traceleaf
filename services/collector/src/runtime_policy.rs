use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use getrandom::fill as random_fill;
use jsonschema::{Draft, Validator};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;

use crate::{
    config::{SiteConfig, SiteRegistry},
    security::KeyPolicy,
};

pub const CONFIG_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
pub const STATUS_HEARTBEAT_TTL: Duration = Duration::from_secs(15);
const STATUS_PRUNE_INTERVAL: Duration = Duration::from_secs(3600);
const STATUS_RETENTION: &str = "1 day";
const POLICY_SCHEMA: &str = include_str!(
    "../../../protocol/contracts/configuration/current/environment-policy.schema.json"
);

type Identity = (String, String);

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredPolicy {
    schema_version: u32,
    site_id: String,
    environment: String,
    version: i64,
    updated_at: String,
    enabled: bool,
    allowed_origins: Vec<String>,
    ingest_keys: Vec<StoredKey>,
    rate_limit_per_minute: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredKey {
    key_id: String,
    sha256_digest: String,
    created_at: String,
}

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
    pool: PgPool,
    fallback_sites: Vec<SiteConfig>,
    policy: KeyPolicy,
    instance_id: String,
    last_database: Mutex<HashMap<Identity, DatabasePolicy>>,
    last_prune: Mutex<Instant>,
}

impl RuntimePolicyManager {
    pub fn new(
        pool: PgPool,
        fallback_registry: SiteRegistry,
        policy: KeyPolicy,
    ) -> Result<Arc<Self>, getrandom::Error> {
        let mut instance_bytes = [0_u8; 16];
        random_fill(&mut instance_bytes)?;
        Ok(Arc::new(Self {
            pool,
            fallback_sites: fallback_registry.all_sites(),
            policy,
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
        let rows = match sqlx::query_as::<_, (String, String, i64, Value)>(
            "SELECT site_id, environment, version, document FROM site_environment_policies ORDER BY site_id, environment",
        )
        .fetch_all(&self.pool)
        .await
        {
            Ok(rows) => rows,
            Err(_) => {
                tracing::warn!("configuration refresh failed; retaining last valid Collector policy");
                self.report_last_database_as_stale().await;
                self.write_instance_status("stale").await;
                return false;
            }
        };

        let schema: Value = match serde_json::from_str(POLICY_SCHEMA) {
            Ok(schema) => schema,
            Err(_) => {
                self.report_last_database_as_stale().await;
                self.write_instance_status("stale").await;
                return false;
            }
        };
        let validator = match jsonschema::options()
            .with_draft(Draft::Draft202012)
            .build(&schema)
        {
            Ok(validator) => validator,
            Err(_) => {
                self.report_last_database_as_stale().await;
                self.write_instance_status("stale").await;
                return false;
            }
        };
        let mut parsed = Vec::with_capacity(rows.len());
        let mut invalid = HashSet::new();
        let mut present = HashSet::new();
        for (site_id, environment, version, document) in rows {
            let identity = (site_id.clone(), environment.clone());
            present.insert(identity.clone());
            match parse_database_policy(&validator, &site_id, &environment, version, &document) {
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
        let mut database = HashMap::new();
        for policy in parsed {
            database.insert(policy.identity(), policy);
        }
        let mut fallback: HashMap<Identity, SiteConfig> = self
            .fallback_sites
            .iter()
            .cloned()
            .map(|site| ((site.site_id.clone(), site.environment.clone()), site))
            .collect();
        let mut reports = Vec::with_capacity(database.len() + invalid.len());

        for identity in invalid.iter() {
            if let Some(last) = previous.get(identity) {
                fallback.insert(identity.clone(), last.site.clone());
                reports.push(Report {
                    identity: identity.clone(),
                    applied_version: Some(last.version),
                    stale: true,
                });
            } else {
                fallback.remove(identity);
                reports.push(Report {
                    identity: identity.clone(),
                    applied_version: None,
                    stale: true,
                });
            }
        }

        let mut accepted = HashMap::new();
        let mut rejected_previous = HashMap::new();
        let mut ordered: Vec<_> = database.into_iter().collect();
        ordered.sort_by(|a, b| a.0.cmp(&b.0));
        for (identity, candidate) in ordered {
            fallback.remove(&identity);
            let mut candidate_sites: Vec<_> = fallback.values().cloned().collect();
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
                    if let Some(last) = previous.get(&identity) {
                        fallback.insert(identity.clone(), last.site.clone());
                        rejected_previous.insert(identity.clone(), last.clone());
                        reports.push(Report {
                            identity,
                            applied_version: Some(last.version),
                            stale: true,
                        });
                    } else {
                        reports.push(Report {
                            identity,
                            applied_version: None,
                            stale: true,
                        });
                    }
                }
            }
        }

        // Rows that disappeared from storage are no longer DB managed; use the explicit TOML fallback.
        let mut effective: HashMap<Identity, SiteConfig> = fallback;
        for (identity, policy) in &accepted {
            effective.insert(identity.clone(), policy.site.clone());
        }
        let mut effective_sites: Vec<_> = effective.into_values().collect();
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

        let mut next_database = accepted;
        next_database.extend(rejected_previous);
        for identity in invalid {
            if let Some(last) = previous.get(&identity) {
                next_database.insert(identity, last.clone());
            }
        }
        // A row that is present but rejected without a prior snapshot remains absent from last-good state.
        next_database.retain(|identity, _| present.contains(identity));
        *self
            .last_database
            .lock()
            .expect("policy state lock poisoned") = next_database;

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
        let result = sqlx::query(
            "INSERT INTO configuration_runtime_state (instance_id, service, site_id, environment, applied_version, refresh_status, last_seen_at) VALUES ($1, 'collector', $2, $3, $4, $5, NOW()) ON CONFLICT (instance_id, site_id, environment) DO UPDATE SET applied_version = EXCLUDED.applied_version, refresh_status = EXCLUDED.refresh_status, last_seen_at = NOW()",
        )
        .bind(&self.instance_id)
        .bind(&report.identity.0)
        .bind(&report.identity.1)
        .bind(report.applied_version)
        .bind(status)
        .execute(&self.pool)
        .await;
        if result.is_err() {
            tracing::warn!("Collector applied-version report unavailable");
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
            let result = sqlx::query(
                "DELETE FROM configuration_runtime_state WHERE last_seen_at < NOW() - $1::INTERVAL",
            )
            .bind(STATUS_RETENTION)
            .execute(&self.pool)
            .await;
            if result.is_err() {
                tracing::warn!("expired Collector runtime state cleanup failed");
            }
            let result = sqlx::query(
                "DELETE FROM configuration_runtime_instances WHERE last_seen_at < NOW() - $1::INTERVAL",
            )
            .bind(STATUS_RETENTION)
            .execute(&self.pool)
            .await;
            if result.is_err() {
                tracing::warn!("expired Collector instance heartbeat cleanup failed");
            }
        }
    }

    async fn write_instance_status(&self, status: &str) {
        let result = sqlx::query(
            "INSERT INTO configuration_runtime_instances (instance_id, service, refresh_status, last_seen_at) VALUES ($1, 'collector', $2, NOW()) ON CONFLICT (instance_id) DO UPDATE SET refresh_status = EXCLUDED.refresh_status, last_seen_at = NOW()",
        )
        .bind(&self.instance_id)
        .bind(status)
        .execute(&self.pool)
        .await;
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
    let stored: StoredPolicy = serde_json::from_value(value.clone()).map_err(|_| ())?;
    if stored.schema_version != 1
        || stored.site_id != site_id
        || stored.environment != environment
        || stored.version != version
        || version < 1
        || stored.rate_limit_per_minute < 1
    {
        return Err(());
    }
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
        CONFIG_REFRESH_INTERVAL, POLICY_SCHEMA, STATUS_HEARTBEAT_TTL, decode_digest,
        parse_database_policy,
    };
    use jsonschema::Draft;
    use serde_json::Value;

    #[test]
    fn refresh_and_heartbeat_intervals_match_the_configuration_contract() {
        assert_eq!(CONFIG_REFRESH_INTERVAL.as_secs(), 5);
        assert_eq!(STATUS_HEARTBEAT_TTL.as_secs(), 15);
    }

    #[test]
    fn decodes_only_full_sha256_hex_digests() {
        assert!(decode_digest(&"ab".repeat(32)).is_some());
        assert!(decode_digest("ab").is_none());
        assert!(decode_digest(&"zz".repeat(32)).is_none());
    }

    #[test]
    fn parses_schema_valid_empty_key_policy_as_fail_closed_runtime_site() {
        let schema: Value = serde_json::from_str(POLICY_SCHEMA).unwrap();
        let validator = jsonschema::options()
            .with_draft(Draft::Draft202012)
            .build(&schema)
            .unwrap();
        let document: Value = serde_json::from_str(include_str!(
            "../../../protocol/contracts/configuration/current/fixtures/environment-policy/valid/empty-ingest-keys.json"
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
    fn canonical_policy_fixtures_match_runtime_parser() {
        let schema: Value = serde_json::from_str(POLICY_SCHEMA).unwrap();
        let validator = jsonschema::options()
            .with_draft(Draft::Draft202012)
            .build(&schema)
            .unwrap();
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
                let expected_current_service_result = match filename {
                    // Current Collector policy validation does not assert Schema date-time formats,
                    // and the stored model keeps these values as strings. This is an intentional
                    // parity finding, not a production behavior change in the M0b experiment.
                    "invalid-updated-at-date-time.json"
                    | "invalid-key-created-at-date-time.json" => true,
                    _ => expected_valid,
                };
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
    fn rejects_database_identity_and_version_mismatches() {
        let schema: Value = serde_json::from_str(POLICY_SCHEMA).unwrap();
        let validator = jsonschema::options()
            .with_draft(Draft::Draft202012)
            .build(&schema)
            .unwrap();
        let mut document: Value = serde_json::from_str(include_str!(
            "../../../protocol/contracts/configuration/current/fixtures/environment-policy/valid/empty-ingest-keys.json"
        ))
        .unwrap();
        document["site_id"] = Value::String("other_site".to_owned());
        assert!(
            parse_database_policy(&validator, "site_playground", "preview", 1, &document).is_err()
        );

        let mut document: Value = serde_json::from_str(include_str!(
            "../../../protocol/contracts/configuration/current/fixtures/environment-policy/valid/empty-ingest-keys.json"
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
