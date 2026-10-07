use crate::{ProcessorError, event_facts, processor::Processor, queries};

impl Processor {
    pub async fn process_one(&self) -> Result<bool, ProcessorError> {
        let mut transaction = self.pool.begin().await?;
        let Some(event) = queries::claim_next_event(&mut transaction).await? else {
            transaction.rollback().await?;
            return Ok(false);
        };

        let capabilities = match self.current_capabilities(&event.site_id).await {
            Ok(capabilities) => capabilities,
            Err(error) => {
                transaction.rollback().await?;
                return Err(error);
            }
        };
        let definitions = if self.database_definitions {
            crate::definition_revisions::load_definition_revision(
                &mut transaction,
                &event.site_id,
                event.received_at,
            )
            .await?
        } else {
            self.definitions.clone()
        };
        event_facts::process_event(&mut transaction, &event, &definitions, &capabilities).await?;
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn process_all_once(&self) -> Result<u64, ProcessorError> {
        let mut processed = 0;
        while self.process_one().await? {
            processed += 1;
        }
        while self.process_rebuild_queue_once().await? {}
        Ok(processed)
    }
}
