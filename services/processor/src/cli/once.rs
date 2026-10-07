use processor::{Processor, definitions::AnalyticsDefinitions};
use tracing::info;

use super::arguments::{DefinitionsCommand, OnceCommand};

pub(super) async fn run(processor: &Processor, command: OnceCommand) -> anyhow::Result<()> {
    match command {
        OnceCommand::Process => {
            let processed = processor.process_all_once().await?;
            info!(processed, "processor backlog complete");
        }
        OnceCommand::Definitions {
            operation: DefinitionsCommand::ImportIfEmpty,
        } => import_definitions_if_empty(processor).await?,
    }
    Ok(())
}

async fn import_definitions_if_empty(processor: &Processor) -> anyhow::Result<()> {
    let definitions_path = std::env::var("ANALYTICS_DEFINITIONS_FILE")
        .unwrap_or_else(|_| "config/analytics-definitions.json".to_owned());
    let definitions = AnalyticsDefinitions::load(&definitions_path)?;
    let document: serde_json::Value = serde_json::from_slice(&std::fs::read(&definitions_path)?)?;
    let imported = processor.import_definitions_if_empty(&document).await?;
    info!(
        imported,
        source_version = definitions.version,
        "empty-site definition import complete"
    );
    Ok(())
}
