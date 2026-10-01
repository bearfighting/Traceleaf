use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};
use serde::de::{SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Transaction};

/// Durable identity-bearing tables from the M3.2 reference inventory.
pub const IDENTITY_TABLES: &[&str] = &[
    "analytics_feature_flags",
    "site_capability_configurations",
    "site_capability_activation_windows",
    "site_environment_policies",
    "site_definition_revisions",
    "raw_events",
    "page_view_totals",
    "page_view_daily",
    "page_view_routes",
    "normalized_event_context",
    "visitor_event_facts",
    "visitor_daily",
    "sessions",
    "session_events",
    "session_daily",
    "dimension_event_facts",
    "dimension_daily",
    "web_vital_facts",
    "custom_event_facts",
    "conversion_facts",
    "funnel_step_facts",
    "geo_event_metadata",
    "geo_country_facts",
];

/// Processing progress is collected for reconciliation, never identity creation.
pub const PROCESSING_TABLES: &[&str] = &[
    "analytics_generations",
    "analytics_watermarks",
    "analytics_rebuild_queue",
    "definition_revision_watermarks",
];

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceCount {
    pub status: String,
    pub rows: u64,
    pub distinct_site_ids: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Candidate {
    pub sources: BTreeSet<String>,
    pub database_sources: BTreeSet<String>,
    pub metadata: BTreeMap<String, BTreeSet<String>>,
    pub environment_sources: BTreeMap<String, BTreeSet<String>>,
    pub key_presence_sources: BTreeMap<String, bool>,
    pub origin_sources: BTreeMap<String, BTreeMap<String, BTreeSet<String>>>,
    pub requires_disposition: bool,
    pub disposition: Option<DispositionAction>,
    pub disposition_reason: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RegistryMetadata {
    pub display_name: Option<String>,
    pub website_url: Option<String>,
    pub lifecycle_status: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyCoverage {
    pub enabled: bool,
    pub allowed_origin_count: usize,
    pub ingest_key_digest_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DispositionAction {
    Approve,
    Exclude,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Disposition {
    pub site_id: String,
    pub action: DispositionAction,
    pub reason: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Report {
    pub sources: BTreeMap<String, SourceCount>,
    pub candidates: BTreeMap<String, Candidate>,
    pub processing_crosscheck: BTreeMap<String, SourceCount>,
    pub processing_ids: BTreeMap<String, BTreeSet<String>>,
    pub policy_coverage: BTreeMap<String, BTreeMap<String, PolicyCoverage>>,
    pub disposition_required: BTreeSet<String>,
    pub metadata_conflicts: BTreeMap<String, BTreeMap<String, BTreeSet<String>>>,
    pub origin_conflicts: BTreeMap<String, BTreeMap<String, BTreeMap<String, BTreeSet<String>>>>,
    pub registry_metadata: BTreeMap<String, RegistryMetadata>,
    pub metadata_needs_attention: BTreeMap<String, BTreeSet<String>>,
    pub source_only_ids: BTreeMap<String, BTreeSet<String>>,
    pub union_count: usize,
    pub applied_count: Option<usize>,
}

impl Report {
    pub fn add_ids<I>(&mut self, source: &str, status: &str, ids: I, rows: u64)
    where
        I: IntoIterator<Item = String>,
    {
        let ids: BTreeSet<String> = ids.into_iter().collect();
        let count = self.sources.entry(source.to_owned()).or_default();
        count.status = status.to_owned();
        count.rows = rows;
        count.distinct_site_ids = ids.len();
        for id in ids {
            let candidate = self.candidates.entry(id).or_default();
            candidate.sources.insert(source.to_owned());
            if source.starts_with("db.") || source == "db.configuration_audit" {
                candidate.database_sources.insert(source.to_owned());
            }
        }
        self.refresh_derived();
    }

    pub fn add_metadata(&mut self, site_id: &str, field: &str, value: &str) {
        self.candidates
            .entry(site_id.to_owned())
            .or_default()
            .metadata
            .entry(field.to_owned())
            .or_default()
            .insert(value.to_owned());
        self.refresh_derived();
    }

    pub fn add_environment(&mut self, site_id: &str, source: &str, environment: &str) {
        self.candidates
            .entry(site_id.to_owned())
            .or_default()
            .environment_sources
            .entry(source.to_owned())
            .or_default()
            .insert(environment.to_owned());
    }

    pub fn add_origin(&mut self, site_id: &str, source: &str, environment: &str, origin: &str) {
        self.candidates
            .entry(site_id.to_owned())
            .or_default()
            .origin_sources
            .entry(source.to_owned())
            .or_default()
            .entry(environment.to_owned())
            .or_default()
            .insert(origin.to_owned());
    }

    pub fn refresh_derived(&mut self) {
        self.union_count = self.candidates.len();
        self.disposition_required.clear();
        self.metadata_conflicts.clear();
        self.origin_conflicts.clear();
        for (id, candidate) in &mut self.candidates {
            let conflict_fields: BTreeMap<String, BTreeSet<String>> = candidate
                .metadata
                .iter()
                .filter(|(_, values)| values.len() > 1)
                .map(|(field, values)| (field.clone(), values.clone()))
                .collect();
            let static_only = candidate.database_sources.is_empty();
            let suspicious_name = has_suspicious_id_shape(id);
            let mut environments: BTreeMap<String, BTreeMap<String, BTreeSet<String>>> =
                BTreeMap::new();
            for (source, by_environment) in &candidate.origin_sources {
                for (environment, origins) in by_environment {
                    environments
                        .entry(environment.clone())
                        .or_default()
                        .insert(source.clone(), origins.clone());
                }
            }
            let site_origin_conflicts: BTreeMap<String, BTreeMap<String, BTreeSet<String>>> =
                environments
                    .into_iter()
                    .filter(|(_, source_origins)| {
                        source_origins.len() > 1
                            && source_origins.values().collect::<BTreeSet<_>>().len() > 1
                    })
                    .collect();
            let origin_conflict = !site_origin_conflicts.is_empty();
            candidate.requires_disposition =
                static_only || suspicious_name || !conflict_fields.is_empty() || origin_conflict;
            if candidate.requires_disposition {
                self.disposition_required.insert(id.clone());
            }
            if !conflict_fields.is_empty() {
                self.metadata_conflicts.insert(id.clone(), conflict_fields);
            }
            if !site_origin_conflicts.is_empty() {
                self.origin_conflicts
                    .insert(id.clone(), site_origin_conflicts);
            }
        }
        self.metadata_needs_attention.clear();
        for site_id in self.candidates.keys() {
            let metadata = self.registry_metadata.entry(site_id.clone()).or_default();
            let mut missing = BTreeSet::new();
            if metadata.display_name.as_deref().is_none_or(str::is_empty) {
                missing.insert("display_name".to_owned());
            }
            if metadata.website_url.as_deref().is_none_or(str::is_empty) {
                missing.insert("website_url".to_owned());
            }
            if !missing.is_empty() {
                self.metadata_needs_attention
                    .insert(site_id.clone(), missing);
            }
        }
        self.source_only_ids.clear();
        for (source, counts) in &self.sources {
            let ids: BTreeSet<_> = self
                .candidates
                .iter()
                .filter(|(_, candidate)| candidate.sources.contains(source))
                .map(|(id, _)| id.clone())
                .collect();
            if counts.distinct_site_ids > 0 {
                let only = ids
                    .into_iter()
                    .filter(|id| {
                        self.candidates
                            .get(id)
                            .is_some_and(|candidate| candidate.sources.len() == 1)
                    })
                    .collect();
                self.source_only_ids.insert(source.clone(), only);
            }
        }
    }

    pub fn apply_dispositions(&mut self, dispositions: &[Disposition]) -> Result<()> {
        let mut seen = BTreeSet::new();
        for disposition in dispositions {
            if disposition.site_id.trim().is_empty() || disposition.reason.trim().is_empty() {
                bail!("dispositions require non-empty site_id and reason");
            }
            if !seen.insert(disposition.site_id.as_str()) {
                bail!("duplicate disposition for site_id {}", disposition.site_id);
            }
            let Some(candidate) = self.candidates.get_mut(&disposition.site_id) else {
                bail!(
                    "disposition references unknown site_id {}",
                    disposition.site_id
                );
            };
            if disposition.action == DispositionAction::Exclude && !candidate.requires_disposition {
                bail!(
                    "site_id {} does not require an exclusion",
                    disposition.site_id
                );
            }
            if disposition.action == DispositionAction::Exclude
                && !candidate.database_sources.is_empty()
            {
                bail!(
                    "persisted database identity {} cannot be excluded; approve it as a Site",
                    disposition.site_id
                );
            }
            candidate.disposition = Some(disposition.action.clone());
            candidate.disposition_reason = Some(disposition.reason.clone());
        }
        for id in &self.disposition_required {
            if self
                .candidates
                .get(id)
                .is_some_and(|candidate| candidate.disposition.is_none())
            {
                bail!("site_id {id} needs an explicit disposition before apply");
            }
        }
        Ok(())
    }

    pub fn validate_candidate_ids(&self) -> Result<()> {
        for site_id in self.candidates.keys() {
            if site_id.is_empty() || site_id.chars().count() > 64 {
                bail!("candidate Site ID must contain 1 to 64 characters: {site_id:?}");
            }
        }
        Ok(())
    }

    pub fn apply_candidates(&self) -> Result<Vec<String>> {
        let mut result = Vec::new();
        for (site_id, candidate) in &self.candidates {
            if candidate.requires_disposition && candidate.disposition.is_none() {
                bail!("site_id {site_id} needs an explicit disposition before apply");
            }
            if candidate.disposition == Some(DispositionAction::Exclude) {
                continue;
            }
            result.push(site_id.clone());
        }
        Ok(result)
    }
}

pub fn has_suspicious_id_shape(site_id: &str) -> bool {
    if site_id == "site_definition_revision_processor" {
        return true;
    }
    site_id
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| {
            matches!(
                part.to_ascii_lowercase().as_str(),
                "test" | "tests" | "fixture" | "fixtures"
            )
        })
}

pub fn parse_dashboard_sites(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|site_id| !site_id.is_empty())
        .map(str::to_owned)
        .collect()
}

#[derive(Deserialize)]
struct DefinitionsFile {
    sites: Vec<DefinitionsSite>,
}

#[derive(Deserialize)]
struct DefinitionsSite {
    site_id: String,
}

pub fn definitions_site_ids(path: &Path) -> Result<Vec<String>> {
    let bytes =
        fs::read(path).with_context(|| format!("read definitions file {}", path.display()))?;
    let definitions: DefinitionsFile = serde_json::from_slice(&bytes)
        .with_context(|| format!("parse definitions file {}", path.display()))?;
    Ok(definitions
        .sites
        .into_iter()
        .map(|site| site.site_id)
        .collect())
}

#[derive(Deserialize)]
struct CollectorFile {
    #[serde(default)]
    sites: Vec<CollectorSite>,
}

#[derive(Deserialize)]
struct CollectorSite {
    site_id: String,
    #[serde(default)]
    environment: String,
    #[serde(default)]
    allowed_origins: Vec<String>,
    /// Discard key values while deserializing; never retained or serialized.
    #[serde(default, rename = "ingest_keys", deserialize_with = "discard_any")]
    ingest_keys_present: bool,
}

fn discard_any<'de, D>(deserializer: D) -> std::result::Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct KeyPresenceVisitor;
    impl<'de> Visitor<'de> for KeyPresenceVisitor {
        type Value = bool;
        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("an array of redacted ingest keys")
        }
        fn visit_seq<A>(self, mut sequence: A) -> std::result::Result<bool, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut has_key = false;
            while sequence.next_element::<serde::de::IgnoredAny>()?.is_some() {
                has_key = true;
            }
            Ok(has_key)
        }
    }
    deserializer.deserialize_seq(KeyPresenceVisitor)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CollectorEvidence {
    pub site_id: String,
    pub environment: String,
    pub has_ingest_keys: bool,
    pub allowed_origins: Vec<String>,
}

pub fn collector_sites(path: &Path) -> Result<Vec<CollectorEvidence>> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("read Collector TOML {}", path.display()))?;
    let parsed: CollectorFile = toml::from_str(&content)
        .with_context(|| format!("parse Collector TOML {}", path.display()))?;
    Ok(parsed
        .sites
        .into_iter()
        .map(|site| CollectorEvidence {
            site_id: site.site_id,
            environment: site.environment,
            has_ingest_keys: site.ingest_keys_present,
            allowed_origins: site.allowed_origins,
        })
        .collect())
}

