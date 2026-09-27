use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction, postgres::PgPoolOptions};

use crate::{
    ProcessorError,
    models::RawEvent,
    normalizer::{NormalizedContext, normalize_context},
    parser::{UserAgentParser, WOOTHEE_VERSION, WootheeParser},
    queries,
    sessionizer::{SessionInput, SessionOutput, sessionize},
};

const AGGREGATION_VERSION: i32 = 1;
type DimensionDailyKey = (String, NaiveDate, String, String);
type DimensionDailyCounts = (i64, HashSet<String>, HashSet<String>);

#[derive(Clone)]
pub struct Processor {
    pool: PgPool,
    definitions: crate::definitions::AnalyticsDefinitions,
    database_definitions: bool,
    capabilities: crate::CapabilityRuntime,
}

#[derive(Debug, Clone)]
struct RebuildRequest {
    queue_id: Option<i64>,
    site_id: String,
    scope_from: NaiveDate,
    scope_to: NaiveDate,
    parser_version: String,
    rebuild_reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RebuildSummary {
    pub events: usize,
    pub visitors: usize,
    pub scope_from: NaiveDate,
    pub scope_to: NaiveDate,
}

impl Processor {
    pub async fn connect(database_url: &str) -> Result<Self, ProcessorError> {
        let mut processor = Self::connect_with_definitions(
            database_url,
            crate::definitions::AnalyticsDefinitions {
                version: "1".to_owned(),
                sites: Vec::new(),
            },
        )
        .await?;
        processor.database_definitions = true;
        Ok(processor)
    }

    pub async fn connect_with_definitions(
        database_url: &str,
        definitions: crate::definitions::AnalyticsDefinitions,
    ) -> Result<Self, ProcessorError> {
        definitions
            .validate()
            .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        let capabilities =
            crate::CapabilityRuntime::new(pool.clone(), "processor").map_err(|_| {
                ProcessorError::CapabilityConfigurationUnavailable("runtime".to_owned())
            })?;
        capabilities.spawn();
        Ok(Self {
            pool,
            definitions,
            database_definitions: false,
            capabilities,
        })
    }

