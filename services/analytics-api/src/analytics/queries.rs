use chrono::NaiveDate;
use sqlx::PgPool;

use sqlx::{Postgres, Transaction};

use crate::analytics::models::{
    ActiveGeneration, DateRange, DimensionRow, EventDailyRow, GeoCountryRow, PageRow, TimelineRow,
    VisitorSessionRow, WatermarkRow, WebVitalReportRow,
};

pub(crate) async fn overview(pool: &PgPool, site_id: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE((SELECT page_views FROM page_view_totals WHERE site_id = $1), 0)",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await
}

pub(crate) async fn range_overview(
    pool: &PgPool,
    site_id: &str,
    range: DateRange,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, Option<i64>>(
        "SELECT SUM(page_views)::bigint FROM page_view_daily WHERE site_id = $1 AND day BETWEEN $2 AND $3",
    )
    .bind(site_id)
    .bind(range.from)
    .bind(range.to)
    .fetch_one(pool)
    .await
    .map(|page_views| page_views.unwrap_or(0))
}

pub(crate) async fn timeline(
    pool: &PgPool,
    site_id: &str,
    range: DateRange,
) -> Result<Vec<TimelineRow>, sqlx::Error> {
    sqlx::query_as::<_, TimelineRow>(
        "SELECT day, page_views FROM page_view_daily
         WHERE site_id = $1 AND day BETWEEN $2 AND $3 ORDER BY day ASC",
    )
    .bind(site_id)
    .bind(range.from)
    .bind(range.to)
    .fetch_all(pool)
    .await
}

pub(crate) async fn geo_country_coverage_from(
    pool: &PgPool,
    site_id: &str,
) -> Result<Option<NaiveDate>, sqlx::Error> {
    sqlx::query_scalar::<_, Option<NaiveDate>>(
        "SELECT MIN(r.received_at AT TIME ZONE 'UTC')::date
         FROM geo_event_metadata m
         JOIN raw_events r ON r.id=m.raw_event_id
         WHERE m.site_id=$1 AND r.event_type='page_view'",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await
}

pub(crate) async fn page_view_watermark(
    pool: &PgPool,
    site_id: &str,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, sqlx::Error> {
    sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(
        "SELECT processed_received_watermark FROM analytics_watermarks
         WHERE site_id=$1 AND generation_id IS NULL AND source_name='page_views'",
    )
    .bind(site_id)
    .fetch_optional(pool)
    .await
    .map(Option::flatten)
}

pub(crate) async fn geo_country_freshness(
    pool: &PgPool,
    site_id: &str,
) -> Result<String, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let rebuild_status = rebuild_freshness_status(&mut transaction, site_id).await?;
    if let Some(status) = rebuild_status {
        transaction.commit().await?;
        return Ok(status);
    }
    let pending = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM raw_events
         WHERE site_id=$1 AND event_type='page_view' AND processed_at IS NULL)",
    )
    .bind(site_id)
    .fetch_one(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(if pending { "stale" } else { "current" }.to_owned())
}

pub(crate) async fn pages(
    pool: &PgPool,
    site_id: &str,
    range: DateRange,
    limit: i64,
) -> Result<Vec<PageRow>, sqlx::Error> {
    sqlx::query_as::<_, PageRow>(
        "SELECT path, SUM(page_views)::bigint AS page_views
         FROM page_view_routes
         WHERE site_id = $1 AND day BETWEEN $2 AND $3
         GROUP BY path ORDER BY page_views DESC, path ASC LIMIT $4",
    )
    .bind(site_id)
    .bind(range.from)
    .bind(range.to)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub(crate) async fn custom_event_total(
    pool: &PgPool,
    site_id: &str,
    range: DateRange,
    event_name: Option<&str>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::bigint FROM custom_event_facts
         WHERE site_id = $1 AND occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND occurred_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
           AND ($4::text IS NULL OR event_name = $4)",
    )
    .bind(site_id)
    .bind(range.from)
    .bind(range.to)
    .bind(event_name)
    .fetch_one(pool)
    .await
}

