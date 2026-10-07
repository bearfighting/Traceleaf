use std::time::Duration;

use chrono::NaiveDate;
use clap::{Parser, Subcommand, ValueEnum};
use processor::{Processor, WOOTHEE_VERSION};
use tracing::{error, info};

#[derive(Debug, Parser)]
#[command(name = "processor", version, about = "Process Page View raw events")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    #[arg(
        long,
        env = "PROCESSOR_POLL_INTERVAL_MS",
        default_value_t = 1_000,
        global = true
    )]
    poll_interval_ms: u64,
}

#[derive(Debug, Subcommand)]
enum Command {
    Service {
        #[command(subcommand)]
        operation: ServiceCommand,
    },
    Once {
        #[command(subcommand)]
        operation: OnceCommand,
    },
    Rebuild {
        #[command(subcommand)]
        operation: RebuildCommand,
    },
}

#[derive(Debug, Subcommand)]
enum ServiceCommand {
    Run,
}

#[derive(Debug, Subcommand)]
enum OnceCommand {
    Process,
    Definitions {
        #[command(subcommand)]
        operation: DefinitionsCommand,
    },
}

#[derive(Debug, Subcommand)]
enum RebuildCommand {
    Generation {
        #[arg(long)]
        site_id: String,
        #[arg(long, value_parser = parse_date)]
        from: Option<NaiveDate>,
        #[arg(long, value_parser = parse_date)]
        to: Option<NaiveDate>,
        #[arg(long)]
        dry_run: bool,
    },
    Backfill {
        #[arg(long)]
        site_id: String,
        #[arg(long, value_parser = parse_date)]
        from: Option<NaiveDate>,
        #[arg(long, value_parser = parse_date)]
        to: Option<NaiveDate>,
        #[arg(long)]
        dry_run: bool,
    },
    Reparse {
        #[arg(long)]
        site_id: String,
        #[arg(long, value_parser = parse_date)]
        from: Option<NaiveDate>,
        #[arg(long, value_parser = parse_date)]
        to: Option<NaiveDate>,
        #[arg(long)]
        parser_version: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
    Facts {
        #[arg(long, value_enum)]
        target: FactsTarget,
        #[arg(long)]
        site_id: String,
        #[arg(long, required_if_eq("target", "conversion-funnels"))]
        definition_version: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum FactsTarget {
    CustomEvents,
    WebVitals,
    ConversionFunnels,
    GeoCountry,
}

#[derive(Debug, Subcommand)]
enum DefinitionsCommand {
    ImportIfEmpty,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();
    validate_command(&cli.command)?;
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("DATABASE_URL must be configured"))?;
    let processor = Processor::connect(&database_url).await?;

    match cli.command {
        Some(Command::Once {
            operation:
                OnceCommand::Definitions {
                    operation: DefinitionsCommand::ImportIfEmpty,
                },
        }) => {
            let definitions_path = std::env::var("ANALYTICS_DEFINITIONS_FILE")
                .unwrap_or_else(|_| "config/analytics-definitions.json".to_owned());
            let definitions =
                processor::definitions::AnalyticsDefinitions::load(&definitions_path)?;
            let document: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&definitions_path)?)?;
            let imported = processor.import_definitions_if_empty(&document).await?;
            info!(
                imported,
                source_version = definitions.version,
                "empty-site definition import complete"
            );
            return Ok(());
        }

        Some(Command::Once {
            operation: OnceCommand::Process,
        }) => {
            let processed = processor.process_all_once().await?;
            info!(processed, "processor backlog complete");
            return Ok(());
        }
        Some(Command::Rebuild { operation }) => {
            if let RebuildCommand::Facts {
                target,
                site_id,
                definition_version,
            } = operation
            {
                let count = match target {
                    FactsTarget::CustomEvents => {
                        processor.rebuild_custom_event_facts(&site_id).await?
                    }
                    FactsTarget::WebVitals => processor.rebuild_web_vital_facts(&site_id).await?,
                    FactsTarget::ConversionFunnels => {
                        processor
                            .rebuild_conversion_funnel_facts_for_version(
                                &site_id,
                                definition_version
                                    .as_deref()
                                    .expect("clap requires --definition-version"),
                            )
                            .await?
                    }
                    FactsTarget::GeoCountry => {
                        processor.rebuild_geo_country_facts(&site_id).await?
                    }
                };
                info!(site_id, facts = count, "derived facts rebuilt");
                return Ok(());
            }
            let (site_id, from, to, reason, parser_version, dry_run) = match operation {
                RebuildCommand::Generation {
                    site_id,
                    from,
                    to,
                    dry_run,
                } => (
                    site_id,
                    from,
                    to,
                    "initial",
                    WOOTHEE_VERSION.to_owned(),
                    dry_run,
                ),
                RebuildCommand::Backfill {
                    site_id,
                    from,
                    to,
                    dry_run,
                } => (
                    site_id,
                    from,
                    to,
                    "backfill",
                    WOOTHEE_VERSION.to_owned(),
                    dry_run,
                ),
                RebuildCommand::Reparse {
                    site_id,
                    from,
                    to,
                    parser_version,
                    dry_run,
                } => (
                    site_id,
                    from,
                    to,
                    "reparse",
                    parser_version.unwrap_or_else(|| WOOTHEE_VERSION.to_owned()),
                    dry_run,
                ),
                RebuildCommand::Facts { .. } => unreachable!(),
            };
            let from = from.unwrap_or(NaiveDate::MIN);
            let to = to.unwrap_or(NaiveDate::MAX);
            let summary = processor
                .rebuild_site(&site_id, from, to, reason, &parser_version, dry_run)
                .await?;
            info!(
                site_id,
                events = summary.events,
                visitors = summary.visitors,
                dry_run,
                "site generation rebuild complete"
            );
            return Ok(());
        }
        Some(Command::Service {
            operation: ServiceCommand::Run,
        }) => {
            run_service(processor, cli.poll_interval_ms).await?;
            return Ok(());
        }
        None => {}
    }

