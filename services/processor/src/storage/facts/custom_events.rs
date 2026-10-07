//! Custom event fact writes and rebuild reads.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgConnection;

pub(crate) type CustomEventRebuildRow = (
    i64,
    String,
    DateTime<Utc>,
    DateTime<Utc>,
    Option<String>,
    Value,
);

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

pub(crate) async fn rebuild_custom_event_facts(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<u64, sqlx::Error> {
    sqlx::query("DELETE FROM custom_event_facts WHERE site_id = $1")
        .bind(site_id)
        .execute(&mut *connection)
        .await?;
    let result = sqlx::query(
        "INSERT INTO custom_event_facts (raw_event_id, site_id, event_id, occurred_at, received_at, event_name)
         SELECT id, site_id, event_id, occurred_at, received_at, payload->>'event_name'
         FROM raw_events
         WHERE site_id = $1 AND event_type = 'custom_event' AND processed_at IS NOT NULL",
    )
    .bind(site_id)
    .execute(&mut *connection)
    .await?;
    Ok(result.rows_affected())
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