pub(crate) async fn custom_event_daily_rows(
    pool: &PgPool,
    site_id: &str,
    range: DateRange,
    event_name: Option<&str>,
    limit: i64,
) -> Result<Vec<EventDailyRow>, sqlx::Error> {
    sqlx::query_as::<_, EventDailyRow>(
        "SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day, event_name, COUNT(*)::bigint AS event_count
         FROM custom_event_facts WHERE site_id = $1
           AND occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND occurred_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
           AND ($4::text IS NULL OR event_name = $4)
         GROUP BY (occurred_at AT TIME ZONE 'UTC')::date, event_name ORDER BY event_name ASC, day ASC LIMIT $5",
    )
    .bind(site_id)
    .bind(range.from)
    .bind(range.to)
    .bind(event_name)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub(crate) async fn custom_event_watermark(
    pool: &PgPool,
    site_id: &str,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, sqlx::Error> {
    sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(
        "SELECT processed_received_watermark FROM analytics_watermarks
         WHERE site_id = $1 AND generation_id IS NULL AND source_name = 'custom_events'",
    )
    .bind(site_id)
    .fetch_optional(pool)
    .await
    .map(Option::flatten)
}

pub(crate) async fn custom_event_freshness(
    pool: &PgPool,
    site_id: &str,
) -> Result<String, sqlx::Error> {
    let pending = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM raw_events WHERE site_id = $1 AND event_type = 'custom_event' AND processed_at IS NULL)",
    ).bind(site_id).fetch_one(pool).await?;
    Ok(if pending { "stale" } else { "current" }.to_owned())
}

pub(crate) async fn active_generation(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
) -> Result<Option<ActiveGeneration>, sqlx::Error> {
    sqlx::query_as::<_, (String, i32)>(
        "SELECT generation_id::text, aggregation_version
         FROM analytics_generations
         WHERE site_id = $1 AND status = 'active'",
    )
    .bind(site_id)
    .fetch_optional(&mut **transaction)
    .await
    .map(|row| {
        row.map(|(generation_id, aggregation_version)| ActiveGeneration {
            generation_id,
            aggregation_version,
        })
    })
}

pub(crate) async fn visitor_session_counts(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    generation_id: &str,
    range: DateRange,
) -> Result<(i64, i64, i64), sqlx::Error> {
    let page_views = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT SUM(page_views)::bigint
         FROM page_view_daily
         WHERE site_id = $1 AND day BETWEEN $2 AND $3",
    )
    .bind(site_id)
    .bind(range.from)
    .bind(range.to)
    .fetch_one(&mut **transaction)
    .await?
    .unwrap_or(0);
    let unique_visitors = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT visitor_id)::bigint
         FROM visitor_event_facts
         WHERE site_id = $1 AND generation_id = $2::uuid
           AND day BETWEEN $3 AND $4",
    )
    .bind(site_id)
    .bind(generation_id)
    .bind(range.from)
    .bind(range.to)
    .fetch_one(&mut **transaction)
    .await?;
    let sessions = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT session_id)::bigint
         FROM session_events
         WHERE site_id = $1 AND generation_id = $2::uuid
           AND day BETWEEN $3 AND $4",
    )
    .bind(site_id)
    .bind(generation_id)
    .bind(range.from)
    .bind(range.to)
    .fetch_one(&mut **transaction)
    .await?;
    Ok((page_views, unique_visitors, sessions))
}

pub(crate) async fn visitor_session_daily(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    generation_id: &str,
    range: DateRange,
) -> Result<Vec<VisitorSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, VisitorSessionRow>(
        "WITH days AS (
             SELECT day FROM page_view_daily
             WHERE site_id = $1 AND day BETWEEN $2 AND $3
             UNION
             SELECT day FROM visitor_daily
             WHERE site_id = $1 AND generation_id = $4::uuid AND day BETWEEN $2 AND $3
             UNION
             SELECT day FROM session_daily
             WHERE site_id = $1 AND generation_id = $4::uuid AND day BETWEEN $2 AND $3
         )
         SELECT days.day,
                COALESCE((SELECT page_views FROM page_view_daily p
                          WHERE p.site_id = $1 AND p.day = days.day), 0)::bigint AS page_views,
                COALESCE((SELECT unique_visitors FROM visitor_daily v
                          WHERE v.site_id = $1 AND v.generation_id = $4::uuid AND v.day = days.day), 0)::bigint AS unique_visitors,
                COALESCE((SELECT sessions FROM session_daily s
                          WHERE s.site_id = $1 AND s.generation_id = $4::uuid AND s.day = days.day), 0)::bigint AS sessions
         FROM days
         ORDER BY days.day ASC",
    )
    .bind(site_id)
    .bind(range.from)
    .bind(range.to)
    .bind(generation_id)
    .fetch_all(&mut **transaction)
    .await
}