    pub async fn import_definitions_if_empty(
        &self,
        definitions: &serde_json::Value,
    ) -> Result<u64, ProcessorError> {
        let version = definitions
            .get("version")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| ProcessorError::InvalidDefinitions("missing version".to_owned()))?;
        let mut imported = 0;
        for site in definitions
            .get("sites")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
        {
            let site_id = site
                .get("site_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| ProcessorError::InvalidDefinitions("missing site_id".to_owned()))?;
            let mut tx = self.pool.begin().await?;
            lock_site(&mut tx, site_id).await?;
            let exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM site_definition_revisions WHERE site_id=$1)",
            )
            .bind(site_id)
            .fetch_one(&mut *tx)
            .await?;
            if exists {
                tx.rollback().await?;
                continue;
            }
            let mut conversions = site
                .get("conversions")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default();
            for conversion in &mut conversions {
                if conversion.get("active").is_none() {
                    conversion["active"] = serde_json::Value::Bool(true);
                }
            }
            let mut funnels = site
                .get("funnels")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default();
            for funnel in &mut funnels {
                if funnel.get("active").is_none() {
                    funnel["active"] = serde_json::Value::Bool(true);
                }
            }
            let document = serde_json::json!({"schema_version":1,"site_id":site_id,"revision":1,"definition_version":version,"updated_at":Utc::now(),"effective_at":null,"conversions":conversions,"funnels":funnels});
            sqlx::query("INSERT INTO site_definition_revisions(site_id,revision,definition_version,effective_at,created_at,document) VALUES($1,1,$2,NULL,NOW(),$3)").bind(site_id).bind(version).bind(document).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO configuration_audit(actor_kind,resource,version,operation,changed_fields,created_at,expires_at) VALUES('deployment_admin',$1,1,'created',ARRAY['definitions.conversions','definitions.funnels'],NOW(),NOW()+INTERVAL '1 year')")
                .bind(serde_json::json!({"kind":"conversion_funnel_definitions","site_id":site_id}))
                .execute(&mut *tx).await?;
            tx.commit().await?;
            imported += 1;
        }
        Ok(imported)
    }

    pub async fn rebuild_conversion_funnel_facts_for_version(
        &self,
        site_id: &str,
        version: &str,
    ) -> Result<u64, ProcessorError> {
        let document = sqlx::query_scalar::<_, serde_json::Value>("SELECT document FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$2").bind(site_id).bind(version).fetch_optional(&self.pool).await?.ok_or_else(|| ProcessorError::InvalidDefinitions(format!("definition version {version} does not exist for site {site_id}")))?;
        let site = serde_json::json!({"site_id":site_id,"conversions":document.get("conversions").cloned().unwrap_or_else(|| serde_json::json!([])),"funnels":document.get("funnels").cloned().unwrap_or_else(|| serde_json::json!([]))});
        let definitions =
            serde_json::from_value(serde_json::json!({"version":version,"sites":[site]}))
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
            .enabled("custom_events")
        {
            return Err(ProcessorError::CapabilityDisabled(site_id.to_owned()));
        }
        let mut transaction = self.pool.begin().await?;
        lock_site(&mut transaction, site_id).await?;
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

    async fn rebuild_conversion_funnel_facts_with_mode(
        &self,
        site_id: &str,
        explicit_backfill: bool,
    ) -> Result<u64, ProcessorError> {
        let capabilities = self.current_capabilities(site_id).await?;
        if !capabilities.enabled("conversions") && !capabilities.enabled("funnels") {
            return Ok(0);
        }
        let mut tx = self.pool.begin().await?;
        lock_site(&mut tx, site_id).await?;
        if capabilities.enabled("conversions") {
            if explicit_backfill {
                sqlx::query(
                    "DELETE FROM conversion_facts WHERE site_id=$1 AND definition_version=$2",
                )
                .bind(site_id)
                .bind(&self.definitions.version)
                .execute(&mut *tx)
                .await?;
            } else if let Some(enabled_since) = capabilities.enabled_since("conversions") {
                sqlx::query("DELETE FROM conversion_facts f USING raw_events r WHERE f.site_id=$1 AND f.definition_version=$2 AND r.site_id=f.site_id AND r.event_id=f.event_id AND r.received_at >= $3")
                    .bind(site_id).bind(&self.definitions.version).bind(enabled_since)
                    .execute(&mut *tx).await?;
            }
        }
        if capabilities.enabled("funnels") {
            if explicit_backfill {
                sqlx::query(
                    "DELETE FROM funnel_step_facts WHERE site_id=$1 AND definition_version=$2",
                )
                .bind(site_id)
                .bind(&self.definitions.version)
                .execute(&mut *tx)
                .await?;
            } else if let Some(enabled_since) = capabilities.enabled_since("funnels") {
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
            let session_id = if capabilities.enabled("sessions") {
                if let Some(visitor_id) = visitor_id.as_deref() {
                    sqlx::query_scalar::<_, String>("SELECT se.session_id::text FROM session_events se JOIN analytics_generations g ON g.generation_id=se.generation_id AND g.site_id=se.site_id AND g.status='active' WHERE se.site_id=$1 AND se.visitor_id=$2::uuid AND se.occurred_at <= $3 AND se.occurred_at > $3 - INTERVAL '30 minutes' AND (se.occurred_at AT TIME ZONE 'UTC')::date=($3 AT TIME ZONE 'UTC')::date ORDER BY se.occurred_at DESC LIMIT 1")
                    .bind(site_id).bind(visitor_id).bind(occurred_at).fetch_optional(&mut *tx).await?
                } else {
                    None
                }
            } else {
                None
            };
            if capabilities.enabled("sessions") {
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
            record_conversion_and_funnel_facts(
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
        advance_definition_watermarks(&mut tx, site_id, &self.definitions.version, true).await?;
        tx.commit().await?;
        Ok(count)
    }

    pub async fn rebuild_geo_country_facts(&self, site_id: &str) -> Result<u64, ProcessorError> {
        if !self.current_capabilities(site_id).await?.enabled("geo") {
            return Err(ProcessorError::CapabilityDisabled(site_id.to_owned()));
        }
        let mut tx = self.pool.begin().await?;
        lock_site(&mut tx, site_id).await?;
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
            .enabled("web_vitals")
        {
            return Err(ProcessorError::CapabilityDisabled(site_id.to_owned()));
        }
        let mut tx = self.pool.begin().await?;
        lock_site(&mut tx, site_id).await?;
        sqlx::query("DELETE FROM web_vital_facts WHERE site_id=$1")
            .bind(site_id)
            .execute(&mut *tx)
            .await?;
        let result = sqlx::query("INSERT INTO web_vital_facts(raw_event_id,site_id,page_view_event_id,page_view_occurred_at,path,metric,value,rating,navigation_type,report_sequence) SELECT DISTINCT ON (w.site_id,w.payload->>'page_view_event_id',w.payload->>'metric') w.id,w.site_id,w.payload->>'page_view_event_id',to_timestamp((w.payload->>'page_view_occurred_at')::double precision/1000),w.payload->>'path',w.payload->>'metric',(w.payload->>'value')::double precision,w.payload->>'rating',w.payload->>'navigation_type',(w.payload->>'report_sequence')::bigint FROM raw_events w JOIN raw_events p ON p.site_id=w.site_id AND p.event_id=w.payload->>'page_view_event_id' AND p.event_type='page_view' AND p.path=w.payload->>'path' AND p.occurred_at=to_timestamp((w.payload->>'page_view_occurred_at')::double precision/1000) WHERE w.site_id=$1 AND w.event_type='web_vital' AND w.processed_at IS NOT NULL ORDER BY w.site_id,w.payload->>'page_view_event_id',w.payload->>'metric',(w.payload->>'report_sequence')::bigint DESC,w.id ASC ON CONFLICT(site_id,page_view_event_id,metric) DO UPDATE SET raw_event_id=EXCLUDED.raw_event_id,page_view_occurred_at=EXCLUDED.page_view_occurred_at,path=EXCLUDED.path,value=EXCLUDED.value,rating=EXCLUDED.rating,navigation_type=EXCLUDED.navigation_type,report_sequence=EXCLUDED.report_sequence WHERE EXCLUDED.report_sequence>web_vital_facts.report_sequence OR (EXCLUDED.report_sequence=web_vital_facts.report_sequence AND EXCLUDED.raw_event_id<web_vital_facts.raw_event_id)").bind(site_id).execute(&mut *tx).await?;
        queries::advance_web_vital_watermark(&mut tx, site_id).await?;
        tx.commit().await?;
        Ok(result.rows_affected())
    }

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
            load_definition_revision(&mut transaction, &event.site_id, event.received_at).await?
        } else {
            self.definitions.clone()
        };
        process_event(&mut transaction, &event, &definitions, &capabilities).await?;
        transaction.commit().await?;
        Ok(true)
    }

    async fn current_capabilities(
        &self,
        site_id: &str,
    ) -> Result<crate::CapabilitySnapshot, ProcessorError> {
        if let Some(snapshot) = self.capabilities.snapshot(site_id) {
            return Ok(snapshot);
        }
        let _ = self.capabilities.refresh_once().await;
        self.capabilities
            .snapshot(site_id)
            .ok_or_else(|| ProcessorError::CapabilityConfigurationUnavailable(site_id.to_owned()))
    }

    pub async fn process_all_once(&self) -> Result<u64, ProcessorError> {
        let mut processed = 0;
        while self.process_one().await? {
            processed += 1;
        }
        while self.process_rebuild_queue_once().await? {}
        Ok(processed)
    }

    pub async fn process_rebuild_queue_once(&self) -> Result<bool, ProcessorError> {
        let mut transaction = self.pool.begin().await?;
        let request = sqlx::query_as::<_, (i64, String, NaiveDate, NaiveDate, String, String)>(
            "SELECT queue_id, site_id, scope_from, scope_to,
                    parser_version, rebuild_reason
             FROM analytics_rebuild_queue
             WHERE rebuild_reason = 'incremental'
               AND (
                   status = 'pending'
                   OR (status = 'running' AND updated_at < NOW() - INTERVAL '5 minutes')
               )
             ORDER BY queue_id
             LIMIT 1
             FOR UPDATE SKIP LOCKED",
        )
        .fetch_optional(&mut *transaction)
        .await?;

        let Some((queue_id, site_id, scope_from, scope_to, parser_version, rebuild_reason)) =
            request
        else {
            transaction.rollback().await?;
            return Ok(false);
        };

        // Do not claim work while every capability that feeds this generation is disabled.
        // Keeping the row pending makes this a safe pause instead of a failed rebuild.
        let capabilities = self.current_capabilities(&site_id).await?;
        if !(capabilities.enabled("anonymous_visitors")
            || capabilities.enabled("sessions")
            || capabilities.enabled("browser_context")
            || capabilities.enabled("dimensions"))
        {
            transaction.rollback().await?;
            return Ok(false);
        }

        sqlx::query(
            "UPDATE analytics_rebuild_queue
             SET status = 'running', attempts = attempts + 1, updated_at = NOW()
             WHERE queue_id = $1",
        )
        .bind(queue_id)
        .execute(&mut *transaction)
        .await?;
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
                sqlx::query(
                    "UPDATE analytics_rebuild_queue
                     SET status = 'failed', failure_reason = $2, updated_at = NOW()
                     WHERE queue_id = $1",
                )
                .bind(queue_id)
                .bind(error.to_string())
                .execute(&self.pool)
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
        sqlx::query(
            "INSERT INTO analytics_rebuild_queue
                (site_id, scope_from, scope_to, aggregation_version,
                 parser_version, rebuild_reason)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (site_id, visitor_id, aggregation_version, scope_from, scope_to)
                 WHERE status IN ('pending', 'running')
             DO UPDATE SET
                 rebuild_reason = CASE
                     WHEN analytics_rebuild_queue.rebuild_reason = 'backfill'
                       OR EXCLUDED.rebuild_reason = 'backfill'
                     THEN 'backfill'
                     ELSE analytics_rebuild_queue.rebuild_reason
                 END,
                 parser_version = EXCLUDED.parser_version,
                 updated_at = NOW()",
        )
        .bind(site_id)
        .bind(scope_from)
        .bind(scope_to)
        .bind(AGGREGATION_VERSION)
        .bind(parser_version)
        .bind(reason)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

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
        let events = load_site_events(&self.pool, site_id).await?;
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
        if !capabilities.enabled("anonymous_visitors")
            && !capabilities.enabled("sessions")
            && !capabilities.enabled("browser_context")
            && !capabilities.enabled("dimensions")
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
        let target_status = sqlx::query_scalar::<_, String>(
            "SELECT status
             FROM analytics_generations
             WHERE site_id = $1 AND generation_id = $2::uuid
             FOR UPDATE",
        )
        .bind(site_id)
        .bind(target_generation_id)
        .fetch_optional(&mut *transaction)
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

        let active_generation_id = sqlx::query_scalar::<_, String>(
            "SELECT generation_id::text
             FROM analytics_generations
             WHERE site_id = $1 AND status = 'active'
             FOR UPDATE",
        )
        .bind(site_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(|| ProcessorError::NoActiveGeneration {
            site_id: site_id.to_owned(),
        })?;

        sqlx::query(
            "UPDATE analytics_generations
             SET status = 'retired'
             WHERE site_id = $1 AND generation_id = $2::uuid AND status = 'active'",
        )
        .bind(site_id)
        .bind(&active_generation_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE analytics_generations
             SET status = 'active', activated_at = NOW(), failure_reason = NULL
             WHERE site_id = $1 AND generation_id = $2::uuid AND status = 'retired'",
        )
        .bind(site_id)
        .bind(target_generation_id)
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(())
    }

    async fn rebuild(&self, request: RebuildRequest) -> Result<(), ProcessorError> {
        let generation_id = new_generation_id(&request.site_id, &request.parser_version);
        match self.rebuild_inner(request.clone(), &generation_id).await {
            Ok(()) => Ok(()),
            Err(error @ ProcessorError::RebuildQueueAlreadyHandled(_))
            | Err(error @ ProcessorError::RebuildQueuePaused(_)) => Err(error),
            Err(error) => {
                let _ = sqlx::query(
                    "INSERT INTO analytics_generations
                        (generation_id, site_id, aggregation_version, parser_version,
                         scope_from, scope_to, rebuild_reason, status, failure_reason)
                     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'failed', $8)
                     ON CONFLICT (generation_id) DO NOTHING",
                )
                .bind(&generation_id)
                .bind(&request.site_id)
                .bind(AGGREGATION_VERSION)
                .bind(&request.parser_version)
                .bind(request.scope_from)
                .bind(request.scope_to)
                .bind(&request.rebuild_reason)
                .bind(error.to_string())
                .execute(&self.pool)
                .await;
                let _ = if let Some(queue_id) = request.queue_id {
                    sqlx::query(
                        "UPDATE analytics_rebuild_queue
                         SET status = 'failed', failure_reason = $2, updated_at = NOW()
                         WHERE queue_id = $1
                           AND status IN ('pending', 'running')",
                    )
                    .bind(queue_id)
                    .bind(error.to_string())
                    .execute(&self.pool)
                    .await
                } else {
                    sqlx::query(
                        "UPDATE analytics_rebuild_queue
                         SET status = 'failed', failure_reason = $4, updated_at = NOW()
                        WHERE site_id = $1
                           AND scope_from = $2
                           AND scope_to = $3
                           AND rebuild_reason = $5
                           AND parser_version = $6
                           AND status IN ('pending', 'running')",
                    )
                    .bind(&request.site_id)
                    .bind(request.scope_from)
                    .bind(request.scope_to)
                    .bind(error.to_string())
                    .bind(&request.rebuild_reason)
                    .bind(&request.parser_version)
                    .execute(&self.pool)
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

        lock_site(&mut transaction, &request.site_id).await?;
        if let Some(queue_id) = request.queue_id {
            let queue_status = sqlx::query_scalar::<_, String>(
                "SELECT status FROM analytics_rebuild_queue
                 WHERE queue_id = $1
                 FOR UPDATE",
            )
            .bind(queue_id)
            .fetch_one(&mut *transaction)
            .await?;
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
                    caps.enabled("anonymous_visitors")
                        || caps.enabled("sessions")
                        || caps.enabled("browser_context")
                        || caps.enabled("dimensions")
                });
            if !enabled {
                sqlx::query(
                    "UPDATE analytics_rebuild_queue
                     SET status = 'pending', failure_reason = NULL, updated_at = NOW()
                     WHERE queue_id = $1",
                )
                .bind(queue_id)
                .execute(&mut *transaction)
                .await?;
                transaction.commit().await?;
                return Err(ProcessorError::RebuildQueuePaused(queue_id));
            }
        }
        // A generation is a complete site snapshot. Session IDs include the
        // generation ID, so copying unaffected sessions from the previous
        // generation would create invalid cross-generation references. Until
        // scoped generation merge is implemented, every activation must build
        // the full site history to avoid publishing partial aggregates.
        let events = load_site_events(&self.pool, &request.site_id).await?;
        let watermark = match events.iter().map(|event| event.received_at).max() {
            Some(max_received_at) => {
                Some(continuous_watermark(&self.pool, &request.site_id, max_received_at).await?)
            }
            None => None,
        };

        sqlx::query(
            "INSERT INTO analytics_generations
                (generation_id, site_id, aggregation_version, parser_version,
                 scope_from, scope_to, rebuild_reason, status, source_watermark)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'building', $8)",
        )
        .bind(generation_id)
        .bind(&request.site_id)
        .bind(AGGREGATION_VERSION)
        .bind(&request.parser_version)
        .bind(request.scope_from)
        .bind(request.scope_to)
        .bind(&request.rebuild_reason)
        .bind(json!({
            "visitor_session": watermark.map(|value| value.to_rfc3339()),
            "dimensions": watermark.map(|value| value.to_rfc3339())
        }))
        .execute(&mut *transaction)
        .await?;

        let active_generation = sqlx::query_scalar::<_, String>(
            "SELECT generation_id::text
             FROM analytics_generations WHERE site_id = $1 AND status = 'active' FOR UPDATE",
        )
        .bind(&request.site_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let capabilities = self.current_capabilities(&request.site_id).await?;
        write_derived_results(
            &mut transaction,
            generation_id,
            &events,
            &parser,
            &capabilities,
            request.queue_id.is_none(),
        )
        .await?;
        copy_disabled_generation_facts(
            &mut transaction,
            generation_id,
            active_generation.as_deref(),
            &capabilities,
            request.queue_id.is_none(),
        )
        .await?;
        refresh_generation_rollups(&mut transaction, generation_id).await?;

        if let Some(watermark) = watermark {
            sqlx::query(
                "INSERT INTO analytics_watermarks
                    (site_id, generation_id, source_name, processed_received_watermark)
                 VALUES ($1, $2::uuid, 'visitor_session', $3)
                 ON CONFLICT (site_id, generation_id, source_name)
                 DO UPDATE SET processed_received_watermark = EXCLUDED.processed_received_watermark,
                               updated_at = NOW()",
            )
            .bind(&request.site_id)
            .bind(generation_id)
            .bind(watermark)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                "INSERT INTO analytics_watermarks
                    (site_id, generation_id, source_name, processed_received_watermark)
                 VALUES ($1, $2::uuid, 'dimensions', $3)
                 ON CONFLICT (site_id, generation_id, source_name)
                 DO UPDATE SET processed_received_watermark = EXCLUDED.processed_received_watermark,
                               updated_at = NOW()",
            )
            .bind(&request.site_id)
            .bind(generation_id)
            .bind(watermark)
            .execute(&mut *transaction)
            .await?;
        }

        if let Some(active_generation) = active_generation {
            sqlx::query(
                "UPDATE analytics_generations
                 SET status = 'retired'
                 WHERE site_id = $1 AND generation_id = $2::uuid",
            )
            .bind(&request.site_id)
            .bind(active_generation)
            .execute(&mut *transaction)
            .await?;
        }

        sqlx::query(
            "UPDATE analytics_generations
             SET status = 'active', activated_at = NOW()
             WHERE generation_id = $1::uuid",
        )
        .bind(generation_id)
        .execute(&mut *transaction)
        .await?;
        if request.queue_id.is_some() {
            sqlx::query(
                "UPDATE analytics_rebuild_queue
                 SET status = 'completed', updated_at = NOW()
                 WHERE site_id = $1
                   AND rebuild_reason = 'incremental'
                   AND status IN ('pending', 'running')",
            )
            .bind(&request.site_id)
            .execute(&mut *transaction)
            .await?;
        } else if request.rebuild_reason == "backfill" {
            sqlx::query(
                "UPDATE analytics_rebuild_queue
                 SET status = 'completed', updated_at = NOW()
                 WHERE site_id = $1
                   AND scope_from >= $2
                   AND scope_to <= $3
                   AND rebuild_reason = 'backfill'
                   AND status IN ('pending', 'running')",
            )
            .bind(&request.site_id)
            .bind(request.scope_from)
            .bind(request.scope_to)
            .execute(&mut *transaction)
            .await?;
        }

        transaction.commit().await?;
        Ok(())
    }
}

async fn continuous_watermark(
    pool: &PgPool,
    site_id: &str,
    max_received_at: DateTime<Utc>,
) -> Result<DateTime<Utc>, ProcessorError> {
    let first_unprocessed = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT MIN(received_at)
         FROM raw_events
         WHERE site_id = $1
           AND processed_at IS NULL
           AND received_at <= $2",
    )
    .bind(site_id)
    .bind(max_received_at)
    .fetch_one(pool)
    .await?;
    Ok(match first_unprocessed {
        Some(gap) => gap - chrono::Duration::microseconds(1),
        None => max_received_at,
    })
}

async fn refresh_generation_rollups(
    transaction: &mut Transaction<'_, Postgres>,
    generation_id: &str,
) -> Result<(), ProcessorError> {
    for table in ["visitor_daily", "session_daily", "dimension_daily"] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE generation_id=$1::uuid"
        )))
        .bind(generation_id)
        .execute(&mut **transaction)
        .await?;
    }
    sqlx::query(
        "INSERT INTO visitor_daily(generation_id,site_id,day,unique_visitors,page_views)
        SELECT generation_id,site_id,day,COUNT(DISTINCT visitor_id),COUNT(*)
        FROM visitor_event_facts WHERE generation_id=$1::uuid GROUP BY generation_id,site_id,day",
    )
    .bind(generation_id)
    .execute(&mut **transaction)
    .await?;
    sqlx::query(
        "INSERT INTO session_daily(generation_id,site_id,day,sessions,page_views)
        SELECT generation_id,site_id,started_at::date,COUNT(*),SUM(page_views)
        FROM sessions WHERE generation_id=$1::uuid GROUP BY generation_id,site_id,started_at::date",
    )
    .bind(generation_id)
    .execute(&mut **transaction)
    .await?;
    sqlx::query("INSERT INTO dimension_daily(generation_id,site_id,day,dimension,value,page_views,unique_visitors,sessions)
        SELECT generation_id,site_id,day,dimension,value,COUNT(*),COUNT(DISTINCT visitor_id),COUNT(DISTINCT session_id)
        FROM dimension_event_facts WHERE generation_id=$1::uuid GROUP BY generation_id,site_id,day,dimension,value")
        .bind(generation_id).execute(&mut **transaction).await?;
    Ok(())
}

