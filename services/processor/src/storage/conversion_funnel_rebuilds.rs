//! PostgreSQL reads and writes for conversion and funnel fact rebuilds.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgPool};

pub(crate) type CustomEventRebuildRow = (
    i64,
    String,
    DateTime<Utc>,
    DateTime<Utc>,
    Option<String>,
    Value,
);

pub(crate) async fn load_definition_revision_for_version(
    pool: &PgPool,
    site_id: &str,
    version: &str,
) -> Result<Option<(i64, Value)>, sqlx::Error> {
    sqlx::query_as::<_, (i64, Value)>(
        "SELECT revision, document FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$2",
    )
    .bind(site_id)
    .bind(version)
    .fetch_optional(pool)
    .await
}

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

pub(crate) async fn load_processed_custom_events(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<Vec<CustomEventRebuildRow>, sqlx::Error> {
    sqlx::query_as::<_, CustomEventRebuildRow>(
        "SELECT id,event_id,occurred_at,received_at,visitor_id::text,payload
         FROM raw_events WHERE site_id=$1 AND event_type='custom_event'
           AND processed_at IS NOT NULL ORDER BY occurred_at,event_id",
    )
    .bind(site_id)
    .fetch_all(&mut *connection)
    .await
}

pub(crate) async fn set_custom_event_session(
    connection: &mut PgConnection,
    site_id: &str,
    event_id: &str,
    session_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE custom_event_facts SET session_id=$3::uuid WHERE site_id=$1 AND event_id=$2",
    )
    .bind(site_id)
    .bind(event_id)
    .bind(session_id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}