pub fn read_dispositions(path: &Path) -> Result<Vec<Disposition>> {
    let bytes =
        fs::read(path).with_context(|| format!("read disposition file {}", path.display()))?;
    serde_json::from_slice(&bytes)
        .with_context(|| format!("parse disposition file {}", path.display()))
}

pub async fn collect_database(pool: &PgPool, report: &mut Report) -> Result<()> {
    ensure_m3_schema(pool).await?;
    for table in IDENTITY_TABLES {
        let sql = format!(
            "SELECT site_id, COUNT(*)::BIGINT AS rows FROM {table} GROUP BY site_id ORDER BY site_id"
        );
        let rows = sqlx::query_as::<_, (String, i64)>(sqlx::AssertSqlSafe(sql))
            .fetch_all(pool)
            .await
            .with_context(|| format!("read identity source table {table}"))?;
        let row_count = rows.iter().map(|(_, count)| *count as u64).sum();
        report.add_ids(
            &format!("db.{table}"),
            "configured",
            rows.iter().map(|(id, _)| id.clone()),
            row_count,
        );
    }

    let audit_rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT resource->>'site_id', COUNT(*)::BIGINT FROM configuration_audit \
         WHERE resource ? 'site_id' GROUP BY resource->>'site_id' ORDER BY resource->>'site_id'",
    )
    .fetch_all(pool)
    .await
    .context("read configuration audit Site references")?;
    let audit_count = audit_rows.iter().map(|(_, count)| *count as u64).sum();
    report.add_ids(
        "db.configuration_audit",
        "configured",
        audit_rows.into_iter().map(|(id, _)| id),
        audit_count,
    );

    for table in PROCESSING_TABLES {
        let sql = format!(
            "SELECT site_id, COUNT(*)::BIGINT AS rows FROM {table} GROUP BY site_id ORDER BY site_id"
        );
        let rows = sqlx::query_as::<_, (String, i64)>(sqlx::AssertSqlSafe(sql))
            .fetch_all(pool)
            .await
            .with_context(|| format!("read processing cross-check table {table}"))?;
        report.processing_ids.insert(
            format!("db.{table}"),
            rows.iter().map(|(id, _)| id.clone()).collect(),
        );
        report.processing_crosscheck.insert(
            format!("db.{table}"),
            SourceCount {
                status: "crosscheck_only".to_owned(),
                rows: rows.iter().map(|(_, count)| *count as u64).sum(),
                distinct_site_ids: rows.len(),
            },
        );
    }

    let registry_rows = sqlx::query_as::<_, (String, Option<String>, Option<String>, String)>(
        "SELECT site_id, display_name, website_url, lifecycle_status FROM site_registry ORDER BY site_id",
    )
    .fetch_all(pool)
    .await
    .context("read existing Registry identities and metadata status")?;
    report.add_ids(
        "db.site_registry_existing",
        "configured",
        registry_rows.iter().map(|(id, _, _, _)| id.clone()),
        registry_rows.len() as u64,
    );
    for (site_id, display_name, website_url, lifecycle_status) in registry_rows {
        report.registry_metadata.insert(
            site_id,
            RegistryMetadata {
                display_name,
                website_url,
                lifecycle_status: Some(lifecycle_status),
            },
        );
    }

    let policies = sqlx::query_as::<_, (String, String, bool, i32, i32)>(
        "SELECT site_id, environment, (document->>$$enabled$$)::BOOLEAN,
                jsonb_array_length(document->$$allowed_origins$$),
                jsonb_array_length(document->$$ingest_keys$$)
           FROM site_environment_policies ORDER BY site_id, environment",
    )
    .fetch_all(pool)
    .await
    .context("read policy and non-secret coverage evidence")?;
    for (site_id, environment, enabled, origin_count, key_count) in policies {
        report
            .policy_coverage
            .entry(site_id.clone())
            .or_default()
            .insert(
                environment.clone(),
                PolicyCoverage {
                    enabled,
                    allowed_origin_count: origin_count as usize,
                    ingest_key_digest_count: key_count as usize,
                },
            );
        report.add_environment(&site_id, "db.site_environment_policies", &environment);
    }
    let origins = sqlx::query_as::<_, (String, String, String)>(
        "SELECT policy.site_id, policy.environment, origin.value
           FROM site_environment_policies AS policy
           CROSS JOIN LATERAL jsonb_array_elements_text(policy.document->'allowed_origins') AS origin(value)
          ORDER BY policy.site_id, policy.environment, origin.value",
    )
    .fetch_all(pool)
    .await
    .context("read policy Origin evidence")?;
    for (site_id, environment, origin) in origins {
        report.add_origin(
            &site_id,
            "db.site_environment_policies",
            &environment,
            &origin,
        );
    }
    report.refresh_derived();
    Ok(())
}