fn event_is_before_activation(
    event: &RawEvent,
    capabilities: &crate::CapabilitySnapshot,
    capability: &str,
) -> bool {
    capabilities
        .enabled_since(capability)
        .is_some_and(|enabled_since| {
            enabled_since.timestamp() > 0 && event.received_at < enabled_since
        })
}

async fn process_event(
    transaction: &mut Transaction<'_, Postgres>,
    event: &RawEvent,
    definitions: &crate::definitions::AnalyticsDefinitions,
    capabilities: &crate::CapabilitySnapshot,
) -> Result<(), ProcessorError> {
    let event_type = event
        .payload
        .get("type")
        .and_then(serde_json::Value::as_str);
    if (event_type == Some("custom_event")
        && (!capabilities.enabled("custom_events")
            || event_is_before_activation(event, capabilities, "custom_events")))
        || (event_type == Some("web_vital")
            && (!capabilities.enabled("web_vitals")
                || event_is_before_activation(event, capabilities, "web_vitals")))
    {
        if !queries::mark_processed(transaction, event.id).await? {
            return Err(ProcessorError::RawEventNotUpdated(event.id));
        }
        if event_type == Some("custom_event") {
            queries::advance_custom_event_watermark(transaction, &event.site_id).await?;
        } else {
            queries::advance_web_vital_watermark(transaction, &event.site_id).await?;
        }
        return Ok(());
    }
    match event
        .payload
        .get("type")
        .and_then(serde_json::Value::as_str)
    {
        Some("custom_event") => {
            let event_name = event
                .payload
                .get("event_name")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| ProcessorError::InvalidCustomEvent(event.event_id.clone()))?;
            lock_site(transaction, &event.site_id).await?;
            let session_id = if capabilities.enabled("sessions") {
                if let Some(visitor_id) = event.visitor_id.as_deref() {
                    sqlx::query_scalar::<_, String>("SELECT se.session_id::text FROM session_events se JOIN analytics_generations g ON g.generation_id=se.generation_id AND g.site_id=se.site_id AND g.status='active' WHERE se.site_id=$1 AND se.visitor_id=$2::uuid AND se.occurred_at <= $3 AND se.occurred_at > $3 - INTERVAL '30 minutes' AND (se.occurred_at AT TIME ZONE 'UTC')::date=($3 AT TIME ZONE 'UTC')::date ORDER BY se.occurred_at DESC LIMIT 1")
                    .bind(&event.site_id).bind(visitor_id).bind(event.occurred_at).fetch_optional(&mut **transaction).await?
                } else {
                    None
                }
            } else {
                None
            };
            sqlx::query(
                "INSERT INTO custom_event_facts (raw_event_id, site_id, event_id, occurred_at, received_at, event_name, session_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::uuid)
                 ON CONFLICT (site_id, event_id) DO NOTHING",
            )
            .bind(event.id).bind(&event.site_id).bind(&event.event_id)
            .bind(event.occurred_at).bind(event.received_at).bind(event_name).bind(session_id.as_deref())
            .execute(&mut **transaction).await?;
            record_conversion_and_funnel_facts(
                transaction,
                event,
                definitions,
                event_name,
                session_id,
                capabilities,
                false,
            )
            .await?;
            if !queries::mark_processed(transaction, event.id).await? {
                return Err(ProcessorError::RawEventNotUpdated(event.id));
            }
            queries::advance_custom_event_watermark(transaction, &event.site_id).await?;
            advance_definition_watermarks(transaction, &event.site_id, &definitions.version, false)
                .await?;
            return Ok(());
        }
        Some("web_vital") => {
            let payload = &event.payload;
            let pv_id = payload
                .get("page_view_event_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| ProcessorError::InvalidCustomEvent(event.event_id.clone()))?;
            let page_view_at = payload
                .get("page_view_occurred_at")
                .and_then(serde_json::Value::as_i64)
                .ok_or_else(|| ProcessorError::InvalidCustomEvent(event.event_id.clone()))?;
            let path = payload
                .get("path")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| ProcessorError::InvalidCustomEvent(event.event_id.clone()))?;
            let metric = payload
                .get("metric")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| ProcessorError::InvalidCustomEvent(event.event_id.clone()))?;
            let value = payload
                .get("value")
                .and_then(serde_json::Value::as_f64)
                .ok_or_else(|| ProcessorError::InvalidCustomEvent(event.event_id.clone()))?;
            let rating = payload
                .get("rating")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| ProcessorError::InvalidCustomEvent(event.event_id.clone()))?;
            let nav = payload
                .get("navigation_type")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| ProcessorError::InvalidCustomEvent(event.event_id.clone()))?;
            let sequence = payload
                .get("report_sequence")
                .and_then(serde_json::Value::as_i64)
                .ok_or_else(|| ProcessorError::InvalidCustomEvent(event.event_id.clone()))?;
            // A vital is accepted only for a stored Page View in the same site with matching snapshot fields.
            let linked = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM raw_events WHERE site_id=$1 AND event_id=$2 AND event_type='page_view' AND occurred_at=to_timestamp($3::double precision/1000) AND path=$4)").bind(&event.site_id).bind(pv_id).bind(page_view_at).bind(path).fetch_one(&mut **transaction).await?;
            if !linked {
                return Err(ProcessorError::InvalidCustomEvent(event.event_id.clone()));
            }
            sqlx::query("INSERT INTO web_vital_facts(raw_event_id,site_id,page_view_event_id,page_view_occurred_at,path,metric,value,rating,navigation_type,report_sequence) VALUES($1,$2,$3,to_timestamp($4::double precision/1000),$5,$6,$7,$8,$9,$10) ON CONFLICT(site_id,page_view_event_id,metric) DO UPDATE SET raw_event_id=EXCLUDED.raw_event_id,page_view_occurred_at=EXCLUDED.page_view_occurred_at,path=EXCLUDED.path,value=EXCLUDED.value,rating=EXCLUDED.rating,navigation_type=EXCLUDED.navigation_type,report_sequence=EXCLUDED.report_sequence WHERE EXCLUDED.report_sequence > web_vital_facts.report_sequence OR (EXCLUDED.report_sequence = web_vital_facts.report_sequence AND EXCLUDED.raw_event_id < web_vital_facts.raw_event_id)")
                .bind(event.id).bind(&event.site_id).bind(pv_id).bind(page_view_at).bind(path).bind(metric).bind(value).bind(rating).bind(nav).bind(sequence).execute(&mut **transaction).await?;
            queries::mark_processed(transaction, event.id).await?;
            queries::advance_web_vital_watermark(transaction, &event.site_id).await?;
            return Ok(());
        }
        Some("page_view") => {}
        _ => return Err(ProcessorError::InvalidCustomEvent(event.event_id.clone())),
    }

    let day = event.occurred_at.with_timezone(&Utc).date_naive();
    queries::upsert_daily(transaction, &event.site_id, day).await?;
    queries::upsert_route(transaction, &event.site_id, day, &event.path).await?;
    queries::upsert_total(transaction, &event.site_id).await?;

    if capabilities.enabled("anonymous_visitors")
        || capabilities.enabled("sessions")
        || capabilities.enabled("browser_context")
        || capabilities.enabled("dimensions")
    {
        lock_site(transaction, &event.site_id).await?;
        if let Some(visitor_id) = event.visitor_id.as_deref() {
            let delay = event.received_at.signed_duration_since(event.occurred_at);
            let rebuild_reason = if delay > chrono::Duration::hours(24) {
                "backfill"
            } else {
                "incremental"
            };
            queries::enqueue_rebuild(
                transaction,
                &event.site_id,
                visitor_id,
                day,
                rebuild_reason,
                WOOTHEE_VERSION,
            )
            .await?;
        }
    }

    if capabilities.enabled("geo") && !event_is_before_activation(event, capabilities, "geo") {
        sqlx::query(
        "INSERT INTO geo_country_facts(raw_event_id,site_id,country_code,occurred_at)
         SELECT m.raw_event_id,m.site_id,m.country_code,r.occurred_at
         FROM geo_event_metadata m JOIN raw_events r ON r.id=m.raw_event_id
         WHERE m.raw_event_id=$1 AND r.event_type='page_view'
         ON CONFLICT(raw_event_id) DO UPDATE SET country_code=EXCLUDED.country_code,occurred_at=EXCLUDED.occurred_at",
    )
    .bind(event.id)
    .execute(&mut **transaction)
    .await?;
    }
    if !queries::mark_processed(transaction, event.id).await? {
        return Err(ProcessorError::RawEventNotUpdated(event.id));
    }
    lock_site(transaction, &event.site_id).await?;
    queries::advance_page_view_watermark(transaction, &event.site_id).await?;
    Ok(())
}

