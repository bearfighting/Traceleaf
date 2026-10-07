//! Reads and writes for visitor and generation rebuild queue entries.

use chrono::NaiveDate;
use sqlx::{PgConnection, PgPool};

pub(crate) type RebuildQueueRow = (i64, String, NaiveDate, NaiveDate, String, String);

pub(crate) async fn claim_next_incremental_rebuild(
    connection: &mut PgConnection,
) -> Result<Option<RebuildQueueRow>, sqlx::Error> {
    sqlx::query_as::<_, RebuildQueueRow>(
        "SELECT queue_id, site_id, scope_from, scope_to, parser_version, rebuild_reason
         FROM analytics_rebuild_queue
         WHERE rebuild_reason = 'incremental'
           AND (status = 'pending' OR (status = 'running' AND updated_at < NOW() - INTERVAL '5 minutes'))
         ORDER BY queue_id LIMIT 1 FOR UPDATE SKIP LOCKED",
    )
    .fetch_optional(&mut *connection)
    .await
}

pub(crate) async fn load_rebuild_queue_status(
    connection: &mut PgConnection,
    queue_id: i64,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("SELECT status FROM analytics_rebuild_queue WHERE queue_id=$1 FOR UPDATE")
        .bind(queue_id)
        .fetch_one(&mut *connection)
        .await
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

pub(crate) async fn enqueue_site_rebuild(
    pool: &PgPool,
    site_id: &str,
    scope_from: NaiveDate,
    scope_to: NaiveDate,
    aggregation_version: i32,
    parser_version: &str,
    reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO analytics_rebuild_queue (site_id,scope_from,scope_to,aggregation_version,parser_version,rebuild_reason) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (site_id,visitor_id,aggregation_version,scope_from,scope_to) WHERE status IN ('pending','running') DO UPDATE SET rebuild_reason=CASE WHEN analytics_rebuild_queue.rebuild_reason='backfill' OR EXCLUDED.rebuild_reason='backfill' THEN 'backfill' ELSE analytics_rebuild_queue.rebuild_reason END,parser_version=EXCLUDED.parser_version,updated_at=NOW()")
        .bind(site_id)
        .bind(scope_from)
        .bind(scope_to)
        .bind(aggregation_version)
        .bind(parser_version)
        .bind(reason)
        .execute(pool)
        .await?;
    Ok(())
}

pub(crate) async fn set_rebuild_running(
    connection: &mut PgConnection,
    queue_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_rebuild_queue SET status='running', attempts=attempts+1, updated_at=NOW() WHERE queue_id=$1")
        .bind(queue_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn set_rebuild_pending(
    connection: &mut PgConnection,
    queue_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_rebuild_queue SET status='pending',failure_reason=NULL,updated_at=NOW() WHERE queue_id=$1")
        .bind(queue_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn set_rebuild_failed(
    pool: &PgPool,
    queue_id: i64,
    reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_rebuild_queue SET status='failed', failure_reason=$2, updated_at=NOW() WHERE queue_id=$1")
        .bind(queue_id)
        .bind(reason)
        .execute(pool)
        .await?;
    Ok(())
}

pub(crate) async fn fail_rebuild_queue_by_id(
    pool: &PgPool,
    queue_id: i64,
    failure_reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_rebuild_queue SET status='failed',failure_reason=$2,updated_at=NOW() WHERE queue_id=$1 AND status IN ('pending','running')")
        .bind(queue_id)
        .bind(failure_reason)
        .execute(pool)
        .await?;
    Ok(())
}

pub(crate) async fn fail_rebuild_queue_by_scope(
    pool: &PgPool,
    site_id: &str,
    scope_from: NaiveDate,
    scope_to: NaiveDate,
    reason: &str,
    parser_version: &str,
    failure_reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_rebuild_queue SET status='failed',failure_reason=$4,updated_at=NOW() WHERE site_id=$1 AND scope_from=$2 AND scope_to=$3 AND rebuild_reason=$5 AND parser_version=$6 AND status IN ('pending','running')")
        .bind(site_id)
        .bind(scope_from)
        .bind(scope_to)
        .bind(failure_reason)
        .bind(reason)
        .bind(parser_version)
        .execute(pool)
        .await?;
    Ok(())
}

pub(crate) async fn complete_incremental_rebuilds(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_rebuild_queue SET status='completed',updated_at=NOW() WHERE site_id=$1 AND rebuild_reason='incremental' AND status IN ('pending','running')")
        .bind(site_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn complete_backfill_rebuilds(
    connection: &mut PgConnection,
    site_id: &str,
    scope_from: NaiveDate,
    scope_to: NaiveDate,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE analytics_rebuild_queue SET status='completed',updated_at=NOW() WHERE site_id=$1 AND scope_from >= $2 AND scope_to <= $3 AND rebuild_reason='backfill' AND status IN ('pending','running')")
        .bind(site_id)
        .bind(scope_from)
        .bind(scope_to)
        .execute(&mut *connection)
        .await?;
    Ok(())
}
