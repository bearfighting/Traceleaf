use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use clap::Parser;
use serde::Serialize;
use site_registry_importer::{
    Report, SourceCount, apply_registry, collect_database, collector_sites, definitions_site_ids,
    parse_dashboard_sites, read_dispositions,
};
use sqlx::postgres::PgPoolOptions;
use url::Url;

#[derive(Debug, Parser)]
#[command(about = "Read-only Site ID source reconciliation with explicit Registry apply")]
struct Args {
    /// Write the detailed, local reconciliation report to this path.
    #[arg(long)]
    report: PathBuf,

    /// Explicitly write the approved candidate union into site_registry.
    #[arg(long)]
    apply: bool,

    /// JSON array of dispositions for every report-flagged candidate.
    #[arg(long)]
    dispositions_file: Option<PathBuf>,

    /// Explicit comma-separated DASHBOARD_SITES value.
    #[arg(long)]
    dashboard_sites: Option<String>,
    /// Mark DASHBOARD_SITES as explicitly not configured.
    #[arg(long)]
    dashboard_sites_not_configured: bool,
    /// Explicit DASHBOARD_DEFAULT_SITE value.
    #[arg(long)]
    dashboard_default_site: Option<String>,
    /// Mark DASHBOARD_DEFAULT_SITE as explicitly not configured.
    #[arg(long)]
    dashboard_default_not_configured: bool,

    /// Path to the explicitly selected Collector TOML file.
    #[arg(long)]
    collector_config: Option<PathBuf>,
    /// Mark Collector TOML as explicitly not configured.
    #[arg(long)]
    collector_not_configured: bool,

    /// Path to the explicitly selected analytics definitions JSON file.
    #[arg(long)]
    definitions_file: Option<PathBuf>,
    /// Mark the analytics definitions file as explicitly not configured.
    #[arg(long)]
    definitions_not_configured: bool,

    /// Explicit legacy DEV_SEED_SITE_ID value.
    #[arg(long)]
    dev_seed_site_id: Option<String>,
    /// Mark DEV_SEED_SITE_ID as explicitly not configured.
    #[arg(long)]
    dev_seed_site_id_not_configured: bool,
    /// Explicit comma-separated DEV_SEED_ORIGINS value.
    #[arg(long)]
    dev_seed_origins: Option<String>,
    /// Mark DEV_SEED_ORIGINS as explicitly not configured.
    #[arg(long)]
    dev_seed_origins_not_configured: bool,
}

#[derive(Serialize)]
struct ReportEnvelope<'a> {
    report_version: u32,
    mode: &'static str,
    notes: Vec<&'static str>,
    #[serde(flatten)]
    report: &'a Report,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let database_url = std::env::var("DATABASE_URL")
        .context("DATABASE_URL must identify the explicitly selected target")?;
    validate_args(&args)?;

    let pool = PgPoolOptions::new()
        .max_connections(3)
        .connect(&database_url)
        .await
        .context("connect to the explicitly selected PostgreSQL target")?;

    let mut report = Report::default();
    collect_database(&pool, &mut report).await?;
    collect_static_sources(&args, &mut report)?;
    report.refresh_derived();
    report.validate_candidate_ids()?;

    if let Some(path) = &args.dispositions_file {
        let dispositions = read_dispositions(path)?;
        report.apply_dispositions(&dispositions)?;
    }
    let mut report_file = create_report_file(&args.report)?;
    write_report(&mut report_file, &args.report, &report, false)?;

    if args.apply && (!report.metadata_conflicts.is_empty() || !report.origin_conflicts.is_empty())
    {
        bail!("metadata or Origin conflicts remain; reconcile configured sources before apply");
    }

    if args.apply {
        let candidates = report.apply_candidates()?;
        let inserted = apply_registry(&pool, &candidates).await?;
        report.applied_count = Some(inserted);
    }

    write_report(&mut report_file, &args.report, &report, args.apply)?;
    print_summary(&report, args.apply);
    pool.close().await;
    Ok(())
}