async fn record_conversion_and_funnel_facts(
    transaction: &mut Transaction<'_, Postgres>,
    event: &RawEvent,
    definitions: &crate::definitions::AnalyticsDefinitions,
    event_name: &str,
    session_id: Option<String>,
    capabilities: &crate::CapabilitySnapshot,
    explicit_backfill: bool,
) -> Result<(), ProcessorError> {
    let Some(site) = definitions.for_site(&event.site_id) else {
        return Ok(());
    };
    let properties = event.payload.get("properties").cloned().unwrap_or_default();
    if capabilities.enabled("conversions")
        && (explicit_backfill || !event_is_before_activation(event, capabilities, "conversions"))
    {
        for conversion in &site.conversions {
            if !conversion.active {
                continue;
            }
            if crate::definitions::matches(
                event_name,
                &properties,
                &conversion.event_name,
                &conversion.properties,
            ) {
                sqlx::query("INSERT INTO conversion_facts(site_id,definition_id,definition_version,event_id,occurred_at,session_id) VALUES($1,$2,$3,$4,$5,$6::uuid) ON CONFLICT DO NOTHING")
                .bind(&event.site_id).bind(&conversion.id).bind(&definitions.version).bind(&event.event_id).bind(event.occurred_at).bind(session_id.as_deref()).execute(&mut **transaction).await?;
            }
        }
    }
    if !capabilities.enabled("funnels")
        || (!explicit_backfill && event_is_before_activation(event, capabilities, "funnels"))
    {
        return Ok(());
    }
    let Some(session_id) = session_id else {
        return Ok(());
    };
    for funnel in &site.funnels {
        if !funnel.active {
            continue;
        }
        if explicit_backfill {
            sqlx::query("DELETE FROM funnel_step_facts WHERE site_id=$1 AND definition_id=$2 AND definition_version=$3 AND session_id=$4::uuid")
                .bind(&event.site_id).bind(&funnel.id).bind(&definitions.version).bind(&session_id).execute(&mut **transaction).await?;
        }
        let funnel_enabled_since = if explicit_backfill {
            None
        } else {
            capabilities.enabled_since("funnels")
        };
        let session_events = sqlx::query_as::<_, (String, DateTime<Utc>, String, serde_json::Value)>("SELECT f.event_id,f.occurred_at,f.event_name,COALESCE(r.payload->'properties','{}'::jsonb) FROM custom_event_facts f JOIN raw_events r ON r.id=f.raw_event_id WHERE f.site_id=$1 AND f.session_id=$2::uuid AND ($3::timestamptz IS NULL OR r.received_at >= $3) AND ($4::boolean OR (r.received_at >= COALESCE((SELECT effective_at FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$5), '-infinity'::timestamptz) AND r.received_at < COALESCE((SELECT MIN(next.effective_at) FROM site_definition_revisions current JOIN site_definition_revisions next ON next.site_id=current.site_id AND next.revision>current.revision WHERE current.site_id=$1 AND current.definition_version=$5), 'infinity'::timestamptz))) ORDER BY f.occurred_at,f.event_id")
            .bind(&event.site_id).bind(&session_id).bind(funnel_enabled_since).bind(explicit_backfill).bind(&definitions.version).fetch_all(&mut **transaction).await?;
        let mut next_index = 0_usize;
        let mut previous_at = None;
        let mut cohort_day = None;
        for (matched_event_id, occurred_at, matched_name, matched_properties) in session_events {
            if next_index >= funnel.steps.len()
                || previous_at.is_some_and(|previous| occurred_at <= previous)
            {
                continue;
            }
            let step = &funnel.steps[next_index];
            if !crate::definitions::matches(
                &matched_name,
                &matched_properties,
                &step.event_name,
                &step.properties,
            ) {
                continue;
            }
            let day =
                *cohort_day.get_or_insert_with(|| occurred_at.with_timezone(&Utc).date_naive());
            sqlx::query("INSERT INTO funnel_step_facts(site_id,definition_id,definition_version,session_id,step_index,event_id,occurred_at,cohort_day) VALUES($1,$2,$3,$4::uuid,$5,$6,$7,$8) ON CONFLICT DO NOTHING")
                .bind(&event.site_id).bind(&funnel.id).bind(&definitions.version).bind(&session_id).bind(next_index as i32).bind(matched_event_id).bind(occurred_at).bind(day).execute(&mut **transaction).await?;
            next_index += 1;
            previous_at = Some(occurred_at);
        }
    }
    Ok(())
}

