use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{NaiveDate, Utc};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};

use crate::{
    ProcessorError,
    application::{Processor, event_facts},
    domain::{
        models::RawEvent,
        normalizer::{NormalizedContext, normalize_context},
        parser::{UserAgentParser, WOOTHEE_VERSION, WootheeParser},
        sessionizer::{SessionInput, SessionOutput, sessionize},
    },
    storage::{generation_facts, generation_lifecycle as generation_storage, queries},
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

    async fn rebuild(&self, request: RebuildRequest) -> Result<(), ProcessorError> {
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
                    generation_storage::fail_rebuild_queue_by_id(
                        &self.pool,
                        queue_id,
                        &failure_reason,
                    )
                    .await
                } else {
                    generation_storage::fail_rebuild_queue_by_scope(
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

        queries::lock_site(&mut transaction, &request.site_id).await?;
        if let Some(queue_id) = request.queue_id {
            let queue_status =
                generation_storage::load_rebuild_queue_status(&mut transaction, queue_id).await?;
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
                generation_storage::set_rebuild_pending(&mut transaction, queue_id).await?;
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
        generation_facts::refresh_rollups(&mut transaction, generation_id).await?;

        if let Some(watermark) = watermark {
            generation_storage::advance_generation_watermarks(
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
            generation_storage::complete_incremental_rebuilds(&mut transaction, &request.site_id)
                .await?;
        } else if request.rebuild_reason == "backfill" {
            generation_storage::complete_backfill_rebuilds(
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
    let groups: &[(crate::CapabilityId, generation_facts::DisabledFactTable)] = &[
        (
            crate::CapabilityId::BrowserContext,
            generation_facts::DisabledFactTable::NormalizedContext,
        ),
        (
            crate::CapabilityId::AnonymousVisitors,
            generation_facts::DisabledFactTable::VisitorEvents,
        ),
        (
            crate::CapabilityId::Sessions,
            generation_facts::DisabledFactTable::Sessions,
        ),
        (
            crate::CapabilityId::Sessions,
            generation_facts::DisabledFactTable::SessionEvents,
        ),
        (
            crate::CapabilityId::Dimensions,
            generation_facts::DisabledFactTable::DimensionEvents,
        ),
    ];
    for (capability, table) in groups {
        let activation_cutoff = capabilities
            .enabled_since(*capability)
            .filter(|since| since.timestamp() > 0);
        if capabilities.enabled(*capability) && (explicit_backfill || activation_cutoff.is_none()) {
            continue;
        }
        generation_facts::copy_disabled_facts(
            transaction,
            new_generation,
            previous_generation,
            *table,
            activation_cutoff,
        )
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
        generation_facts::insert_normalized_context(
            transaction,
            generation_id,
            event,
            &normalized,
            WOOTHEE_VERSION,
        )
        .await?;
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
        generation_facts::insert_visitor_event(transaction, generation_id, event, visitor_id)
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
        generation_facts::insert_session(
            transaction,
            generation_id,
            &session.session_id,
            &session.site_id,
            &session.visitor_id,
            session.started_at,
            session.ended_at,
            session.page_views,
        )
        .await?;

        for session_event in &session.events {
            session_by_event_id.insert(session_event.event_id.clone(), session.session_id.clone());
            let event = event_lookup
                .get(session_event.event_id.as_str())
                .expect("session event must reference raw event");
            generation_facts::insert_session_event(
                transaction,
                generation_id,
                event,
                &session.visitor_id,
                &session.session_id,
            )
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
        generation_facts::insert_visitor_daily(
            transaction,
            generation_id,
            &site_id,
            day,
            unique_visitors.len() as i64,
            page_views,
        )
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
        generation_facts::insert_session_daily(
            transaction,
            generation_id,
            &site_id,
            day,
            session_count,
            page_views,
        )
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
            generation_facts::insert_dimension_event(
                transaction,
                generation_id,
                event,
                visitor_id.as_deref(),
                session_id.as_deref(),
                dimension,
                value,
            )
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
        generation_facts::insert_dimension_daily(
            transaction,
            generation_id,
            &site_id,
            day,
            &dimension,
            &value,
            page_views,
            visitors.len() as i64,
            sessions.len() as i64,
        )
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
