use std::collections::HashSet;

use crate::{
    ProcessorError,
    application::Processor,
    domain::parser::{WOOTHEE_VERSION, WootheeParser},
    storage::{
        generations::{facts as generation_facts, lifecycle as generation_storage},
        rebuild_queue, site_lock, watermarks,
    },
};
use chrono::{NaiveDate, Utc};
use serde_json::json;
use sha2::{Digest, Sha256};

use super::{AGGREGATION_VERSION, RebuildRequest, RebuildSummary, facts};

impl Processor {
    pub async fn rebuild_site(
        &self,
        site_id: &str,
        scope_from: NaiveDate,
        scope_to: NaiveDate,
        reason: &str,
        parser_version: &str,
        dry_run: bool,
    ) -> Result<RebuildSummary, ProcessorError> {
        if scope_from > scope_to {
            return Err(ProcessorError::InvalidRebuildScope);
        }
        if parser_version != WOOTHEE_VERSION {
            return Err(ProcessorError::UnsupportedParserVersion(
                parser_version.to_owned(),
            ));
        }
        let events = generation_facts::load_site_events(&self.pool, site_id).await?;
        let summary = RebuildSummary {
            events: events.len(),
            visitors: events
                .iter()
                .filter_map(|event| event.visitor_id.as_deref())
                .collect::<HashSet<_>>()
                .len(),
            scope_from,
            scope_to,
        };
        if dry_run {
            return Ok(summary);
        }
        let capabilities = self.current_capabilities(site_id).await?;
        if !capabilities.enabled(crate::CapabilityId::AnonymousVisitors)
            && !capabilities.enabled(crate::CapabilityId::Sessions)
            && !capabilities.enabled(crate::CapabilityId::BrowserContext)
            && !capabilities.enabled(crate::CapabilityId::Dimensions)
        {
            return Err(ProcessorError::CapabilityDisabled(site_id.to_owned()));
        }

        self.rebuild(RebuildRequest {
            queue_id: None,
            site_id: site_id.to_owned(),
            scope_from,
            scope_to,
            parser_version: parser_version.to_owned(),
            rebuild_reason: reason.to_owned(),
        })
        .await?;
        if !self.database_definitions {
            self.rebuild_conversion_funnel_facts(site_id).await?;
        }
        Ok(summary)
    }

    pub async fn rollback_generation(
        &self,
        site_id: &str,
        target_generation_id: &str,
    ) -> Result<(), ProcessorError> {
        let mut transaction = self.pool.begin().await?;
        let target_status = generation_storage::rollback_target_status(
            &mut transaction,
            site_id,
            target_generation_id,
        )
        .await?
        .ok_or_else(|| ProcessorError::GenerationNotFound {
            site_id: site_id.to_owned(),
            generation_id: target_generation_id.to_owned(),
        })?;

        if target_status != "retired" {
            return Err(ProcessorError::InvalidRollbackTarget {
                generation_id: target_generation_id.to_owned(),
                status: target_status,
            });
        }

        let active_generation_id =
            generation_storage::load_active_generation(&mut transaction, site_id)
                .await?
                .ok_or_else(|| ProcessorError::NoActiveGeneration {
                    site_id: site_id.to_owned(),
                })?;

        generation_storage::retire_active_generation(
            &mut transaction,
            site_id,
            &active_generation_id,
        )
        .await?;
        generation_storage::restore_retired_generation(
            &mut transaction,
            site_id,
            target_generation_id,
        )
        .await?;

        transaction.commit().await?;
        Ok(())
    }

    pub(super) async fn rebuild(&self, request: RebuildRequest) -> Result<(), ProcessorError> {
        let generation_id = new_generation_id(&request.site_id, &request.parser_version);
        match self.rebuild_inner(request.clone(), &generation_id).await {
            Ok(()) => Ok(()),
            Err(error @ ProcessorError::RebuildQueueAlreadyHandled(_))
            | Err(error @ ProcessorError::RebuildQueuePaused(_)) => Err(error),
            Err(error) => {
                let failure_reason = error.to_string();
                let _ = generation_storage::insert_failed_generation(
                    &self.pool,
                    &generation_id,
                    &request.site_id,
                    AGGREGATION_VERSION,
                    &request.parser_version,
                    request.scope_from,
                    request.scope_to,
                    &request.rebuild_reason,
                    &failure_reason,
                )
                .await;
                let _ = if let Some(queue_id) = request.queue_id {
                    rebuild_queue::fail_rebuild_queue_by_id(&self.pool, queue_id, &failure_reason)
                        .await
                } else {
                    rebuild_queue::fail_rebuild_queue_by_scope(
                        &self.pool,
                        &request.site_id,
                        request.scope_from,
                        request.scope_to,
                        &request.rebuild_reason,
                        &request.parser_version,
                        &failure_reason,
                    )
                    .await
                };
                Err(error)
            }
        }
    }

