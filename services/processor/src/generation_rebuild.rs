use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    ProcessorError, event_facts,
    models::RawEvent,
    normalizer::{NormalizedContext, normalize_context},
    parser::{UserAgentParser, WOOTHEE_VERSION, WootheeParser},
    processor::Processor,
    queries,
    sessionizer::{SessionInput, SessionOutput, sessionize},
};

const AGGREGATION_VERSION: i32 = 1;
type DimensionDailyKey = (String, NaiveDate, String, String);
type DimensionDailyCounts = (i64, HashSet<String>, HashSet<String>);

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
        if !(capabilities.enabled(crate::CapabilityId::AnonymousVisitors)
            || capabilities.enabled(crate::CapabilityId::Sessions)
            || capabilities.enabled(crate::CapabilityId::BrowserContext)
            || capabilities.enabled(crate::CapabilityId::Dimensions))
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

        queries::lock_site(&mut *transaction, &request.site_id).await?;
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
                    caps.enabled(crate::CapabilityId::AnonymousVisitors)
                        || caps.enabled(crate::CapabilityId::Sessions)
                        || caps.enabled(crate::CapabilityId::BrowserContext)
                        || caps.enabled(crate::CapabilityId::Dimensions)
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
    let groups: &[(crate::CapabilityId, &str)] = &[
        (
            crate::CapabilityId::BrowserContext,
            "normalized_event_context",
        ),
        (
            crate::CapabilityId::AnonymousVisitors,
            "visitor_event_facts",
        ),
        (crate::CapabilityId::Sessions, "sessions"),
        (crate::CapabilityId::Sessions, "session_events"),
        (crate::CapabilityId::Dimensions, "dimension_event_facts"),
    ];
    for (capability, table) in groups {
        let activation_cutoff = capabilities
            .enabled_since(*capability)
            .filter(|since| since.timestamp() > 0);
        if capabilities.enabled(*capability) && (explicit_backfill || activation_cutoff.is_none()) {
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
    let include = |event: &RawEvent, capability: crate::CapabilityId| {
        explicit_backfill
            || !event_facts::event_is_before_activation(event, capabilities, capability)
    };
    let mut normalized_by_event_id: HashMap<i64, NormalizedContext> = HashMap::new();
    for event in events.iter().filter(|event| {
        capabilities.enabled(crate::CapabilityId::BrowserContext)
            && include(event, crate::CapabilityId::BrowserContext)
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
            capabilities.enabled(crate::CapabilityId::AnonymousVisitors)
                && include(event, crate::CapabilityId::AnonymousVisitors)
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
    for event in visitor_events.iter().filter(|event| {
        capabilities.enabled(crate::CapabilityId::Sessions)
            && include(event, crate::CapabilityId::Sessions)
    }) {
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
    if capabilities.enabled(crate::CapabilityId::Sessions) {
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

    if capabilities.enabled(crate::CapabilityId::Dimensions) {
        let dimension_events = events
            .iter()
            .filter(|event| include(event, crate::CapabilityId::Dimensions))
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
