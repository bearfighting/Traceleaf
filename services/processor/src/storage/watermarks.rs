//! Processed source watermarks.

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, Postgres, Transaction};

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

pub(crate) async fn clear_conversion_funnel_watermark_versions(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE analytics_watermarks
         SET definition_version = NULL, updated_at = NOW()
         WHERE site_id = $1 AND generation_id IS NULL
           AND source_name IN ('conversions', 'funnels')",
    )
    .bind(site_id)
    .execute(&mut *connection)
    .await?;
    Ok(())
}

pub(crate) async fn advance_generation_watermarks(
    connection: &mut PgConnection,
    site_id: &str,
    generation_id: &str,
    watermark: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    for source in ["visitor_session", "dimensions"] {
        sqlx::query("INSERT INTO analytics_watermarks(site_id,generation_id,source_name,processed_received_watermark) VALUES($1,$2::uuid,$3,$4) ON CONFLICT(site_id,generation_id,source_name) DO UPDATE SET processed_received_watermark=EXCLUDED.processed_received_watermark,updated_at=NOW()")
            .bind(site_id)
            .bind(generation_id)
            .bind(source)
            .bind(watermark)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}