    async fn rebuild_inner(
        &self,
        request: RebuildRequest,
        generation_id: &str,
    ) -> Result<(), ProcessorError> {
        let parser = WootheeParser::new();
        let mut transaction = self.pool.begin().await?;

        site_lock::lock_site(&mut transaction, &request.site_id).await?;
        if let Some(queue_id) = request.queue_id {
            let queue_status =
                rebuild_queue::load_rebuild_queue_status(&mut transaction, queue_id).await?;
            if queue_status == "completed" || queue_status == "failed" {
                return Err(ProcessorError::RebuildQueueAlreadyHandled(queue_id));
            }

            // Re-check after taking the site lock. The initial check happens
            // before claiming the queue; this one protects the generation
            // transaction if the flag is disabled between those operations.
            let enabled = self
                .capabilities
                .snapshot(&request.site_id)
                .is_some_and(|caps| {
                    caps.enabled(crate::CapabilityId::AnonymousVisitors)
                        || caps.enabled(crate::CapabilityId::Sessions)
                        || caps.enabled(crate::CapabilityId::BrowserContext)
                        || caps.enabled(crate::CapabilityId::Dimensions)
                });
            if !enabled {
                rebuild_queue::set_rebuild_pending(&mut transaction, queue_id).await?;
                transaction.commit().await?;
                return Err(ProcessorError::RebuildQueuePaused(queue_id));
            }
        }
        // A generation is a complete site snapshot. Session IDs include the
        // generation ID, so copying unaffected sessions from the previous
        // generation would create invalid cross-generation references. Until
        // scoped generation merge is implemented, every activation must build
        // the full site history to avoid publishing partial aggregates.
        let events = generation_facts::load_site_events(&self.pool, &request.site_id).await?;
        let watermark = match events.iter().map(|event| event.received_at).max() {
            Some(max_received_at) => Some(
                generation_facts::continuous_watermark(
                    &self.pool,
                    &request.site_id,
                    max_received_at,
                )
                .await?,
            ),
            None => None,
        };

        generation_storage::insert_building_generation(
            &mut transaction,
            generation_id,
            &request.site_id,
            AGGREGATION_VERSION,
            &request.parser_version,
            request.scope_from,
            request.scope_to,
            &request.rebuild_reason,
            json!({
                "visitor_session": watermark.map(|value| value.to_rfc3339()),
                "dimensions": watermark.map(|value| value.to_rfc3339())
            }),
        )
        .await?;

        let active_generation =
            generation_storage::load_active_generation(&mut transaction, &request.site_id).await?;
        let capabilities = self.current_capabilities(&request.site_id).await?;
        facts::write_derived_results(
            &mut transaction,
            generation_id,
            &events,
            &parser,
            &capabilities,
            request.queue_id.is_none(),
        )
        .await?;
        facts::copy_disabled_generation_facts(
            &mut transaction,
            generation_id,
            active_generation.as_deref(),
            &capabilities,
            request.queue_id.is_none(),
        )
        .await?;
        generation_facts::refresh_rollups(&mut transaction, generation_id).await?;

        if let Some(watermark) = watermark {
            watermarks::advance_generation_watermarks(
                &mut transaction,
                &request.site_id,
                generation_id,
                watermark,
            )
            .await?;
        }

        if let Some(active_generation) = active_generation {
            generation_storage::retire_generation(
                &mut transaction,
                &request.site_id,
                &active_generation,
            )
            .await?;
        }

        generation_storage::activate_generation(&mut transaction, generation_id).await?;
        if request.queue_id.is_some() {
            rebuild_queue::complete_incremental_rebuilds(&mut transaction, &request.site_id)
                .await?;
        } else if request.rebuild_reason == "backfill" {
            rebuild_queue::complete_backfill_rebuilds(
                &mut transaction,
                &request.site_id,
                request.scope_from,
                request.scope_to,
            )
            .await?;
        }

        transaction.commit().await?;
        Ok(())
    }
}

fn new_generation_id(site_id: &str, parser_version: &str) -> String {
    let input = format!(
        "phase6-generation\0{site_id}\0{parser_version}\0{}",
        Utc::now()
    );
    let digest = Sha256::digest(input.as_bytes());
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}