async fn advance_definition_watermarks(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    definition_version: &str,
    replace_definition_version: bool,
) -> Result<(), ProcessorError> {
    for source in ["conversions", "funnels"] {
        let max_received = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
            "SELECT MAX(received_at) FROM raw_events
             WHERE site_id = $1 AND event_type = 'custom_event' AND processed_at IS NOT NULL",
        )
        .bind(site_id)
        .fetch_one(&mut **transaction)
        .await?;
        let processed_event_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM raw_events
             WHERE site_id = $1 AND event_type = 'custom_event' AND processed_at IS NOT NULL",
        )
        .bind(site_id)
        .fetch_one(&mut **transaction)
        .await?;
        let watermark = if let Some(max_received) = max_received {
            let first_pending = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
                "SELECT MIN(received_at) FROM raw_events
                 WHERE site_id = $1 AND event_type = 'custom_event' AND processed_at IS NULL
                   AND received_at <= $2",
            )
            .bind(site_id)
            .bind(max_received)
            .fetch_one(&mut **transaction)
            .await?;
            Some(first_pending.map_or(max_received, |time| {
                time - chrono::Duration::microseconds(1)
            }))
        } else if replace_definition_version {
            None
        } else {
            continue;
        };
        let version_for_insert = (replace_definition_version || processed_event_count == 1)
            .then_some(definition_version);
        sqlx::query(
            "INSERT INTO analytics_watermarks
                (site_id, generation_id, source_name, processed_received_watermark, definition_version)
             VALUES ($1, NULL, $2, $3, $4)
             ON CONFLICT (site_id, generation_id, source_name) DO UPDATE SET
                processed_received_watermark = EXCLUDED.processed_received_watermark,
                definition_version = CASE
                    WHEN $5 THEN EXCLUDED.definition_version
                    ELSE COALESCE(analytics_watermarks.definition_version, EXCLUDED.definition_version)
                END,
                updated_at = NOW()",
        )
        .bind(site_id)
        .bind(source)
        .bind(watermark)
        .bind(version_for_insert)
        .bind(replace_definition_version)
        .execute(&mut **transaction)
        .await?;
        sqlx::query("WITH revision AS (SELECT effective_at, (SELECT MIN(next.effective_at) FROM site_definition_revisions next WHERE next.site_id=rev.site_id AND next.revision>rev.revision) AS next_effective_at FROM site_definition_revisions rev WHERE site_id=$1 AND definition_version=$2), processed AS (SELECT MAX(r.received_at) AS max_received FROM raw_events r, revision v WHERE r.site_id=$1 AND r.event_type='custom_event' AND r.processed_at IS NOT NULL AND r.received_at >= COALESCE(v.effective_at,'-infinity'::timestamptz) AND r.received_at < COALESCE(v.next_effective_at,'infinity'::timestamptz)), pending AS (SELECT MIN(r.received_at) AS first_pending FROM raw_events r, revision v, processed p WHERE r.site_id=$1 AND r.event_type='custom_event' AND r.processed_at IS NULL AND r.received_at <= p.max_received AND r.received_at >= COALESCE(v.effective_at,'-infinity'::timestamptz) AND r.received_at < COALESCE(v.next_effective_at,'infinity'::timestamptz)) INSERT INTO definition_revision_watermarks(site_id,definition_version,source_name,processed_received_watermark) SELECT $1,$2,$3,CASE WHEN q.first_pending IS NULL THEN p.max_received ELSE q.first_pending-INTERVAL '1 microsecond' END FROM processed p CROSS JOIN pending q WHERE EXISTS(SELECT 1 FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$2) ON CONFLICT(site_id,definition_version,source_name) DO UPDATE SET processed_received_watermark=EXCLUDED.processed_received_watermark,updated_at=NOW()")
            .bind(site_id).bind(definition_version).bind(source).execute(&mut **transaction).await?;
    }
    Ok(())
}

