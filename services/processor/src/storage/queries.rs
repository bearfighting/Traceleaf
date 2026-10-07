use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{PgConnection, Postgres, Transaction};

use crate::domain::models::RawEvent;

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

pub(crate) async fn lock_site(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(site_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn upsert_daily(
    connection: &mut PgConnection,
    site_id: &str,
    day: NaiveDate,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO page_view_daily (site_id, day, page_views)
         VALUES ($1, $2, 1)
         ON CONFLICT (site_id, day)
         DO UPDATE SET page_views = page_view_daily.page_views + 1",
    )
    .bind(site_id)
    .bind(day)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

pub(crate) async fn upsert_route(
    connection: &mut PgConnection,
    site_id: &str,
    day: NaiveDate,
    path: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO page_view_routes (site_id, day, path, page_views)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (site_id, day, path)
         DO UPDATE SET page_views = page_view_routes.page_views + 1",
    )
    .bind(site_id)
    .bind(day)
    .bind(path)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

pub(crate) async fn upsert_total(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO page_view_totals (site_id, page_views)
         VALUES ($1, 1)
         ON CONFLICT (site_id)
         DO UPDATE SET page_views = page_view_totals.page_views + 1",
    )
    .bind(site_id)
    .execute(&mut *connection)
    .await?;
    Ok(())
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

pub(crate) async fn advance_page_view_watermark(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<(), sqlx::Error> {
    let Some(max_received_at) = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT MAX(received_at)
         FROM raw_events
         WHERE site_id = $1 AND event_type = 'page_view' AND processed_at IS NOT NULL",
    )
    .bind(site_id)
    .fetch_one(&mut *connection)
    .await?
    else {
        return Ok(());
    };

    let first_unprocessed = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT MIN(received_at)
         FROM raw_events
         WHERE site_id = $1
           AND event_type = 'page_view'
           AND processed_at IS NULL
           AND received_at <= $2",
    )
    .bind(site_id)
    .bind(max_received_at)
    .fetch_one(&mut *connection)
    .await?;
    let watermark = first_unprocessed
        .map(|value| value - chrono::Duration::microseconds(1))
        .unwrap_or(max_received_at);

    sqlx::query(
        "INSERT INTO analytics_watermarks
            (site_id, generation_id, source_name, processed_received_watermark)
         VALUES ($1, NULL, 'page_views', $2)
         ON CONFLICT (site_id, generation_id, source_name)
         DO UPDATE SET processed_received_watermark = EXCLUDED.processed_received_watermark,
                       updated_at = NOW()",
    )
    .bind(site_id)
    .bind(watermark)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

pub(crate) async fn advance_custom_event_watermark(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<(), sqlx::Error> {
    let Some(max_received_at) = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT MAX(received_at) FROM raw_events
         WHERE site_id = $1 AND event_type = 'custom_event' AND processed_at IS NOT NULL",
    )
    .bind(site_id)
    .fetch_one(&mut *connection)
    .await?
    else {
        return Ok(());
    };
    let first_unprocessed = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT MIN(received_at) FROM raw_events
         WHERE site_id = $1 AND event_type = 'custom_event' AND processed_at IS NULL AND received_at <= $2",
    ).bind(site_id).bind(max_received_at).fetch_one(&mut *connection).await?;
    let watermark = first_unprocessed
        .map(|value| value - chrono::Duration::microseconds(1))
        .unwrap_or(max_received_at);
    sqlx::query(
        "INSERT INTO analytics_watermarks (site_id, generation_id, source_name, processed_received_watermark)
         VALUES ($1, NULL, 'custom_events', $2)
         ON CONFLICT (site_id, generation_id, source_name)
         DO UPDATE SET processed_received_watermark = EXCLUDED.processed_received_watermark, updated_at = NOW()",
    ).bind(site_id).bind(watermark).execute(&mut *connection).await?;
    Ok(())
}

pub(crate) async fn advance_web_vital_watermark(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<(), sqlx::Error> {
    let Some(max_received)=sqlx::query_scalar::<_,Option<DateTime<Utc>>>("SELECT MAX(received_at) FROM raw_events WHERE site_id=$1 AND event_type='web_vital' AND processed_at IS NOT NULL").bind(site_id).fetch_one(&mut *connection).await? else{return Ok(())};
    let first_pending=sqlx::query_scalar::<_,Option<DateTime<Utc>>>("SELECT MIN(received_at) FROM raw_events WHERE site_id=$1 AND event_type='web_vital' AND processed_at IS NULL AND received_at<=$2").bind(site_id).bind(max_received).fetch_one(&mut *connection).await?;
    let watermark = first_pending
        .map(|time| time - chrono::Duration::microseconds(1))
        .unwrap_or(max_received);
    sqlx::query("INSERT INTO analytics_watermarks(site_id,generation_id,source_name,processed_received_watermark) VALUES($1,NULL,'web_vitals',$2) ON CONFLICT(site_id,generation_id,source_name) DO UPDATE SET processed_received_watermark=EXCLUDED.processed_received_watermark,updated_at=NOW()").bind(site_id).bind(watermark).execute(&mut *connection).await?;
    Ok(())
}

pub(crate) async fn enqueue_rebuild(
    connection: &mut PgConnection,
    site_id: &str,
    visitor_id: &str,
    day: NaiveDate,
    rebuild_reason: &str,
    parser_version: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO analytics_rebuild_queue
            (site_id, visitor_id, scope_from, scope_to, aggregation_version,
             parser_version, rebuild_reason)
         VALUES ($1, $2::uuid, $3, $3, 1, $5, $4)
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
    .bind(visitor_id)
    .bind(day)
    .bind(rebuild_reason)
    .bind(parser_version)
    .execute(&mut *connection)
    .await?;
    Ok(())
}
