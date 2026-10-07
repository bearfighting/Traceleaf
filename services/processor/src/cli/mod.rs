mod arguments;
mod once;
mod rebuild;
mod service;

use arguments::{Cli, Command, ServiceCommand};
use clap::Parser;
use processor::Processor;

pub(super) async fn run() -> anyhow::Result<()> {
    let cli = Cli::parse();
    arguments::validate_command(&cli.command)?;

    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("DATABASE_URL must be configured"))?;
    let processor = Processor::connect(&database_url).await?;

    match cli.command {
        Some(Command::Once { operation }) => once::run(&processor, operation).await,
        Some(Command::Rebuild { operation }) => rebuild::run(&processor, operation).await,
        Some(Command::Service {
            operation: ServiceCommand::Run,
        })
        | None => service::run(processor, cli.poll_interval_ms).await,
    }
}
