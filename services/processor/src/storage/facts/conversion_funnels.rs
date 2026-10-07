//! Conversion and funnel fact rebuild operations.

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::PgConnection;

pub(crate) async fn delete_conversion_facts_for_version(
    connection: &mut PgConnection,
    site_id: &str,
    version: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM conversion_facts WHERE site_id=$1 AND definition_version=$2")
        .bind(site_id)
        .bind(version)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn delete_conversion_facts_since(
    connection: &mut PgConnection,
    site_id: &str,
    version: &str,
    enabled_since: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM conversion_facts f USING raw_events r WHERE f.site_id=$1 AND f.definition_version=$2 AND r.site_id=f.site_id AND r.event_id=f.event_id AND r.received_at >= $3")
        .bind(site_id)
        .bind(version)
        .bind(enabled_since)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn delete_funnel_facts_for_version(
    connection: &mut PgConnection,
    site_id: &str,
    version: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM funnel_step_facts WHERE site_id=$1 AND definition_version=$2")
        .bind(site_id)
        .bind(version)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn delete_funnel_facts_since(
    connection: &mut PgConnection,
    site_id: &str,
    version: &str,
    enabled_since: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM funnel_step_facts f USING raw_events r WHERE f.site_id=$1 AND f.definition_version=$2 AND r.site_id=f.site_id AND r.event_id=f.event_id AND r.received_at >= $3")
        .bind(site_id)
        .bind(version)
        .bind(enabled_since)
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