pub(crate) async fn dimension_rows(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    generation_id: &str,
    dimension: &str,
    range: DateRange,
    limit: i64,
) -> Result<Vec<DimensionRow>, sqlx::Error> {
    sqlx::query_as::<_, DimensionRow>(
        "SELECT value,
                COUNT(*)::bigint AS page_views,
                COUNT(DISTINCT visitor_id)::bigint AS unique_visitors,
                COUNT(DISTINCT session_id)::bigint AS sessions
         FROM dimension_event_facts
         WHERE site_id = $1 AND generation_id = $2::uuid
           AND dimension = $3 AND day BETWEEN $4 AND $5
         GROUP BY value
         ORDER BY page_views DESC, value ASC
         LIMIT $6",
    )
    .bind(site_id)
    .bind(generation_id)
    .bind(dimension)
    .bind(range.from)
    .bind(range.to)
    .bind(limit)
    .fetch_all(&mut **transaction)
    .await
}

pub(crate) async fn watermarks(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    generation_id: &str,
    generation_source: &str,
) -> Result<Vec<WatermarkRow>, sqlx::Error> {
    sqlx::query_as::<_, WatermarkRow>(
        "SELECT source_name, processed_received_watermark
         FROM analytics_watermarks
         WHERE site_id = $1
           AND ((generation_id IS NULL AND source_name = 'page_views')
             OR (generation_id = $2::uuid AND source_name = $3))",
    )
    .bind(site_id)
    .bind(generation_id)
    .bind(generation_source)
    .fetch_all(&mut **transaction)
    .await
}

pub(crate) async fn freshness_status(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    generation_id: &str,
    generation_source: &str,
) -> Result<String, sqlx::Error> {
    if let Some(status) = rebuild_freshness_status(transaction, site_id).await? {
        return Ok(status);
    }

    let watermarks = watermarks(transaction, site_id, generation_id, generation_source).await?;
    let page_views = watermarks
        .iter()
        .find(|row| row.source_name == "page_views")
        .and_then(|row| row.processed_received_watermark);
    let generation = watermarks
        .iter()
        .find(|row| row.source_name == generation_source)
        .and_then(|row| row.processed_received_watermark);
    if let (Some(page_views), Some(generation)) = (page_views, generation)
        && generation < page_views
    {
        return Ok("stale".to_owned());
    }
    Ok("current".to_owned())
}

pub(crate) async fn freshness_status_without_generation(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
) -> Result<String, sqlx::Error> {
    Ok(rebuild_freshness_status(transaction, site_id)
        .await?
        .unwrap_or_else(|| "current".to_owned()))
}

async fn rebuild_freshness_status(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    let has_rebuilding_queue = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM analytics_rebuild_queue
             WHERE site_id = $1 AND status IN ('pending', 'running')
         )",
    )
    .bind(site_id)
    .fetch_one(&mut **transaction)
    .await?;
    let has_building_generation = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM analytics_generations
             WHERE site_id = $1 AND status = 'building'
         )",
    )
    .bind(site_id)
    .fetch_one(&mut **transaction)
    .await?;
    if has_rebuilding_queue || has_building_generation {
        return Ok(Some("rebuilding".to_owned()));
    }

    let has_failed_queue = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM analytics_rebuild_queue
             WHERE site_id = $1 AND status = 'failed'
               AND updated_at > COALESCE(
                   (SELECT activated_at FROM analytics_generations
                    WHERE site_id = $1 AND status = 'active'),
                   '-infinity'::timestamptz
               )
         )",
    )
    .bind(site_id)
    .fetch_one(&mut **transaction)
    .await?;
    if has_failed_queue {
        return Ok(Some("failed".to_owned()));
    }

    let has_failed_generation = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM analytics_generations
             WHERE site_id = $1 AND status = 'failed'
               AND created_at > COALESCE(
                   (SELECT activated_at FROM analytics_generations
                    WHERE site_id = $1 AND status = 'active'),
                   '-infinity'::timestamptz
               )
         )",
    )
    .bind(site_id)
    .fetch_one(&mut **transaction)
    .await?;
    if has_failed_generation {
        return Ok(Some("failed".to_owned()));
    }
    Ok(None)
}

