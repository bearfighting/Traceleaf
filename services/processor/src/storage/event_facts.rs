//! PostgreSQL reads and writes for incremental event fact processing.

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{PgConnection, Postgres, Transaction};

pub(crate) async fn find_active_session(
    connection: &mut PgConnection,
    site_id: &str,
    visitor_id: &str,
    occurred_at: DateTime<Utc>,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>("SELECT se.session_id::text FROM session_events se JOIN analytics_generations g ON g.generation_id=se.generation_id AND g.site_id=se.site_id AND g.status='active' WHERE se.site_id=$1 AND se.visitor_id=$2::uuid AND se.occurred_at <= $3 AND se.occurred_at > $3 - INTERVAL '30 minutes' AND (se.occurred_at AT TIME ZONE 'UTC')::date=($3 AT TIME ZONE 'UTC')::date ORDER BY se.occurred_at DESC LIMIT 1")
        .bind(site_id)
        .bind(visitor_id)
        .bind(occurred_at)
        .fetch_optional(&mut *connection)
        .await
}

pub(crate) async fn has_linked_page_view(
    connection: &mut PgConnection,
    site_id: &str,
    page_view_event_id: &str,
    occurred_at_millis: i64,
    path: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM raw_events WHERE site_id=$1 AND event_id=$2 AND event_type='page_view' AND occurred_at=to_timestamp($3::double precision/1000) AND path=$4)")
        .bind(site_id)
        .bind(page_view_event_id)
        .bind(occurred_at_millis)
        .bind(path)
        .fetch_one(&mut *connection)
        .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_custom_event_fact(
    connection: &mut PgConnection,
    raw_event_id: i64,
    site_id: &str,
    event_id: &str,
    occurred_at: DateTime<Utc>,
    received_at: DateTime<Utc>,
    event_name: &str,
    session_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO custom_event_facts (raw_event_id, site_id, event_id, occurred_at, received_at, event_name, session_id) VALUES ($1, $2, $3, $4, $5, $6, $7::uuid) ON CONFLICT (site_id, event_id) DO NOTHING")
        .bind(raw_event_id)
        .bind(site_id)
        .bind(event_id)
        .bind(occurred_at)
        .bind(received_at)
        .bind(event_name)
        .bind(session_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn upsert_web_vital_fact(
    connection: &mut PgConnection,
    raw_event_id: i64,
    site_id: &str,
    page_view_event_id: &str,
    page_view_at_millis: i64,
    path: &str,
    metric: &str,
    value: f64,
    rating: &str,
    navigation_type: &str,
    report_sequence: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO web_vital_facts(raw_event_id,site_id,page_view_event_id,page_view_occurred_at,path,metric,value,rating,navigation_type,report_sequence) VALUES($1,$2,$3,to_timestamp($4::double precision/1000),$5,$6,$7,$8,$9,$10) ON CONFLICT(site_id,page_view_event_id,metric) DO UPDATE SET raw_event_id=EXCLUDED.raw_event_id,page_view_occurred_at=EXCLUDED.page_view_occurred_at,path=EXCLUDED.path,value=EXCLUDED.value,rating=EXCLUDED.rating,navigation_type=EXCLUDED.navigation_type,report_sequence=EXCLUDED.report_sequence WHERE EXCLUDED.report_sequence > web_vital_facts.report_sequence OR (EXCLUDED.report_sequence = web_vital_facts.report_sequence AND EXCLUDED.raw_event_id < web_vital_facts.raw_event_id)")
        .bind(raw_event_id)
        .bind(site_id)
        .bind(page_view_event_id)
        .bind(page_view_at_millis)
        .bind(path)
        .bind(metric)
        .bind(value)
        .bind(rating)
        .bind(navigation_type)
        .bind(report_sequence)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn insert_geo_country_fact(
    connection: &mut PgConnection,
    raw_event_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO geo_country_facts(raw_event_id,site_id,country_code,occurred_at)
         SELECT m.raw_event_id,m.site_id,m.country_code,r.occurred_at
         FROM geo_event_metadata m JOIN raw_events r ON r.id=m.raw_event_id
         WHERE m.raw_event_id=$1 AND r.event_type='page_view'
         ON CONFLICT(raw_event_id) DO UPDATE SET country_code=EXCLUDED.country_code,occurred_at=EXCLUDED.occurred_at",
    )
    .bind(raw_event_id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

pub(crate) async fn insert_conversion_fact(
    connection: &mut PgConnection,
    site_id: &str,
    definition_id: &str,
    definition_version: &str,
    event_id: &str,
    occurred_at: DateTime<Utc>,
    session_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO conversion_facts(site_id,definition_id,definition_version,event_id,occurred_at,session_id) VALUES($1,$2,$3,$4,$5,$6::uuid) ON CONFLICT DO NOTHING")
        .bind(site_id)
        .bind(definition_id)
        .bind(definition_version)
        .bind(event_id)
        .bind(occurred_at)
        .bind(session_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn delete_funnel_session_facts(
    connection: &mut PgConnection,
    site_id: &str,
    definition_id: &str,
    definition_version: &str,
    session_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM funnel_step_facts WHERE site_id=$1 AND definition_id=$2 AND definition_version=$3 AND session_id=$4::uuid")
        .bind(site_id)
        .bind(definition_id)
        .bind(definition_version)
        .bind(session_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn load_funnel_session_events(
    connection: &mut PgConnection,
    site_id: &str,
    session_id: &str,
    enabled_since: Option<DateTime<Utc>>,
    explicit_backfill: bool,
    definition_version: &str,
) -> Result<Vec<(String, DateTime<Utc>, String, Value)>, sqlx::Error> {
    sqlx::query_as::<_, (String, DateTime<Utc>, String, Value)>("SELECT f.event_id,f.occurred_at,f.event_name,COALESCE(r.payload->'properties','{}'::jsonb) FROM custom_event_facts f JOIN raw_events r ON r.id=f.raw_event_id WHERE f.site_id=$1 AND f.session_id=$2::uuid AND ($3::timestamptz IS NULL OR r.received_at >= $3) AND ($4::boolean OR (r.received_at >= COALESCE((SELECT effective_at FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$5), '-infinity'::timestamptz) AND r.received_at < COALESCE((SELECT MIN(next.effective_at) FROM site_definition_revisions current JOIN site_definition_revisions next ON next.site_id=current.site_id AND next.revision>current.revision WHERE current.site_id=$1 AND current.definition_version=$5), 'infinity'::timestamptz))) ORDER BY f.occurred_at,f.event_id")
        .bind(site_id)
        .bind(session_id)
        .bind(enabled_since)
        .bind(explicit_backfill)
        .bind(definition_version)
        .fetch_all(&mut *connection)
        .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_funnel_step_fact(
    connection: &mut PgConnection,
    site_id: &str,
    definition_id: &str,
    definition_version: &str,
    session_id: &str,
    step_index: i32,
    event_id: &str,
    occurred_at: DateTime<Utc>,
    cohort_day: NaiveDate,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO funnel_step_facts(site_id,definition_id,definition_version,session_id,step_index,event_id,occurred_at,cohort_day) VALUES($1,$2,$3,$4::uuid,$5,$6,$7,$8) ON CONFLICT DO NOTHING")
        .bind(site_id)
        .bind(definition_id)
        .bind(definition_version)
        .bind(session_id)
        .bind(step_index)
        .bind(event_id)
        .bind(occurred_at)
        .bind(cohort_day)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn advance_definition_watermarks(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    definition_version: &str,
    replace_definition_version: bool,
) -> Result<(), sqlx::Error> {
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
            .bind(site_id)
            .bind(definition_version)
            .bind(source)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}
