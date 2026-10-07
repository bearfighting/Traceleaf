use chrono::Utc;
use sqlx::{Postgres, Transaction};

use crate::{
    ProcessorError,
    domain::{definitions::AnalyticsDefinitions, models::RawEvent, parser::WOOTHEE_VERSION},
    storage::{event_facts as fact_storage, queries},
};

pub(super) fn event_is_before_activation(
    event: &RawEvent,
    capabilities: &crate::CapabilitySnapshot,
    capability: crate::CapabilityId,
) -> bool {
    capabilities
        .enabled_since(capability)
        .is_some_and(|enabled_since| {
            enabled_since.timestamp() > 0 && event.received_at < enabled_since
        })
}

pub(super) async fn process_event(
    transaction: &mut Transaction<'_, Postgres>,
    event: &RawEvent,
    definitions: &AnalyticsDefinitions,
    capabilities: &crate::CapabilitySnapshot,
) -> Result<(), ProcessorError> {
    let event_type = event
        .payload
        .get("type")
        .and_then(serde_json::Value::as_str);
    if (event_type == Some("custom_event")
        && (!capabilities.enabled(crate::CapabilityId::CustomEvents)
            || event_is_before_activation(event, capabilities, crate::CapabilityId::CustomEvents)))
        || (event_type == Some("web_vital")
            && (!capabilities.enabled(crate::CapabilityId::WebVitals)
                || event_is_before_activation(event, capabilities, crate::CapabilityId::WebVitals)))
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
            queries::lock_site(transaction, &event.site_id).await?;
            let session_id = if capabilities.enabled(crate::CapabilityId::Sessions) {
                if let Some(visitor_id) = event.visitor_id.as_deref() {
                    fact_storage::find_active_session(
                        transaction,
                        &event.site_id,
                        visitor_id,
                        event.occurred_at,
                    )
                    .await?
                } else {
                    None
                }
            } else {
                None
            };
            fact_storage::insert_custom_event_fact(
                transaction,
                event.id,
                &event.site_id,
                &event.event_id,
                event.occurred_at,
                event.received_at,
                event_name,
                session_id.as_deref(),
            )
            .await?;
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
            let linked = fact_storage::has_linked_page_view(
                transaction,
                &event.site_id,
                pv_id,
                page_view_at,
                path,
            )
            .await?;
            if !linked {
                return Err(ProcessorError::InvalidCustomEvent(event.event_id.clone()));
            }
            fact_storage::upsert_web_vital_fact(
                transaction,
                event.id,
                &event.site_id,
                pv_id,
                page_view_at,
                path,
                metric,
                value,
                rating,
                nav,
                sequence,
            )
            .await?;
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

    if capabilities.enabled(crate::CapabilityId::AnonymousVisitors)
        || capabilities.enabled(crate::CapabilityId::Sessions)
        || capabilities.enabled(crate::CapabilityId::BrowserContext)
        || capabilities.enabled(crate::CapabilityId::Dimensions)
    {
        queries::lock_site(transaction, &event.site_id).await?;
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

    if capabilities.enabled(crate::CapabilityId::Geo)
        && !event_is_before_activation(event, capabilities, crate::CapabilityId::Geo)
    {
        fact_storage::insert_geo_country_fact(transaction, event.id).await?;
    }
    if !queries::mark_processed(transaction, event.id).await? {
        return Err(ProcessorError::RawEventNotUpdated(event.id));
    }
    queries::lock_site(transaction, &event.site_id).await?;
    queries::advance_page_view_watermark(transaction, &event.site_id).await?;
    Ok(())
}

pub(super) async fn record_conversion_and_funnel_facts(
    transaction: &mut Transaction<'_, Postgres>,
    event: &RawEvent,
    definitions: &AnalyticsDefinitions,
    event_name: &str,
    session_id: Option<String>,
    capabilities: &crate::CapabilitySnapshot,
    explicit_backfill: bool,
) -> Result<(), ProcessorError> {
    let Some(site) = definitions.for_site(&event.site_id) else {
        return Ok(());
    };
    let properties = event.payload.get("properties").cloned().unwrap_or_default();
    if capabilities.enabled(crate::CapabilityId::Conversions)
        && (explicit_backfill
            || !event_is_before_activation(event, capabilities, crate::CapabilityId::Conversions))
    {
        for conversion in &site.conversions {
            if !conversion.active {
                continue;
            }
            if crate::domain::definitions::matches(
                event_name,
                &properties,
                &conversion.event_name,
                &conversion.properties,
            ) {
                fact_storage::insert_conversion_fact(
                    transaction,
                    &event.site_id,
                    &conversion.id,
                    &definitions.version,
                    &event.event_id,
                    event.occurred_at,
                    session_id.as_deref(),
                )
                .await?;
            }
        }
    }
    if !capabilities.enabled(crate::CapabilityId::Funnels)
        || (!explicit_backfill
            && event_is_before_activation(event, capabilities, crate::CapabilityId::Funnels))
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
            fact_storage::delete_funnel_session_facts(
                transaction,
                &event.site_id,
                &funnel.id,
                &definitions.version,
                &session_id,
            )
            .await?;
        }
        let funnel_enabled_since = if explicit_backfill {
            None
        } else {
            capabilities.enabled_since(crate::CapabilityId::Funnels)
        };
        let session_events = fact_storage::load_funnel_session_events(
            transaction,
            &event.site_id,
            &session_id,
            funnel_enabled_since,
            explicit_backfill,
            &definitions.version,
        )
        .await?;
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
            if !crate::domain::definitions::matches(
                &matched_name,
                &matched_properties,
                &step.event_name,
                &step.properties,
            ) {
                continue;
            }
            let day =
                *cohort_day.get_or_insert_with(|| occurred_at.with_timezone(&Utc).date_naive());
            fact_storage::insert_funnel_step_fact(
                transaction,
                &event.site_id,
                &funnel.id,
                &definitions.version,
                &session_id,
                next_index as i32,
                &matched_event_id,
                occurred_at,
                day,
            )
            .await?;
            next_index += 1;
            previous_at = Some(occurred_at);
        }
    }
    Ok(())
}

pub(super) async fn advance_definition_watermarks(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    definition_version: &str,
    replace_definition_version: bool,
) -> Result<(), ProcessorError> {
    fact_storage::advance_definition_watermarks(
        transaction,
        site_id,
        definition_version,
        replace_definition_version,
    )
    .await?;
    Ok(())
}
