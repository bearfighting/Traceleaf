use chrono::NaiveDate;

use crate::{
    ProcessorError, application::Processor, storage::generation_lifecycle as generation_storage,
};

use super::{AGGREGATION_VERSION, RebuildRequest};

impl Processor {
    pub async fn process_rebuild_queue_once(&self) -> Result<bool, ProcessorError> {
        let mut transaction = self.pool.begin().await?;
        let request = generation_storage::claim_next_incremental_rebuild(&mut transaction).await?;

        let Some((queue_id, site_id, scope_from, scope_to, parser_version, rebuild_reason)) =
            request
        else {
            transaction.rollback().await?;
            return Ok(false);
        };

        // Do not claim work while every capability that feeds this generation is disabled.
        // Keeping the row pending makes this a safe pause instead of a failed rebuild.
        let capabilities = self.current_capabilities(&site_id).await?;
        if !(capabilities.enabled(crate::CapabilityId::AnonymousVisitors)
            || capabilities.enabled(crate::CapabilityId::Sessions)
            || capabilities.enabled(crate::CapabilityId::BrowserContext)
            || capabilities.enabled(crate::CapabilityId::Dimensions))
        {
            transaction.rollback().await?;
            return Ok(false);
        }

        generation_storage::set_rebuild_running(&mut transaction, queue_id).await?;
        transaction.commit().await?;

        let request = RebuildRequest {
            queue_id: Some(queue_id),
            site_id,
            scope_from,
            scope_to,
            parser_version,
            rebuild_reason,
        };
        let rebuilt_site_id = request.site_id.clone();
        match self.rebuild(request).await {
            Ok(()) => {
                if !self.database_definitions {
                    self.rebuild_conversion_funnel_facts_with_mode(&rebuilt_site_id, false)
                        .await?;
                }
                Ok(true)
            }
            Err(ProcessorError::RebuildQueueAlreadyHandled(_)) => Ok(true),
            Err(ProcessorError::RebuildQueuePaused(_)) => Ok(false),
            Err(error) => {
                generation_storage::set_rebuild_failed(&self.pool, queue_id, &error.to_string())
                    .await?;
                Err(error)
            }
        }
    }

    pub async fn enqueue_rebuild(
        &self,
        site_id: &str,
        scope_from: NaiveDate,
        scope_to: NaiveDate,
        reason: &str,
        parser_version: &str,
    ) -> Result<(), ProcessorError> {
        if scope_from > scope_to {
            return Err(ProcessorError::InvalidRebuildScope);
        }
        generation_storage::enqueue_site_rebuild(
            &self.pool,
            site_id,
            scope_from,
            scope_to,
            AGGREGATION_VERSION,
            parser_version,
            reason,
        )
        .await?;
        Ok(())
    }
}
