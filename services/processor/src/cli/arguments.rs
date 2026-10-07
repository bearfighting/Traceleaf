use chrono::NaiveDate;
use clap::{Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(name = "processor", version, about = "Process Page View raw events")]
pub(super) struct Cli {
    #[command(subcommand)]
    pub(super) command: Option<Command>,
    #[arg(
        long,
        env = "PROCESSOR_POLL_INTERVAL_MS",
        default_value_t = 1_000,
        global = true
    )]
    pub(super) poll_interval_ms: u64,
}

#[derive(Debug, Subcommand)]
pub(super) enum Command {
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
pub(super) enum ServiceCommand {
    Run,
}

#[derive(Debug, Subcommand)]
pub(super) enum OnceCommand {
    Process,
    Definitions {
        #[command(subcommand)]
        operation: DefinitionsCommand,
    },
}

#[derive(Debug, Subcommand)]
pub(super) enum DefinitionsCommand {
    ImportIfEmpty,
}

#[derive(Debug, Subcommand)]
pub(super) enum RebuildCommand {
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
pub(super) enum FactsTarget {
    CustomEvents,
    WebVitals,
    ConversionFunnels,
    GeoCountry,
}

fn parse_date(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|error| format!("invalid date {value}: {error}"))
}

pub(super) fn validate_command(command: &Option<Command>) -> anyhow::Result<()> {
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

        let invalid = Cli::try_parse_from([
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
        assert!(validate_command(&invalid.command).is_err());

        let valid = Cli::try_parse_from([
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
            valid.command,
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
    fn service_and_default_modes_parse_poll_interval_overrides() {
        let service =
            Cli::try_parse_from(["processor", "service", "run", "--poll-interval-ms", "250"])
                .expect("service arguments should parse");
        assert!(matches!(
            service.command,
            Some(Command::Service {
                operation: ServiceCommand::Run
            })
        ));
        assert_eq!(service.poll_interval_ms, 250);

        let default = Cli::try_parse_from(["processor", "--poll-interval-ms", "500"])
            .expect("default service arguments should parse");
        assert!(default.command.is_none());
        assert_eq!(default.poll_interval_ms, 500);
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
        assert!(matches!(
            cli.command,
            Some(Command::Rebuild {
                operation: RebuildCommand::Generation {
                    from: Some(date),
                    dry_run: true,
                    ..
                }
            }) if date == NaiveDate::from_ymd_opt(2026, 9, 1).unwrap()
        ));
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
        let cli = Cli::try_parse_from(["processor", "once", "definitions", "import-if-empty"])
            .expect("definition import arguments should parse");
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