pub(crate) async fn web_vital_rows(
    pool: &PgPool,
    site_id: &str,
    range: DateRange,
    path: Option<&str>,
    limit: i64,
) -> Result<Vec<WebVitalReportRow>, sqlx::Error> {
    sqlx::query_as::<_,WebVitalReportRow>("SELECT path,metric,COUNT(*)::bigint AS count,CASE WHEN COUNT(*)>=4 THEN percentile_disc(0.75) WITHIN GROUP (ORDER BY value) END AS p75,COUNT(*) FILTER(WHERE rating='good')::bigint AS good_count,COUNT(*) FILTER(WHERE rating='needs_improvement')::bigint AS needs_improvement_count,COUNT(*) FILTER(WHERE rating='poor')::bigint AS poor_count FROM web_vital_facts WHERE site_id=$1 AND page_view_occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC') AND page_view_occurred_at < (($3::date+INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC') AND ($4::text IS NULL OR path=$4) GROUP BY path,metric ORDER BY path,metric LIMIT $5").bind(site_id).bind(range.from).bind(range.to).bind(path).bind(limit).fetch_all(pool).await
}
pub(crate) async fn web_vital_total(
    pool: &PgPool,
    site_id: &str,
    range: DateRange,
    path: Option<&str>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*)::bigint FROM web_vital_facts WHERE site_id=$1 AND page_view_occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC') AND page_view_occurred_at < (($3::date+INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC') AND ($4::text IS NULL OR path=$4)")
        .bind(site_id)
        .bind(range.from)
        .bind(range.to)
        .bind(path)
        .fetch_one(pool)
        .await
}

pub(crate) async fn web_vital_watermark(
    pool: &PgPool,
    site_id: &str,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, sqlx::Error> {
    sqlx::query_scalar::<_,Option<chrono::DateTime<chrono::Utc>>>("SELECT processed_received_watermark FROM analytics_watermarks WHERE site_id=$1 AND generation_id IS NULL AND source_name='web_vitals'").bind(site_id).fetch_optional(pool).await.map(Option::flatten)
}
pub(crate) async fn web_vital_freshness(
    pool: &PgPool,
    site_id: &str,
) -> Result<String, sqlx::Error> {
    let pending=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM raw_events WHERE site_id=$1 AND event_type='web_vital' AND processed_at IS NULL)").bind(site_id).fetch_one(pool).await?;
    Ok(if pending { "stale" } else { "current" }.to_owned())
}

pub(crate) async fn conversion_rows(
    pool: &PgPool,
    site_id: &str,
    version: &str,
    range: DateRange,
    definition_id: Option<&str>,
    limit: i64,
) -> Result<Vec<crate::analytics::models::ConversionReportRow>, sqlx::Error> {
    sqlx::query_as::<_, crate::analytics::models::ConversionReportRow>("WITH eligible AS (SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day, COUNT(DISTINCT session_id)::bigint AS sessions FROM custom_event_facts WHERE site_id=$1 AND session_id IS NOT NULL AND (occurred_at AT TIME ZONE 'UTC')::date BETWEEN $4 AND $5 GROUP BY 1), matched AS (SELECT definition_id,(occurred_at AT TIME ZONE 'UTC')::date AS day,COUNT(*)::bigint AS event_count,COUNT(DISTINCT session_id)::bigint AS converted_sessions FROM conversion_facts WHERE site_id=$1 AND definition_version=$2 AND (occurred_at AT TIME ZONE 'UTC')::date BETWEEN $4 AND $5 AND ($3::text IS NULL OR definition_id=$3) GROUP BY 1,2) SELECT m.definition_id,m.day,m.event_count,m.converted_sessions,COALESCE(e.sessions,0)::bigint AS eligible_sessions FROM matched m LEFT JOIN eligible e USING(day) ORDER BY m.definition_id,m.day LIMIT $6")
        .bind(site_id).bind(version).bind(definition_id).bind(range.from).bind(range.to).bind(limit).fetch_all(pool).await
}