    run_service(processor, cli.poll_interval_ms).await
}

fn validate_command(command: &Option<Command>) -> anyhow::Result<()> {
    if let Some(Command::Rebuild {
        operation:
            RebuildCommand::Facts {
                target,
                definition_version: Some(_),
                ..
            },
    }) = command
        && !matches!(target, FactsTarget::ConversionFunnels)
    {
        anyhow::bail!("--definition-version is only valid with --target conversion-funnels");
    }
    Ok(())
}

async fn run_service(processor: Processor, poll_interval_ms: u64) -> anyhow::Result<()> {
    let interval = Duration::from_millis(poll_interval_ms);
    loop {
        match processor.process_one().await {
            Ok(true) => {}
            Ok(false) => {
                if processor.process_rebuild_queue_once().await? {
                    continue;
                }
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {}
                    _ = tokio::signal::ctrl_c() => {
                        info!("processor stopped");
                        return Ok(());
                    }
                }
            }
            Err(error) => {
                error!(%error, "processor transaction failed; will retry");
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {}
                    _ = tokio::signal::ctrl_c() => {
                        info!("processor stopped");
                        return Ok(());
                    }
                }
            }
        }
    }
}

fn parse_date(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|error| format!("invalid date {value}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        Cli, Command, DefinitionsCommand, FactsTarget, OnceCommand, RebuildCommand, ServiceCommand,
        validate_command,
    };
    use chrono::NaiveDate;
    use clap::Parser;

    #[test]
    fn facts_rebuild_requires_site_id_and_accepts_valid_target() {
        assert!(
            Cli::try_parse_from(["processor", "rebuild", "facts", "--target", "geo-country"])
                .is_err()
        );
        let cli = Cli::try_parse_from([
            "processor",
            "rebuild",
            "facts",
            "--target",
            "geo-country",
            "--site-id",
            "site_geo",
        ])
        .expect("Geo rebuild arguments should parse");
        assert!(matches!(
            cli.command,
            Some(Command::Rebuild {
                operation: RebuildCommand::Facts {
                    target: FactsTarget::GeoCountry,
                    ..
                }
            })
        ));
    }

    #[test]
    fn conversion_funnel_rebuild_requires_definition_version() {
        assert!(
            Cli::try_parse_from([
                "processor",
                "rebuild",
                "facts",
                "--target",
                "conversion-funnels",
                "--site-id",
                "site_a"
            ])
            .is_err()
        );
        let cli = Cli::try_parse_from([
            "processor",
            "rebuild",
            "facts",
            "--target",
            "custom-events",
            "--site-id",
            "site_a",
            "--definition-version",
            "unused-version",
        ])
        .unwrap();
        assert!(validate_command(&cli.command).is_err());
        let cli = Cli::try_parse_from([
            "processor",
            "rebuild",
            "facts",
            "--target",
            "conversion-funnels",
            "--site-id",
            "site_a",
            "--definition-version",
            "r2-x",
        ])
        .unwrap();
        assert!(matches!(
            cli.command,
            Some(Command::Rebuild {
                operation: RebuildCommand::Facts {
                    target: FactsTarget::ConversionFunnels,
                    ..
                }
            })
        ));
        assert!(
            Cli::try_parse_from([
                "processor",
                "rebuild",
                "facts",
                "--target",
                "unknown",
                "--site-id",
                "site_a"
            ])
            .is_err()
        );
    }

    #[test]
    fn once_process_is_an_explicit_single_run_command() {
        let cli =
            Cli::try_parse_from(["processor", "once", "process"]).expect("arguments should parse");

        assert!(matches!(
            cli.command,
            Some(Command::Once {
                operation: OnceCommand::Process
            })
        ));
    }

    #[test]
    fn service_poll_interval_can_be_overridden() {
        let cli = Cli::try_parse_from(["processor", "service", "run", "--poll-interval-ms", "250"])
            .expect("arguments should parse");

        assert!(matches!(
            cli.command,
            Some(Command::Service {
                operation: ServiceCommand::Run
            })
        ));
        assert_eq!(cli.poll_interval_ms, 250);
    }

    #[test]
    fn poll_interval_can_be_overridden_without_a_subcommand() {
        let cli = Cli::try_parse_from(["processor", "--poll-interval-ms", "250"])
            .expect("arguments should parse");

        assert!(cli.command.is_none());
        assert_eq!(cli.poll_interval_ms, 250);
    }

    #[test]
    fn rebuild_arguments_parse() {
        let cli = Cli::try_parse_from([
            "processor",
            "rebuild",
            "generation",
            "--site-id",
            "site_example",
            "--from",
            "2026-09-01",
            "--to",
            "2026-09-18",
            "--dry-run",
        ])
        .expect("rebuild arguments should parse");
        assert!(
            matches!(cli.command, Some(Command::Rebuild { operation: RebuildCommand::Generation { from: Some(date), dry_run: true, .. } }) if date == NaiveDate::from_ymd_opt(2026, 9, 1).unwrap())
        );
    }

    #[test]
    fn backfill_accepts_dry_run() {
        let cli = Cli::try_parse_from([
            "processor",
            "rebuild",
            "backfill",
            "--site-id",
            "site_example",
            "--dry-run",
        ])
        .expect("backfill dry-run arguments should parse");

        assert!(matches!(
            cli.command,
            Some(Command::Rebuild {
                operation: RebuildCommand::Backfill { dry_run: true, .. }
            })
        ));
    }

    #[test]
    fn definitions_import_if_empty_subcommand_parses() {
        let cli =
            Cli::try_parse_from(["processor", "once", "definitions", "import-if-empty"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(Command::Once {
                operation: OnceCommand::Definitions {
                    operation: DefinitionsCommand::ImportIfEmpty
                }
            })
        ));
    }
}
