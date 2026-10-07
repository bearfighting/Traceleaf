use crate::{
    Processor, ProcessorError,
    application::event_facts,
    domain::models::RawEvent,
    storage::{
        definitions,
        facts::{conversion_funnels, custom_events, geo_country, sessions, web_vitals},
        site_lock, watermarks,
    },
};

impl Processor {
    pub async fn rebuild_conversion_funnel_facts_for_version(
        &self,
        site_id: &str,
        version: &str,
    ) -> Result<u64, ProcessorError> {
        let (row_revision, document) =
            definitions::load_definition_revision_for_version(&self.pool, site_id, version)
                .await?
                .ok_or_else(|| {
                    ProcessorError::InvalidDefinitions(format!(
                        "definition version {version} does not exist for site {site_id}"
                    ))
                })?;
        let revision = configuration_runtime::DefinitionRevisionView::parse(
            &document,
            site_id,
            Some(row_revision),
            Some(version),
        )
        .map_err(ProcessorError::InvalidDefinitions)?;
        let site = serde_json::json!({"site_id":site_id,"conversions":revision.conversions,"funnels":revision.funnels});
        let definitions: crate::domain::definitions::AnalyticsDefinitions =
            serde_json::from_value(serde_json::json!({"version":version,"sites":[site]}))
                .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
        definitions
            .validate()
            .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
        let mut processor = self.clone();
        processor.definitions = definitions;
        processor.database_definitions = false;
        processor.rebuild_conversion_funnel_facts(site_id).await
    }

    pub async fn rebuild_custom_event_facts(&self, site_id: &str) -> Result<u64, ProcessorError> {
        if !self
            .current_capabilities(site_id)
            .await?
            .enabled(crate::CapabilityId::CustomEvents)
        {
            return Err(ProcessorError::CapabilityDisabled(site_id.to_owned()));
        }
        let mut transaction = self.pool.begin().await?;
        site_lock::lock_site(&mut transaction, site_id).await?;
        let affected_rows =
            custom_events::rebuild_custom_event_facts(&mut transaction, site_id).await?;
        watermarks::advance_custom_event_watermark(&mut transaction, site_id).await?;
        watermarks::clear_conversion_funnel_watermark_versions(&mut transaction, site_id).await?;
        transaction.commit().await?;
        if !self.database_definitions {
            self.rebuild_conversion_funnel_facts(site_id).await?;
        }
        Ok(affected_rows)
    }

    pub async fn rebuild_conversion_funnel_facts(
        &self,
        site_id: &str,
    ) -> Result<u64, ProcessorError> {
        self.rebuild_conversion_funnel_facts_with_mode(site_id, true)
            .await
    }

    pub async fn rebuild_geo_country_facts(&self, site_id: &str) -> Result<u64, ProcessorError> {
        if !self
            .current_capabilities(site_id)
            .await?
            .enabled(crate::CapabilityId::Geo)
        {
            return Err(ProcessorError::CapabilityDisabled(site_id.to_owned()));
        }
        let mut tx = self.pool.begin().await?;
        site_lock::lock_site(&mut tx, site_id).await?;
        let affected_rows = geo_country::rebuild_geo_country_facts(&mut tx, site_id).await?;
        tx.commit().await?;
        Ok(affected_rows)
    }

    pub async fn rebuild_web_vital_facts(&self, site_id: &str) -> Result<u64, ProcessorError> {
        if !self
            .current_capabilities(site_id)
            .await?
            .enabled(crate::CapabilityId::WebVitals)
        {
            return Err(ProcessorError::CapabilityDisabled(site_id.to_owned()));
        }
        let mut tx = self.pool.begin().await?;
        site_lock::lock_site(&mut tx, site_id).await?;
        let affected_rows = web_vitals::rebuild_web_vital_facts(&mut tx, site_id).await?;
        watermarks::advance_web_vital_watermark(&mut tx, site_id).await?;
        tx.commit().await?;
        Ok(affected_rows)
    }

    pub(super) async fn rebuild_conversion_funnel_facts_with_mode(
        &self,
        site_id: &str,
        explicit_backfill: bool,
    ) -> Result<u64, ProcessorError> {
        let capabilities = self.current_capabilities(site_id).await?;
        if !capabilities.enabled(crate::CapabilityId::Conversions)
            && !capabilities.enabled(crate::CapabilityId::Funnels)
        {
            return Ok(0);
        }
        let mut tx = self.pool.begin().await?;
        site_lock::lock_site(&mut tx, site_id).await?;
        if capabilities.enabled(crate::CapabilityId::Conversions) {
            if explicit_backfill {
                conversion_funnels::delete_conversion_facts_for_version(
                    &mut tx,
                    site_id,
                    &self.definitions.version,
                )
                .await?;
            } else if let Some(enabled_since) =
                capabilities.enabled_since(crate::CapabilityId::Conversions)
            {
                conversion_funnels::delete_conversion_facts_since(
                    &mut tx,
                    site_id,
                    &self.definitions.version,
                    enabled_since,
                )
                .await?;
            }
        }
        if capabilities.enabled(crate::CapabilityId::Funnels) {
            if explicit_backfill {
                conversion_funnels::delete_funnel_facts_for_version(
                    &mut tx,
                    site_id,
                    &self.definitions.version,
                )
                .await?;
            } else if let Some(enabled_since) =
                capabilities.enabled_since(crate::CapabilityId::Funnels)
            {
                conversion_funnels::delete_funnel_facts_since(
                    &mut tx,
                    site_id,
                    &self.definitions.version,
                    enabled_since,
                )
                .await?;
            }
        }
        let events = custom_events::load_processed_custom_events(&mut tx, site_id).await?;
        let mut count = 0_u64;
        for (id, event_id, occurred_at, received_at, visitor_id, payload) in events {
            let session_id = if capabilities.enabled(crate::CapabilityId::Sessions) {
                if let Some(visitor_id) = visitor_id.as_deref() {
                    sessions::find_active_session(&mut tx, site_id, visitor_id, occurred_at).await?
                } else {
                    None
                }
            } else {
                None
            };
            if capabilities.enabled(crate::CapabilityId::Sessions) {
                custom_events::set_custom_event_session(
                    &mut tx,
                    site_id,
                    &event_id,
                    session_id.as_deref(),
                )
                .await?;
            }
            let event = RawEvent {
                id,
                event_id,
                site_id: site_id.to_owned(),
                occurred_at,
                received_at,
                path: String::new(),
                visitor_id,
                context_schema_version: None,
                payload,
            };
            let event_name = event
                .payload
                .get("event_name")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| ProcessorError::InvalidCustomEvent(event.event_id.clone()))?;
            event_facts::record_conversion_and_funnel_facts(
                &mut tx,
                &event,
                &self.definitions,
                event_name,
                session_id,
                &capabilities,
                explicit_backfill,
            )
            .await?;
            count += 1;
        }
        event_facts::advance_definition_watermarks(
            &mut tx,
            site_id,
            &self.definitions.version,
            true,
        )
        .await?;
        tx.commit().await?;
        Ok(count)
    }
}
