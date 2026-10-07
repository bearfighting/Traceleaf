use chrono::NaiveDate;
use processor::{Processor, WOOTHEE_VERSION};
use tracing::info;

use super::arguments::{FactsTarget, RebuildCommand};

pub(super) async fn run(processor: &Processor, command: RebuildCommand) -> anyhow::Result<()> {
    match command {
        RebuildCommand::Facts {
            target,
            site_id,
            definition_version,
        } => rebuild_facts(processor, target, &site_id, definition_version.as_deref()).await?,
        command => rebuild_generation(processor, command).await?,
    }
    Ok(())
}

async fn rebuild_facts(
    processor: &Processor,
    target: FactsTarget,
    site_id: &str,
    definition_version: Option<&str>,
) -> anyhow::Result<()> {
    let count = match target {
        FactsTarget::CustomEvents => processor.rebuild_custom_event_facts(site_id).await?,
        FactsTarget::WebVitals => processor.rebuild_web_vital_facts(site_id).await?,
        FactsTarget::ConversionFunnels => {
            let version = definition_version.ok_or_else(|| {
                anyhow::anyhow!("--definition-version is required for conversion-funnels")
            })?;
            processor
                .rebuild_conversion_funnel_facts_for_version(site_id, version)
                .await?
        }
        FactsTarget::GeoCountry => processor.rebuild_geo_country_facts(site_id).await?,
    };
    info!(site_id, facts = count, "derived facts rebuilt");
    Ok(())
}

async fn rebuild_generation(processor: &Processor, command: RebuildCommand) -> anyhow::Result<()> {
    let (site_id, from, to, reason, parser_version, dry_run) = match command {
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
        RebuildCommand::Facts { .. } => unreachable!("facts rebuild is handled separately"),
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
    Ok(())
}
