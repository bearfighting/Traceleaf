//! Raw event queue reads and processing state updates.

use crate::domain::models::RawEvent;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, Postgres, Transaction};

pub(crate) async fn claim_next_event(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<Option<RawEvent>, sqlx::Error> {
    sqlx::query_as::<
        _,
        (
            i64,
            String,
            String,
            DateTime<Utc>,
            DateTime<Utc>,
            String,
            Option<String>,
            Option<i32>,
            Value,
        ),
    >(
        "SELECT id, event_id, site_id, occurred_at, received_at, COALESCE(path, ''),
                visitor_id::text, context_schema_version, payload
         FROM raw_events
         WHERE processed_at IS NULL
         ORDER BY id
         LIMIT 1
         FOR UPDATE SKIP LOCKED",
    )
    .fetch_optional(&mut **transaction)
    .await
    .map(|event| {
        event.map(
            |(
                id,
                event_id,
                site_id,
                occurred_at,
                received_at,
                path,
                visitor_id,
                context_schema_version,
                payload,
            )| RawEvent {
                id,
                event_id,
                site_id,
                occurred_at,
                received_at,
                path,
                visitor_id,
                context_schema_version,
                payload,
            },
        )
    })
}

pub(crate) async fn mark_processed(
    connection: &mut PgConnection,
    event_id: i64,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE raw_events
         SET processed_at = NOW()
         WHERE id = $1 AND processed_at IS NULL",
    )
    .bind(event_id)
    .execute(&mut *connection)
    .await?;
    Ok(result.rows_affected() == 1)
}
