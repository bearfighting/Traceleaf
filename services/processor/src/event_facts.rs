use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};

use crate::{ProcessorError, models::RawEvent, parser::WOOTHEE_VERSION, queries};

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
    definitions: &crate::definitions::AnalyticsDefinitions,
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
    queries::lock_site(transaction, &event.site_id).await?;
    queries::advance_page_view_watermark(transaction, &event.site_id).await?;
    Ok(())
}

pub(super) async fn record_conversion_and_funnel_facts(
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
    if capabilities.enabled(crate::CapabilityId::Conversions)
        && (explicit_backfill
            || !event_is_before_activation(event, capabilities, crate::CapabilityId::Conversions))
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
            sqlx::query("DELETE FROM funnel_step_facts WHERE site_id=$1 AND definition_id=$2 AND definition_version=$3 AND session_id=$4::uuid")
                .bind(&event.site_id).bind(&funnel.id).bind(&definitions.version).bind(&session_id).execute(&mut **transaction).await?;
        }
        let funnel_enabled_since = if explicit_backfill {
            None
        } else {
            capabilities.enabled_since(crate::CapabilityId::Funnels)
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

pub(super) async fn advance_definition_watermarks(
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
