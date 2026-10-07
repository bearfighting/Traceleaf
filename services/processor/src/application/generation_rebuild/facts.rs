use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::NaiveDate;
use sqlx::{Postgres, Transaction};

use crate::{
    ProcessorError,
    application::event_facts,
    domain::{
        models::RawEvent,
        normalizer::{NormalizedContext, normalize_context},
        parser::{UserAgentParser, WOOTHEE_VERSION},
        sessionizer::{SessionInput, SessionOutput, sessionize},
    },
    storage::generation_facts,
};

type DimensionDailyKey = (String, NaiveDate, String, String);
type DimensionDailyCounts = (i64, HashSet<String>, HashSet<String>);

pub(super) async fn copy_disabled_generation_facts(
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

pub(super) async fn write_derived_results(
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