fn validate_args(args: &Args) -> Result<()> {
    validate_source(
        "DASHBOARD_SITES",
        args.dashboard_sites.is_some(),
        args.dashboard_sites_not_configured,
    )?;
    validate_source(
        "DASHBOARD_DEFAULT_SITE",
        args.dashboard_default_site.is_some(),
        args.dashboard_default_not_configured,
    )?;
    validate_source(
        "Collector TOML",
        args.collector_config.is_some(),
        args.collector_not_configured,
    )?;
    validate_source(
        "ANALYTICS_DEFINITIONS_FILE",
        args.definitions_file.is_some(),
        args.definitions_not_configured,
    )?;
    validate_source(
        "legacy dev-seed Site ID",
        args.dev_seed_site_id.is_some(),
        args.dev_seed_site_id_not_configured,
    )?;
    validate_source(
        "DEV_SEED_ORIGINS",
        args.dev_seed_origins.is_some(),
        args.dev_seed_origins_not_configured,
    )?;
    if let Some(id) = &args.dev_seed_site_id
        && id.trim().is_empty()
    {
        bail!("--dev-seed-site-id cannot be empty");
    }
    if let Some(id) = &args.dashboard_default_site
        && id.trim().is_empty()
    {
        bail!("--dashboard-default-site cannot be empty");
    }
    if args.dev_seed_origins.is_some() && args.dev_seed_site_id.is_none() {
        bail!("DEV_SEED_ORIGINS cannot be reconciled without DEV_SEED_SITE_ID");
    }
    if let Some(value) = &args.dashboard_sites
        && parse_dashboard_sites(value).is_empty()
    {
        bail!("--dashboard-sites was configured but contains no Site IDs");
    }
    Ok(())
}

fn validate_source(name: &str, configured: bool, not_configured: bool) -> Result<()> {
    if configured == not_configured {
        bail!(
            "provide exactly one of a configured value/path or the explicit not-configured marker for {name}"
        );
    }
    Ok(())
}

fn collect_static_sources(args: &Args, report: &mut Report) -> Result<()> {
    if let Some(value) = &args.dashboard_sites {
        let ids = parse_dashboard_sites(value);
        report.add_ids(
            "dashboard.sites",
            "configured",
            ids.clone(),
            ids.len() as u64,
        );
    } else {
        add_not_configured(report, "dashboard.sites");
    }
    if let Some(value) = &args.dashboard_default_site {
        let id = value.trim().to_owned();
        report.add_ids("dashboard.default_site", "configured", vec![id], 1);
    } else {
        add_not_configured(report, "dashboard.default_site");
    }

    if let Some(path) = &args.collector_config {
        let sites = collector_sites(path)?;
        let ids: Vec<String> = sites.iter().map(|site| site.site_id.clone()).collect();
        report.add_ids(
            "collector.toml",
            "configured",
            ids.clone(),
            ids.len() as u64,
        );
        for site in sites {
            report.add_environment(&site.site_id, "collector.toml", &site.environment);
            for origin in site.allowed_origins {
                report.add_origin(&site.site_id, "collector.toml", &site.environment, &origin);
            }
            report
                .candidates
                .entry(site.site_id)
                .or_default()
                .key_presence_sources
                .entry("collector.toml".to_owned())
                .and_modify(|present| *present |= site.has_ingest_keys)
                .or_insert(site.has_ingest_keys);
        }
    } else {
        add_not_configured(report, "collector.toml");
    }

    if let Some(path) = &args.definitions_file {
        let ids = definitions_site_ids(path)?;
        report.add_ids(
            "definitions_file",
            "configured",
            ids.clone(),
            ids.len() as u64,
        );
    } else {
        add_not_configured(report, "definitions_file");
    }

    if let Some(id) = &args.dev_seed_site_id {
        report.add_ids(
            "dev_seed.site_id",
            "configured",
            vec![id.trim().to_owned()],
            1,
        );
    } else {
        add_not_configured(report, "dev_seed.site_id");
    }
    if let Some(value) = &args.dev_seed_origins {
        let site_id = args
            .dev_seed_site_id
            .as_deref()
            .expect("validated above")
            .trim();
        let origins = parse_origins(value)?;
        report.add_ids(
            "dev_seed.origins",
            "configured",
            vec![site_id.to_owned()],
            origins.len() as u64,
        );
        for origin in origins {
            report.add_origin(site_id, "dev_seed.origins", "development", &origin);
        }
    } else {
        add_not_configured(report, "dev_seed.origins");
    }
    Ok(())
}