async fn ensure_m3_schema(pool: &PgPool) -> Result<()> {
    let found: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('public.site_registry')::TEXT")
            .fetch_one(pool)
            .await
            .context("check Registry schema")?;
    if found.is_none() {
        bail!("site_registry is missing; apply the M3.2 migration to the disposable target first");
    }
    Ok(())
}

pub async fn apply_registry(pool: &PgPool, site_ids: &[String]) -> Result<usize> {
    let mut transaction: Transaction<'_, Postgres> =
        pool.begin().await.context("begin Registry import")?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('site-registry-importer', 0))")
        .execute(&mut *transaction)
        .await
        .context("lock Registry importer")?;

    let mut inserted = 0;
    for site_id in site_ids {
        let result = sqlx::query(
            "INSERT INTO site_registry (site_id) VALUES ($1) ON CONFLICT (site_id) DO NOTHING",
        )
        .bind(site_id)
        .execute(&mut *transaction)
        .await
        .with_context(|| format!("insert Registry identity {site_id}"))?;
        inserted += result.rows_affected() as usize;
    }
    transaction
        .commit()
        .await
        .context("commit Registry import")?;
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dashboard_ids_are_trimmed_and_deduplicated_by_union() {
        let mut report = Report::default();
        report.add_ids(
            "dashboard.sites",
            "configured",
            parse_dashboard_sites(" a, b,a ,, "),
            4,
        );
        report.add_ids(
            "dashboard.default",
            "configured",
            vec!["b".to_owned(), "c".to_owned()],
            2,
        );
        assert_eq!(report.union_count, 3);
        assert_eq!(report.candidates["b"].sources.len(), 2);
        assert_eq!(
            report.source_only_ids["dashboard.sites"],
            BTreeSet::from(["a".to_owned()])
        );
    }

    #[test]
    fn persisted_test_identity_requires_approval_and_cannot_be_excluded() {
        let mut report = Report::default();
        report.add_ids(
            "db.raw_events",
            "configured",
            vec!["integration_test".to_owned()],
            3,
        );
        assert!(report.apply_dispositions(&[]).is_err());
        let exclude = Disposition {
            site_id: "integration_test".to_owned(),
            action: DispositionAction::Exclude,
            reason: "fixture".to_owned(),
        };
        assert!(report.apply_dispositions(&[exclude]).is_err());
        let approve = Disposition {
            site_id: "integration_test".to_owned(),
            action: DispositionAction::Approve,
            reason: "retained legacy identity".to_owned(),
        };
        report.apply_dispositions(&[approve]).unwrap();
        assert_eq!(report.apply_candidates().unwrap(), vec!["integration_test"]);
    }

    #[test]
    fn static_only_candidate_requires_disposition_and_can_be_excluded() {
        let mut report = Report::default();
        report.add_ids(
            "collector.toml",
            "configured",
            vec!["stale_site".to_owned()],
            1,
        );
        assert!(report.apply_candidates().is_err());
        report
            .apply_dispositions(&[Disposition {
                site_id: "stale_site".to_owned(),
                action: DispositionAction::Exclude,
                reason: "confirmed stale config".to_owned(),
            }])
            .unwrap();
        assert!(report.apply_candidates().unwrap().is_empty());
    }

    #[test]
    fn collector_parser_discards_ingest_key_values() {
        let file = tempfile_path();
        fs::write(
            &file,
            "[[sites]]\nsite_id='alpha'\nenvironment='prod'\ningest_keys=['super-secret']\n",
        )
        .unwrap();
        let evidence = collector_sites(&file).unwrap();
        assert_eq!(evidence.len(), 1);
        assert!(evidence[0].has_ingest_keys);
        let mut report = Report::default();
        report.add_ids(
            "collector.toml",
            "configured",
            vec![evidence[0].site_id.clone()],
            1,
        );
        report
            .candidates
            .get_mut("alpha")
            .unwrap()
            .key_presence_sources
            .insert("collector.toml".to_owned(), evidence[0].has_ingest_keys);
        let serialized = serde_json::to_string(&report).unwrap();
        assert!(!serialized.contains("super-secret"));
        let _ = fs::remove_file(file);
    }

    #[test]
    fn duplicate_dispositions_are_rejected() {
        let mut report = Report::default();
        report.add_ids(
            "collector.toml",
            "configured",
            vec!["candidate".to_owned()],
            1,
        );
        let entry = Disposition {
            site_id: "candidate".to_owned(),
            action: DispositionAction::Approve,
            reason: "reviewed".to_owned(),
        };
        assert!(report.apply_dispositions(&[entry.clone(), entry]).is_err());
    }

    #[test]
    fn collector_parse_failure_is_not_reported_as_not_configured() {
        let file = tempfile_path();
        fs::write(
            &file,
            r#"[[sites]]
site_id = 'first'
site_id = 'second'
"#,
        )
        .unwrap();
        assert!(collector_sites(&file).is_err());
        let _ = fs::remove_file(file);
    }

    #[test]
    fn candidate_ids_match_registry_length_constraints_without_rewriting() {
        let mut report = Report::default();
        report.add_ids(
            "definitions_file",
            "configured",
            vec!["site_alpha".to_owned()],
            1,
        );
        assert!(report.validate_candidate_ids().is_ok());
        report.add_ids("definitions_file", "configured", vec![String::new()], 1);
        assert!(report.validate_candidate_ids().is_err());
        let mut report = Report::default();
        report.add_ids("definitions_file", "configured", vec!["a".repeat(65)], 1);
        assert!(report.validate_candidate_ids().is_err());
    }

    #[test]
    fn origin_differences_are_reported_by_environment_and_require_review() {
        let mut report = Report::default();
        report.add_ids(
            "db.site_environment_policies",
            "configured",
            vec!["alpha".to_owned()],
            1,
        );
        report.add_ids("collector.toml", "configured", vec!["alpha".to_owned()], 1);
        report.add_origin(
            "alpha",
            "db.site_environment_policies",
            "production",
            "https://db.example",
        );
        report.add_origin(
            "alpha",
            "collector.toml",
            "production",
            "https://toml.example",
        );
        report.refresh_derived();
        assert!(report.disposition_required.contains("alpha"));
        assert_eq!(report.origin_conflicts["alpha"]["production"].len(), 2);
    }

    #[test]
    fn environments_are_coverage_evidence_not_metadata_conflicts() {
        let mut report = Report::default();
        report.add_ids("collector.toml", "configured", vec!["alpha".to_owned()], 2);
        report.add_environment("alpha", "collector.toml", "development");
        report.add_environment("alpha", "collector.toml", "production");
        report.refresh_derived();
        assert!(report.metadata_conflicts.is_empty());
        assert_eq!(
            report.candidates["alpha"].environment_sources["collector.toml"].len(),
            2
        );
    }

    fn tempfile_path() -> std::path::PathBuf {
        static NEXT_FILE: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let sequence = NEXT_FILE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "site-registry-importer-{}-{sequence}.toml",
            std::process::id()
        ))
    }
}
