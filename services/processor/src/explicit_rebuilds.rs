use chrono::{DateTime, Utc};

use crate::{ProcessorError, event_facts, models::RawEvent, processor::Processor, queries};

impl Processor {
    pub async fn rebuild_conversion_funnel_facts_for_version(
        &self,
        site_id: &str,
        version: &str,
    ) -> Result<u64, ProcessorError> {
        let (row_revision, document) = sqlx::query_as::<_, (i64, serde_json::Value)>("SELECT revision, document FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$2").bind(site_id).bind(version).fetch_optional(&self.pool).await?.ok_or_else(|| ProcessorError::InvalidDefinitions(format!("definition version {version} does not exist for site {site_id}")))?;
        let revision = configuration_runtime::DefinitionRevisionView::parse(
            &document,
            site_id,
            Some(row_revision),
            Some(version),
        )
        .map_err(ProcessorError::InvalidDefinitions)?;
        let site = serde_json::json!({"site_id":site_id,"conversions":revision.conversions,"funnels":revision.funnels});
        let definitions: crate::definitions::AnalyticsDefinitions =
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
        queries::lock_site(&mut transaction, site_id).await?;
        sqlx::query("DELETE FROM custom_event_facts WHERE site_id = $1")
            .bind(site_id)
            .execute(&mut *transaction)
            .await?;
        let result = sqlx::query(
            "INSERT INTO custom_event_facts (raw_event_id, site_id, event_id, occurred_at, received_at, event_name)
             SELECT id, site_id, event_id, occurred_at, received_at, payload->>'event_name'
             FROM raw_events
             WHERE site_id = $1 AND event_type = 'custom_event' AND processed_at IS NOT NULL",
        )
        .bind(site_id)
        .execute(&mut *transaction)
        .await?;
        queries::advance_custom_event_watermark(&mut transaction, site_id).await?;
        sqlx::query(
            "UPDATE analytics_watermarks
             SET definition_version = NULL, updated_at = NOW()
             WHERE site_id = $1 AND generation_id IS NULL
               AND source_name IN ('conversions', 'funnels')",
        )
        .bind(site_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        if !self.database_definitions {
            self.rebuild_conversion_funnel_facts(site_id).await?;
        }
        Ok(result.rows_affected())
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
        queries::lock_site(&mut tx, site_id).await?;
        sqlx::query("DELETE FROM geo_country_facts WHERE site_id=$1")
            .bind(site_id)
            .execute(&mut *tx)
            .await?;
        let result = sqlx::query(
            "INSERT INTO geo_country_facts(raw_event_id,site_id,country_code,occurred_at)
             SELECT m.raw_event_id,m.site_id,m.country_code,r.occurred_at
             FROM geo_event_metadata m JOIN raw_events r ON r.id=m.raw_event_id
             WHERE m.site_id=$1 AND r.event_type='page_view' AND r.processed_at IS NOT NULL
             ON CONFLICT(raw_event_id) DO UPDATE SET country_code=EXCLUDED.country_code,occurred_at=EXCLUDED.occurred_at",
        )
        .bind(site_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(result.rows_affected())
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
        queries::lock_site(&mut tx, site_id).await?;
        sqlx::query("DELETE FROM web_vital_facts WHERE site_id=$1")
            .bind(site_id)
            .execute(&mut *tx)
            .await?;
        let result = sqlx::query("INSERT INTO web_vital_facts(raw_event_id,site_id,page_view_event_id,page_view_occurred_at,path,metric,value,rating,navigation_type,report_sequence) SELECT DISTINCT ON (w.site_id,w.payload->>'page_view_event_id',w.payload->>'metric') w.id,w.site_id,w.payload->>'page_view_event_id',to_timestamp((w.payload->>'page_view_occurred_at')::double precision/1000),w.payload->>'path',w.payload->>'metric',(w.payload->>'value')::double precision,w.payload->>'rating',w.payload->>'navigation_type',(w.payload->>'report_sequence')::bigint FROM raw_events w JOIN raw_events p ON p.site_id=w.site_id AND p.event_id=w.payload->>'page_view_event_id' AND p.event_type='page_view' AND p.path=w.payload->>'path' AND p.occurred_at=to_timestamp((w.payload->>'page_view_occurred_at')::double precision/1000) WHERE w.site_id=$1 AND w.event_type='web_vital' AND w.processed_at IS NOT NULL ORDER BY w.site_id,w.payload->>'page_view_event_id',w.payload->>'metric',(w.payload->>'report_sequence')::bigint DESC,w.id ASC ON CONFLICT(site_id,page_view_event_id,metric) DO UPDATE SET raw_event_id=EXCLUDED.raw_event_id,page_view_occurred_at=EXCLUDED.page_view_occurred_at,path=EXCLUDED.path,value=EXCLUDED.value,rating=EXCLUDED.rating,navigation_type=EXCLUDED.navigation_type,report_sequence=EXCLUDED.report_sequence WHERE EXCLUDED.report_sequence>web_vital_facts.report_sequence OR (EXCLUDED.report_sequence=web_vital_facts.report_sequence AND EXCLUDED.raw_event_id<web_vital_facts.raw_event_id)").bind(site_id).execute(&mut *tx).await?;
        queries::advance_web_vital_watermark(&mut tx, site_id).await?;
        tx.commit().await?;
        Ok(result.rows_affected())
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
        queries::lock_site(&mut tx, site_id).await?;
        if capabilities.enabled(crate::CapabilityId::Conversions) {
            if explicit_backfill {
                sqlx::query(
                    "DELETE FROM conversion_facts WHERE site_id=$1 AND definition_version=$2",
                )
                .bind(site_id)
                .bind(&self.definitions.version)
                .execute(&mut *tx)
                .await?;
            } else if let Some(enabled_since) =
                capabilities.enabled_since(crate::CapabilityId::Conversions)
            {
                sqlx::query("DELETE FROM conversion_facts f USING raw_events r WHERE f.site_id=$1 AND f.definition_version=$2 AND r.site_id=f.site_id AND r.event_id=f.event_id AND r.received_at >= $3")
                    .bind(site_id).bind(&self.definitions.version).bind(enabled_since)
                    .execute(&mut *tx).await?;
            }
        }
        if capabilities.enabled(crate::CapabilityId::Funnels) {
            if explicit_backfill {
                sqlx::query(
                    "DELETE FROM funnel_step_facts WHERE site_id=$1 AND definition_version=$2",
                )
                .bind(site_id)
                .bind(&self.definitions.version)
                .execute(&mut *tx)
                .await?;
            } else if let Some(enabled_since) =
                capabilities.enabled_since(crate::CapabilityId::Funnels)
            {
                sqlx::query("DELETE FROM funnel_step_facts f USING raw_events r WHERE f.site_id=$1 AND f.definition_version=$2 AND r.site_id=f.site_id AND r.event_id=f.event_id AND r.received_at >= $3")
                    .bind(site_id).bind(&self.definitions.version).bind(enabled_since)
                    .execute(&mut *tx).await?;
            }
        }
        let events = sqlx::query_as::<_, (i64, String, DateTime<Utc>, DateTime<Utc>, Option<String>, serde_json::Value)>(
            "SELECT id,event_id,occurred_at,received_at,visitor_id::text,payload FROM raw_events WHERE site_id=$1 AND event_type='custom_event' AND processed_at IS NOT NULL ORDER BY occurred_at,event_id")
            .bind(site_id).fetch_all(&mut *tx).await?;
        let mut count = 0_u64;
        for (id, event_id, occurred_at, received_at, visitor_id, payload) in events {
            let session_id = if capabilities.enabled(crate::CapabilityId::Sessions) {
                if let Some(visitor_id) = visitor_id.as_deref() {
                    sqlx::query_scalar::<_, String>("SELECT se.session_id::text FROM session_events se JOIN analytics_generations g ON g.generation_id=se.generation_id AND g.site_id=se.site_id AND g.status='active' WHERE se.site_id=$1 AND se.visitor_id=$2::uuid AND se.occurred_at <= $3 AND se.occurred_at > $3 - INTERVAL '30 minutes' AND (se.occurred_at AT TIME ZONE 'UTC')::date=($3 AT TIME ZONE 'UTC')::date ORDER BY se.occurred_at DESC LIMIT 1")
                    .bind(site_id).bind(visitor_id).bind(occurred_at).fetch_optional(&mut *tx).await?
                } else {
                    None
                }
            } else {
                None
            };
            if capabilities.enabled(crate::CapabilityId::Sessions) {
                sqlx::query("UPDATE custom_event_facts SET session_id=$3::uuid WHERE site_id=$1 AND event_id=$2")
                    .bind(site_id).bind(&event_id).bind(session_id.as_deref()).execute(&mut *tx).await?;
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