fn parse_origins(value: &str) -> Result<Vec<String>> {
    let mut origins = std::collections::BTreeSet::new();
    for origin in value.split(char::from(44)).map(str::trim) {
        if origin.is_empty() {
            bail!("DEV_SEED_ORIGINS contains an empty entry");
        }
        let url = Url::parse(origin).context("parse DEV_SEED_ORIGINS value")?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
            || url.origin().ascii_serialization() != origin
        {
            bail!(
                "DEV_SEED_ORIGINS must contain canonical HTTP(S) origins without credentials, paths, queries, or fragments"
            );
        }
        origins.insert(origin.to_owned());
    }
    if origins.is_empty() {
        bail!("DEV_SEED_ORIGINS must contain at least one origin");
    }
    Ok(origins.into_iter().collect())
}

fn add_not_configured(report: &mut Report, source: &str) {
    report.sources.insert(
        source.to_owned(),
        SourceCount {
            status: "not_configured".to_owned(),
            rows: 0,
            distinct_site_ids: 0,
        },
    );
}

fn create_report_file(path: &Path) -> Result<File> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .context("resolve repository root")?
        .canonicalize()
        .context("canonicalize repository root")?;
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let parent = absolute
        .parent()
        .context("report path must have a parent")?;
    let canonical_parent = parent
        .canonicalize()
        .context("canonicalize report directory")?;
    if canonical_parent.starts_with(&root) {
        bail!("detailed reports must be written outside the repository working tree");
    }
    let file_name = absolute
        .file_name()
        .context("report path must name a file")?;
    let target = canonical_parent.join(file_name);
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .with_context(|| {
            format!(
                "create new local report {} (existing files are never overwritten)",
                target.display()
            )
        })
}

fn write_report(file: &mut File, path: &Path, report: &Report, apply: bool) -> Result<()> {
    let envelope = ReportEnvelope {
        report_version: 1,
        mode: if apply { "apply" } else { "dry_run" },
        notes: vec![
            "Origin values are local comparison clues only and are never website URLs.",
            "Plaintext ingest-key values are excluded from the report.",
            "Processing metadata is cross-check evidence only; runtime state is excluded.",
            "Source-only static candidates require explicit disposition before apply.",
        ],
        report,
    };
    let json = serde_json::to_vec_pretty(&envelope).context("serialize reconciliation report")?;
    file.seek(SeekFrom::Start(0))
        .and_then(|_| file.set_len(0))
        .and_then(|_| file.write_all(&json))
        .with_context(|| format!("write local report {}", path.display()))
}

fn print_summary(report: &Report, apply: bool) {
    println!(
        "mode: {}",
        if apply {
            "apply"
        } else {
            "dry-run (read only)"
        }
    );
    println!("candidate union: {}", report.union_count);
    println!(
        "candidates requiring disposition: {}",
        report.disposition_required.len()
    );
    println!("metadata conflicts: {}", report.metadata_conflicts.len());
    println!("Origin conflicts: {}", report.origin_conflicts.len());
    println!(
        "candidates missing Registry name or URL: {}",
        report.metadata_needs_attention.len()
    );
    if let Some(inserted) = report.applied_count {
        println!("new Registry rows inserted: {inserted}");
        println!(
            "approved candidates processed: {}",
            report
                .candidates
                .values()
                .filter(|candidate| candidate.disposition
                    != Some(site_registry_importer::DispositionAction::Exclude))
                .count()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{Args, parse_origins, validate_args, validate_source};
    use clap::Parser;

    #[test]
    fn source_must_be_explicitly_configured_or_marked_absent() {
        assert!(validate_source("source", false, false).is_err());
        assert!(validate_source("source", true, true).is_err());
        assert!(validate_source("source", true, false).is_ok());
        assert!(validate_source("source", false, true).is_ok());
    }
    #[test]
    fn dev_seed_origins_require_a_configured_site_id() {
        let args = Args::try_parse_from([
            "importer",
            "--report",
            "/tmp/report.json",
            "--dashboard-sites-not-configured",
            "--dashboard-default-not-configured",
            "--collector-not-configured",
            "--definitions-not-configured",
            "--dev-seed-site-id-not-configured",
            "--dev-seed-origins",
            "https://example.com",
        ])
        .unwrap();
        assert!(validate_args(&args).is_err());
    }

    #[test]
    fn dev_seed_origins_are_strict_deduplicated_origins() {
        assert_eq!(
            parse_origins("https://example.com, https://example.com,http://localhost:3000")
                .unwrap(),
            vec!["http://localhost:3000", "https://example.com"]
        );
        assert!(parse_origins("https://example.com/path").is_err());
        assert!(parse_origins("https://user@example.com").is_err());
        assert!(parse_origins("https://example.com,").is_err());
    }
}