pub(crate) async fn conversion_total(
    pool: &PgPool,
    site_id: &str,
    version: &str,
    range: DateRange,
    definition_id: Option<&str>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*)::bigint FROM conversion_facts WHERE site_id=$1 AND definition_version=$2 AND (occurred_at AT TIME ZONE 'UTC')::date BETWEEN $3 AND $4 AND ($5::text IS NULL OR definition_id=$5)")
        .bind(site_id).bind(version).bind(range.from).bind(range.to).bind(definition_id).fetch_one(pool).await
}

pub(crate) async fn funnel_rows(
    pool: &PgPool,
    site_id: &str,
    version: &str,
    range: DateRange,
    definition_id: Option<&str>,
    limit: i64,
) -> Result<Vec<crate::analytics::models::FunnelReportRow>, sqlx::Error> {
    sqlx::query_as::<_, crate::analytics::models::FunnelReportRow>("WITH counts AS (SELECT definition_id,cohort_day AS day,step_index,COUNT(DISTINCT session_id)::bigint AS sessions FROM funnel_step_facts WHERE site_id=$1 AND definition_version=$2 AND cohort_day BETWEEN $3 AND $4 AND ($5::text IS NULL OR definition_id=$5) GROUP BY definition_id,cohort_day,step_index) SELECT definition_id,day,step_index,sessions,LAG(sessions,1,sessions) OVER(PARTITION BY definition_id,day ORDER BY step_index)::bigint AS previous_step_sessions FROM counts ORDER BY definition_id,day,step_index LIMIT $6")
        .bind(site_id).bind(version).bind(range.from).bind(range.to).bind(definition_id).bind(limit).fetch_all(pool).await
}

pub(crate) async fn funnel_total(
    pool: &PgPool,
    site_id: &str,
    version: &str,
    range: DateRange,
    definition_id: Option<&str>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(DISTINCT (definition_id,session_id))::bigint FROM funnel_step_facts WHERE site_id=$1 AND definition_version=$2 AND step_index=0 AND cohort_day BETWEEN $3 AND $4 AND ($5::text IS NULL OR definition_id=$5)")
        .bind(site_id).bind(version).bind(range.from).bind(range.to).bind(definition_id).fetch_one(pool).await
}

pub(crate) async fn definition_revision_watermark(
    pool: &PgPool,
    site_id: &str,
    source: &str,
    definition_version: &str,
) -> Result<Option<chrono::DateTime<chrono::Utc>>, sqlx::Error> {
    sqlx::query_scalar("SELECT processed_received_watermark FROM definition_revision_watermarks WHERE site_id=$1 AND source_name=$2 AND definition_version=$3")
        .bind(site_id).bind(source).bind(definition_version).fetch_optional(pool).await
}