async fn lock_site(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
) -> Result<(), ProcessorError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(site_id)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

async fn load_site_events(pool: &PgPool, site_id: &str) -> Result<Vec<RawEvent>, ProcessorError> {
    Ok(sqlx::query_as::<
        _,
        (
            i64,
            String,
            DateTime<Utc>,
            DateTime<Utc>,
            String,
            Option<String>,
            Option<i32>,
            serde_json::Value,
        ),
    >(
        "SELECT id, event_id, occurred_at, received_at, COALESCE(path, ''),
                visitor_id::text, context_schema_version, payload
         FROM raw_events
         WHERE site_id = $1 AND event_type = 'page_view' AND processed_at IS NOT NULL
         ORDER BY occurred_at, event_id",
    )
    .bind(site_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(
        |(
            id,
            event_id,
            occurred_at,
            received_at,
            path,
            visitor_id,
            context_schema_version,
            payload,
        )| RawEvent {
            id,
            event_id,
            site_id: site_id.to_owned(),
            occurred_at,
            received_at,
            path,
            visitor_id,
            context_schema_version,
            payload,
        },
    )
    .collect())
}

async fn copy_disabled_generation_facts(
    transaction: &mut Transaction<'_, Postgres>,
    new_generation: &str,
    previous_generation: Option<&str>,
    capabilities: &crate::CapabilitySnapshot,
    explicit_backfill: bool,
) -> Result<(), ProcessorError> {
    let Some(previous_generation) = previous_generation else {
        return Ok(());
    };
    let groups: &[(&str, &str)] = &[
        ("browser_context", "normalized_event_context"),
        ("anonymous_visitors", "visitor_event_facts"),
        ("sessions", "sessions"),
        ("sessions", "session_events"),
        ("dimensions", "dimension_event_facts"),
    ];
    for (capability, table) in groups {
        let activation_cutoff = capabilities
            .enabled_since(capability)
            .filter(|since| since.timestamp() > 0);
        if capabilities.enabled(capability) && (explicit_backfill || activation_cutoff.is_none()) {
            continue;
        }
        let sql = match *table {
            "normalized_event_context" => {
                "INSERT INTO normalized_event_context (generation_id,raw_event_id,site_id,context_schema_version,parser_version,language,timezone,viewport_width,viewport_height,screen_width,screen_height,utm_source,utm_medium,utm_campaign,utm_term,utm_content,referrer_host,device,browser,os) SELECT $1::uuid,c.raw_event_id,c.site_id,c.context_schema_version,c.parser_version,c.language,c.timezone,c.viewport_width,c.viewport_height,c.screen_width,c.screen_height,c.utm_source,c.utm_medium,c.utm_campaign,c.utm_term,c.utm_content,c.referrer_host,c.device,c.browser,c.os FROM normalized_event_context c JOIN raw_events r ON r.id=c.raw_event_id WHERE c.generation_id=$2::uuid AND ($3::timestamptz IS NULL OR r.received_at < $3)"
            }
            "visitor_event_facts" => {
                "INSERT INTO visitor_event_facts (generation_id,raw_event_id,site_id,visitor_id,occurred_at,day) SELECT $1::uuid,v.raw_event_id,v.site_id,v.visitor_id,v.occurred_at,v.day FROM visitor_event_facts v JOIN raw_events r ON r.id=v.raw_event_id WHERE v.generation_id=$2::uuid AND ($3::timestamptz IS NULL OR r.received_at < $3)"
            }
            "sessions" => {
                "INSERT INTO sessions (generation_id,session_id,site_id,visitor_id,started_at,ended_at,page_views) SELECT $1::uuid,s.session_id,s.site_id,s.visitor_id,s.started_at,s.ended_at,s.page_views FROM sessions s WHERE s.generation_id=$2::uuid AND ($3::timestamptz IS NULL OR EXISTS (SELECT 1 FROM session_events se JOIN raw_events r ON r.id=se.raw_event_id WHERE se.generation_id=s.generation_id AND se.session_id=s.session_id AND r.received_at < $3))"
            }
            "session_events" => {
                "INSERT INTO session_events (generation_id,raw_event_id,site_id,visitor_id,session_id,occurred_at,day) SELECT $1::uuid,se.raw_event_id,se.site_id,se.visitor_id,se.session_id,se.occurred_at,se.day FROM session_events se JOIN raw_events r ON r.id=se.raw_event_id WHERE se.generation_id=$2::uuid AND ($3::timestamptz IS NULL OR r.received_at < $3)"
            }
            "dimension_event_facts" => {
                "INSERT INTO dimension_event_facts (generation_id,raw_event_id,site_id,visitor_id,session_id,dimension,value,occurred_at,day) SELECT $1::uuid,d.raw_event_id,d.site_id,d.visitor_id,d.session_id,d.dimension,d.value,d.occurred_at,d.day FROM dimension_event_facts d JOIN raw_events r ON r.id=d.raw_event_id WHERE d.generation_id=$2::uuid AND ($3::timestamptz IS NULL OR r.received_at < $3)"
            }
            _ => unreachable!(),
        };
        sqlx::query(sql)
            .bind(new_generation)
            .bind(previous_generation)
            .bind(activation_cutoff)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

async fn write_derived_results(
    transaction: &mut Transaction<'_, Postgres>,
    generation_id: &str,
    events: &[RawEvent],
    parser: &impl UserAgentParser,
    capabilities: &crate::CapabilitySnapshot,
    explicit_backfill: bool,
) -> Result<(), ProcessorError> {
    let include = |event: &RawEvent, capability: &str| {
        explicit_backfill || !event_is_before_activation(event, capabilities, capability)
    };
    let mut normalized_by_event_id: HashMap<i64, NormalizedContext> = HashMap::new();
    for event in events.iter().filter(|event| {
        capabilities.enabled("browser_context")
            && include(event, "browser_context")
            && event.context_schema_version == Some(1)
    }) {
        let context = event.payload.get("context");
        let user_agent = context
            .and_then(|value| value.get("user_agent"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown");
        let normalized = normalize_context(context, user_agent, parser);
        insert_normalized_context(transaction, generation_id, event, &normalized).await?;
        normalized_by_event_id.insert(event.id, normalized);
    }

    let visitor_events: Vec<&RawEvent> = events
        .iter()
        .filter(|event| {
            capabilities.enabled("anonymous_visitors")
                && include(event, "anonymous_visitors")
                && event.visitor_id.is_some()
        })
        .collect();
    for event in &visitor_events {
        let visitor_id = event.visitor_id.as_deref().expect("filtered above");
        sqlx::query(
            "INSERT INTO visitor_event_facts
                (generation_id, raw_event_id, site_id, visitor_id, occurred_at, day)
             VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6)",
        )
        .bind(generation_id)
        .bind(event.id)
        .bind(&event.site_id)
        .bind(visitor_id)
        .bind(event.occurred_at)
        .bind(event.occurred_at.date_naive())
        .execute(&mut **transaction)
        .await?;
    }

    let mut grouped: HashMap<(String, String), Vec<SessionInput>> = HashMap::new();
    for event in visitor_events
        .iter()
        .filter(|event| capabilities.enabled("sessions") && include(event, "sessions"))
    {
        let visitor_id = event.visitor_id.as_deref().expect("filtered above");
        grouped
            .entry((event.site_id.clone(), visitor_id.to_owned()))
            .or_default()
            .push(SessionInput {
                event_id: event.event_id.clone(),
                site_id: event.site_id.clone(),
                visitor_id: visitor_id.to_owned(),
                occurred_at: event.occurred_at,
            });
    }

    let mut sessions: Vec<SessionOutput> = Vec::new();
    if capabilities.enabled("sessions") {
        for group in grouped.values() {
            sessions.extend(sessionize(group, generation_id));
        }
    }
    let event_lookup: HashMap<&str, &RawEvent> = visitor_events
        .iter()
        .map(|event| (event.event_id.as_str(), *event))
        .collect();
    let mut session_by_event_id: HashMap<String, String> = HashMap::new();

    for session in &sessions {
        sqlx::query(
            "INSERT INTO sessions
                (generation_id, session_id, site_id, visitor_id, started_at, ended_at, page_views)
             VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7)",
        )
        .bind(generation_id)
        .bind(&session.session_id)
        .bind(&session.site_id)
        .bind(&session.visitor_id)
        .bind(session.started_at)
        .bind(session.ended_at)
        .bind(session.page_views)
        .execute(&mut **transaction)
        .await?;

        for session_event in &session.events {
            session_by_event_id.insert(session_event.event_id.clone(), session.session_id.clone());
            let event = event_lookup
                .get(session_event.event_id.as_str())
                .expect("session event must reference raw event");
            sqlx::query(
                "INSERT INTO session_events
                    (generation_id, raw_event_id, site_id, visitor_id, session_id, occurred_at, day)
                 VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6, $7)",
            )
            .bind(generation_id)
            .bind(event.id)
            .bind(&event.site_id)
            .bind(&session.visitor_id)
            .bind(&session.session_id)
            .bind(event.occurred_at)
            .bind(event.occurred_at.date_naive())
            .execute(&mut **transaction)
            .await?;
        }
    }

    if capabilities.enabled("dimensions") {
        let dimension_events = events
            .iter()
            .filter(|event| include(event, "dimensions"))
            .cloned()
            .collect::<Vec<_>>();
        write_dimension_results(
            transaction,
            generation_id,
            &dimension_events,
            &normalized_by_event_id,
            &session_by_event_id,
        )
        .await?;
    }

    let mut visitor_daily: BTreeMap<(String, NaiveDate), (HashSet<String>, i64)> = BTreeMap::new();
    for event in &visitor_events {
        let entry = visitor_daily
            .entry((event.site_id.clone(), event.occurred_at.date_naive()))
            .or_default();
        entry
            .0
            .insert(event.visitor_id.clone().expect("filtered above"));
        entry.1 += 1;
    }
    for ((site_id, day), (unique_visitors, page_views)) in visitor_daily {
        sqlx::query(
            "INSERT INTO visitor_daily
                (generation_id, site_id, day, unique_visitors, page_views)
             VALUES ($1::uuid, $2, $3, $4, $5)",
        )
        .bind(generation_id)
        .bind(site_id)
        .bind(day)
        .bind(unique_visitors.len() as i64)
        .bind(page_views)
        .execute(&mut **transaction)
        .await?;
    }

    let mut session_daily: BTreeMap<(String, NaiveDate), (i64, i64)> = BTreeMap::new();
    for session in &sessions {
        let entry = session_daily
            .entry((session.site_id.clone(), session.started_at.date_naive()))
            .or_default();
        entry.0 += 1;
        entry.1 += session.page_views;
    }
    for ((site_id, day), (session_count, page_views)) in session_daily {
        sqlx::query(
            "INSERT INTO session_daily
                (generation_id, site_id, day, sessions, page_views)
             VALUES ($1::uuid, $2, $3, $4, $5)",
        )
        .bind(generation_id)
        .bind(site_id)
        .bind(day)
        .bind(session_count)
        .bind(page_views)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

async fn write_dimension_results(
    transaction: &mut Transaction<'_, Postgres>,
    generation_id: &str,
    events: &[RawEvent],
    normalized_by_event_id: &HashMap<i64, NormalizedContext>,
    session_by_event_id: &HashMap<String, String>,
) -> Result<(), ProcessorError> {
    let mut daily: BTreeMap<DimensionDailyKey, DimensionDailyCounts> = BTreeMap::new();

    for event in events {
        let Some(context) = normalized_by_event_id.get(&event.id) else {
            continue;
        };
        let visitor_id = event.visitor_id.clone();
        let session_id = visitor_id
            .as_ref()
            .and_then(|_| session_by_event_id.get(&event.event_id).cloned());
        for (dimension, value) in context_dimensions(context) {
            sqlx::query(
                "INSERT INTO dimension_event_facts
                    (generation_id, raw_event_id, site_id, visitor_id, session_id,
                     dimension, value, occurred_at, day)
                 VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6, $7, $8, $9)",
            )
            .bind(generation_id)
            .bind(event.id)
            .bind(&event.site_id)
            .bind(visitor_id.as_deref())
            .bind(session_id.as_deref())
            .bind(dimension)
            .bind(value)
            .bind(event.occurred_at)
            .bind(event.occurred_at.date_naive())
            .execute(&mut **transaction)
            .await?;

            let entry = daily
                .entry((
                    event.site_id.clone(),
                    event.occurred_at.date_naive(),
                    dimension.to_owned(),
                    value.to_owned(),
                ))
                .or_default();
            entry.0 += 1;
            if let Some(visitor_id) = visitor_id.as_ref() {
                entry.1.insert(visitor_id.clone());
            }
            if let Some(session_id) = session_id.as_ref() {
                entry.2.insert(session_id.clone());
            }
        }
    }

    for ((site_id, day, dimension, value), (page_views, visitors, sessions)) in daily {
        sqlx::query(
            "INSERT INTO dimension_daily
                (generation_id, site_id, day, dimension, value,
                 page_views, unique_visitors, sessions)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(generation_id)
        .bind(site_id)
        .bind(day)
        .bind(dimension)
        .bind(value)
        .bind(page_views)
        .bind(visitors.len() as i64)
        .bind(sessions.len() as i64)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

fn context_dimensions(context: &NormalizedContext) -> Vec<(&'static str, &str)> {
    let mut dimensions = vec![
        ("language", context.language.as_str()),
        ("timezone", context.timezone.as_str()),
        ("referrer_host", context.referrer_host.as_str()),
        ("device", context.device.as_str()),
        ("browser", context.browser.as_str()),
        ("os", context.os.as_str()),
    ];
    for (dimension, value) in [
        ("utm_source", context.utm_source.as_deref()),
        ("utm_medium", context.utm_medium.as_deref()),
        ("utm_campaign", context.utm_campaign.as_deref()),
        ("utm_term", context.utm_term.as_deref()),
        ("utm_content", context.utm_content.as_deref()),
    ] {
        if let Some(value) = value {
            dimensions.push((dimension, value));
        }
    }
    dimensions
}

async fn insert_normalized_context(
    transaction: &mut Transaction<'_, Postgres>,
    generation_id: &str,
    event: &RawEvent,
    context: &NormalizedContext,
) -> Result<(), ProcessorError> {
    sqlx::query(
        "INSERT INTO normalized_event_context
            (generation_id, raw_event_id, site_id, context_schema_version,
             parser_version, language, timezone, viewport_width, viewport_height,
             screen_width, screen_height, utm_source, utm_medium, utm_campaign,
             utm_term, utm_content, referrer_host, device, browser, os)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 $12, $13, $14, $15, $16, $17, $18, $19, $20)",
    )
    .bind(generation_id)
    .bind(event.id)
    .bind(&event.site_id)
    .bind(context.context_schema_version)
    .bind(WOOTHEE_VERSION)
    .bind(&context.language)
    .bind(&context.timezone)
    .bind(context.viewport_width)
    .bind(context.viewport_height)
    .bind(context.screen_width)
    .bind(context.screen_height)
    .bind(&context.utm_source)
    .bind(&context.utm_medium)
    .bind(&context.utm_campaign)
    .bind(&context.utm_term)
    .bind(&context.utm_content)
    .bind(&context.referrer_host)
    .bind(&context.device)
    .bind(&context.browser)
    .bind(&context.os)
    .execute(&mut **transaction)
    .await?;
    Ok(())
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

async fn load_definition_revision(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    received_at: DateTime<Utc>,
) -> Result<crate::definitions::AnalyticsDefinitions, ProcessorError> {
    let document = sqlx::query_scalar::<_, serde_json::Value>("SELECT document FROM site_definition_revisions WHERE site_id=$1 AND (effective_at IS NULL OR effective_at <= $2) ORDER BY effective_at DESC NULLS LAST, revision DESC LIMIT 1")
        .bind(site_id).bind(received_at).fetch_optional(&mut **transaction).await?;
    let Some(document) = document else {
        return Ok(crate::definitions::AnalyticsDefinitions {
            version: "none".to_owned(),
            sites: Vec::new(),
        });
    };
    let version = document
        .get("definition_version")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("none");
    let site = serde_json::json!({"site_id":site_id,"conversions":document.get("conversions").cloned().unwrap_or_else(|| serde_json::json!([])),"funnels":document.get("funnels").cloned().unwrap_or_else(|| serde_json::json!([]))});
    let definitions: crate::definitions::AnalyticsDefinitions =
        serde_json::from_value(serde_json::json!({"version":version,"sites":[site]}))
            .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
    Ok(definitions)
}