pub(crate) async fn definition_freshness(
    pool: &PgPool,
    site_id: &str,
    source: &str,
    definition_version: &str,
) -> Result<String, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    if let Some(status) = rebuild_freshness_status(&mut transaction, site_id).await? {
        transaction.rollback().await?;
        return Ok(status);
    }

    let revision_exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$2)")
        .bind(site_id).bind(definition_version).fetch_one(&mut *transaction).await?;
    if revision_exists {
        let pending = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM raw_events r WHERE r.site_id=$1 AND r.event_type='custom_event' AND r.processed_at IS NULL AND r.received_at >= COALESCE((SELECT effective_at FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$2),'-infinity'::timestamptz) AND r.received_at < COALESCE((SELECT MIN(next.effective_at) FROM site_definition_revisions current JOIN site_definition_revisions next ON next.site_id=current.site_id AND next.revision>current.revision WHERE current.site_id=$1 AND current.definition_version=$2),'infinity'::timestamptz))")
            .bind(site_id).bind(definition_version).fetch_one(&mut *transaction).await?;
        let has_processed = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM raw_events r WHERE r.site_id=$1 AND r.event_type='custom_event' AND r.processed_at IS NOT NULL AND r.received_at >= COALESCE((SELECT effective_at FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$2),'-infinity'::timestamptz) AND r.received_at < COALESCE((SELECT MIN(next.effective_at) FROM site_definition_revisions current JOIN site_definition_revisions next ON next.site_id=current.site_id AND next.revision>current.revision WHERE current.site_id=$1 AND current.definition_version=$2),'infinity'::timestamptz))")
            .bind(site_id).bind(definition_version).fetch_one(&mut *transaction).await?;
        let watermark_exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM definition_revision_watermarks WHERE site_id=$1 AND definition_version=$2 AND source_name=$3)")
            .bind(site_id).bind(definition_version).bind(source).fetch_one(&mut *transaction).await?;
        transaction.rollback().await?;
        return Ok(if pending || (has_processed && !watermark_exists) {
            "stale".to_owned()
        } else {
            "current".to_owned()
        });
    }

    let pending_custom_events = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM raw_events
             WHERE site_id = $1 AND event_type = 'custom_event' AND processed_at IS NULL
         )",
    )
    .bind(site_id)
    .fetch_one(&mut *transaction)
    .await?;
    if pending_custom_events {
        transaction.rollback().await?;
        return Ok("stale".to_owned());
    }

    let processed_custom_events = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM raw_events
             WHERE site_id = $1 AND event_type = 'custom_event' AND processed_at IS NOT NULL
         )",
    )
    .bind(site_id)
    .fetch_one(&mut *transaction)
    .await?;
    if processed_custom_events {
        let definition_version_is_current = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(
                 SELECT 1 FROM analytics_watermarks
                 WHERE site_id = $1 AND generation_id IS NULL AND source_name = $2
                   AND definition_version = $3
             )",
        )
        .bind(site_id)
        .bind(source)
        .bind(definition_version)
        .fetch_one(&mut *transaction)
        .await?;
        if !definition_version_is_current {
            transaction.rollback().await?;
            return Ok("stale".to_owned());
        }
    }

    let derived_facts_behind_generation = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1
             FROM analytics_generations g
             JOIN analytics_watermarks w
               ON w.site_id = g.site_id AND w.generation_id IS NULL AND w.source_name = $2
             WHERE g.site_id = $1 AND g.status = 'active'
               AND EXISTS (
                   SELECT 1 FROM raw_events r
                   WHERE r.site_id = g.site_id AND r.event_type = 'custom_event'
                     AND r.processed_at IS NOT NULL
               )
               AND g.activated_at > w.updated_at
         )",
    )
    .bind(site_id)
    .bind(source)
    .fetch_one(&mut *transaction)
    .await?;
    transaction.rollback().await?;
    Ok(if derived_facts_behind_generation {
        "rebuilding".to_owned()
    } else {
        "current".to_owned()
    })
}

pub(crate) async fn geo_country_providers(
    pool: &PgPool,
    site_id: &str,
    range: DateRange,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT m.provider
         FROM geo_country_facts f
         JOIN geo_event_metadata m
           ON m.raw_event_id=f.raw_event_id AND m.site_id=f.site_id
         WHERE f.site_id=$1
           AND f.occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND f.occurred_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
         ORDER BY m.provider",
    )
    .bind(site_id)
    .bind(range.from)
    .bind(range.to)
    .fetch_all(pool)
    .await
}

pub(crate) async fn geo_country_rows(
    pool: &PgPool,
    site_id: &str,
    range: DateRange,
) -> Result<Vec<GeoCountryRow>, sqlx::Error> {
    sqlx::query_as::<_, GeoCountryRow>(
        "SELECT country_code, COUNT(*)::bigint AS page_views
         FROM geo_country_facts
         WHERE site_id=$1
           AND occurred_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND occurred_at < (($3::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
         GROUP BY country_code
         ORDER BY page_views DESC, country_code ASC",
    )
    .bind(site_id)
    .bind(range.from)
    .bind(range.to)
    .fetch_all(pool)
    .await
}
