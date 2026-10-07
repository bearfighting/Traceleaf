//! PostgreSQL reads and writes for generation-scoped facts and aggregates.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{PgConnection, PgPool};

use crate::domain::{models::RawEvent, normalizer::NormalizedContext};

pub(crate) async fn load_site_events(
    pool: &PgPool,
    site_id: &str,
) -> Result<Vec<RawEvent>, sqlx::Error> {
    Ok(sqlx::query_as::<
        _,
        (
            i64,
            String,
            DateTime<Utc>,
            DateTime<Utc>,
            String,
            Option<String>,
            Option<i32>,
            serde_json::Value,
        ),
    >(
        "SELECT id,event_id,occurred_at,received_at,COALESCE(path,''),visitor_id::text,context_schema_version,payload
         FROM raw_events WHERE site_id=$1 AND event_type='page_view' AND processed_at IS NOT NULL
         ORDER BY occurred_at,event_id",
    )
    .bind(site_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(
        |(
            id,
            event_id,
            occurred_at,
            received_at,
            path,
            visitor_id,
            context_schema_version,
            payload,
        )| RawEvent {
            id,
            event_id,
            site_id: site_id.to_owned(),
            occurred_at,
            received_at,
            path,
            visitor_id,
            context_schema_version,
            payload,
        },
    )
    .collect())
}

pub(crate) async fn continuous_watermark(
    pool: &PgPool,
    site_id: &str,
    max_received_at: DateTime<Utc>,
) -> Result<DateTime<Utc>, sqlx::Error> {
    let first_unprocessed = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT MIN(received_at) FROM raw_events
         WHERE site_id=$1 AND processed_at IS NULL AND received_at <= $2",
    )
    .bind(site_id)
    .bind(max_received_at)
    .fetch_one(pool)
    .await?;
    Ok(first_unprocessed.map_or(max_received_at, |gap| {
        gap - chrono::Duration::microseconds(1)
    }))
}

pub(crate) async fn refresh_rollups(
    connection: &mut PgConnection,
    generation_id: &str,
) -> Result<(), sqlx::Error> {
    for table in ["visitor_daily", "session_daily", "dimension_daily"] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DELETE FROM {table} WHERE generation_id=$1::uuid"
        )))
        .bind(generation_id)
        .execute(&mut *connection)
        .await?;
    }
    sqlx::query("INSERT INTO visitor_daily(generation_id,site_id,day,unique_visitors,page_views) SELECT generation_id,site_id,day,COUNT(DISTINCT visitor_id),COUNT(*) FROM visitor_event_facts WHERE generation_id=$1::uuid GROUP BY generation_id,site_id,day")
        .bind(generation_id).execute(&mut *connection).await?;
    sqlx::query("INSERT INTO session_daily(generation_id,site_id,day,sessions,page_views) SELECT generation_id,site_id,started_at::date,COUNT(*),SUM(page_views) FROM sessions WHERE generation_id=$1::uuid GROUP BY generation_id,site_id,started_at::date")
        .bind(generation_id).execute(&mut *connection).await?;
    sqlx::query("INSERT INTO dimension_daily(generation_id,site_id,day,dimension,value,page_views,unique_visitors,sessions) SELECT generation_id,site_id,day,dimension,value,COUNT(*),COUNT(DISTINCT visitor_id),COUNT(DISTINCT session_id) FROM dimension_event_facts WHERE generation_id=$1::uuid GROUP BY generation_id,site_id,day,dimension,value")
        .bind(generation_id).execute(&mut *connection).await?;
    Ok(())
}

pub(crate) async fn insert_normalized_context(
    connection: &mut PgConnection,
    generation_id: &str,
    event: &RawEvent,
    context: &NormalizedContext,
    parser_version: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO normalized_event_context (generation_id,raw_event_id,site_id,context_schema_version,parser_version,language,timezone,viewport_width,viewport_height,screen_width,screen_height,utm_source,utm_medium,utm_campaign,utm_term,utm_content,referrer_host,device,browser,os) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)")
        .bind(generation_id).bind(event.id).bind(&event.site_id).bind(context.context_schema_version)
        .bind(parser_version).bind(&context.language).bind(&context.timezone)
        .bind(context.viewport_width).bind(context.viewport_height).bind(context.screen_width)
        .bind(context.screen_height).bind(&context.utm_source).bind(&context.utm_medium)
        .bind(&context.utm_campaign).bind(&context.utm_term).bind(&context.utm_content)
        .bind(&context.referrer_host).bind(&context.device).bind(&context.browser).bind(&context.os)
        .execute(&mut *connection).await?;
    Ok(())
}

pub(crate) async fn insert_visitor_event(
    connection: &mut PgConnection,
    generation_id: &str,
    event: &RawEvent,
    visitor_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO visitor_event_facts(generation_id,raw_event_id,site_id,visitor_id,occurred_at,day) VALUES($1::uuid,$2,$3,$4::uuid,$5,$6)")
        .bind(generation_id).bind(event.id).bind(&event.site_id).bind(visitor_id)
        .bind(event.occurred_at).bind(event.occurred_at.date_naive())
        .execute(&mut *connection).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_session(
    connection: &mut PgConnection,
    generation_id: &str,
    session_id: &str,
    site_id: &str,
    visitor_id: &str,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    page_views: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO sessions(generation_id,session_id,site_id,visitor_id,started_at,ended_at,page_views) VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7)")
        .bind(generation_id).bind(session_id).bind(site_id).bind(visitor_id)
        .bind(started_at).bind(ended_at).bind(page_views)
        .execute(&mut *connection).await?;
    Ok(())
}

pub(crate) async fn insert_session_event(
    connection: &mut PgConnection,
    generation_id: &str,
    event: &RawEvent,
    visitor_id: &str,
    session_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO session_events(generation_id,raw_event_id,site_id,visitor_id,session_id,occurred_at,day) VALUES($1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7)")
        .bind(generation_id).bind(event.id).bind(&event.site_id).bind(visitor_id)
        .bind(session_id).bind(event.occurred_at).bind(event.occurred_at.date_naive())
        .execute(&mut *connection).await?;
    Ok(())
}

pub(crate) async fn insert_visitor_daily(
    connection: &mut PgConnection,
    generation_id: &str,
    site_id: &str,
    day: NaiveDate,
    unique_visitors: i64,
    page_views: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO visitor_daily(generation_id,site_id,day,unique_visitors,page_views) VALUES($1::uuid,$2,$3,$4,$5)")
        .bind(generation_id).bind(site_id).bind(day).bind(unique_visitors).bind(page_views)
        .execute(&mut *connection).await?;
    Ok(())
}

pub(crate) async fn insert_session_daily(
    connection: &mut PgConnection,
    generation_id: &str,
    site_id: &str,
    day: NaiveDate,
    sessions: i64,
    page_views: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO session_daily(generation_id,site_id,day,sessions,page_views) VALUES($1::uuid,$2,$3,$4,$5)")
        .bind(generation_id).bind(site_id).bind(day).bind(sessions).bind(page_views)
        .execute(&mut *connection).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_dimension_event(
    connection: &mut PgConnection,
    generation_id: &str,
    event: &RawEvent,
    visitor_id: Option<&str>,
    session_id: Option<&str>,
    dimension: &str,
    value: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO dimension_event_facts(generation_id,raw_event_id,site_id,visitor_id,session_id,dimension,value,occurred_at,day) VALUES($1::uuid,$2,$3,$4::uuid,$5::uuid,$6,$7,$8,$9)")
        .bind(generation_id).bind(event.id).bind(&event.site_id).bind(visitor_id)
        .bind(session_id).bind(dimension).bind(value).bind(event.occurred_at)
        .bind(event.occurred_at.date_naive()).execute(&mut *connection).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_dimension_daily(
    connection: &mut PgConnection,
    generation_id: &str,
    site_id: &str,
    day: NaiveDate,
    dimension: &str,
    value: &str,
    page_views: i64,
    unique_visitors: i64,
    sessions: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO dimension_daily(generation_id,site_id,day,dimension,value,page_views,unique_visitors,sessions) VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8)")
        .bind(generation_id).bind(site_id).bind(day).bind(dimension).bind(value)
        .bind(page_views).bind(unique_visitors).bind(sessions)
        .execute(&mut *connection).await?;
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum DisabledFactTable {
    NormalizedContext,
    VisitorEvents,
    Sessions,
    SessionEvents,
    DimensionEvents,
}

pub(crate) async fn copy_disabled_facts(
    connection: &mut PgConnection,
    new_generation: &str,
    previous_generation: &str,
    table: DisabledFactTable,
    activation_cutoff: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    let statement = match table {
        DisabledFactTable::NormalizedContext => {
            "INSERT INTO normalized_event_context (generation_id,raw_event_id,site_id,context_schema_version,parser_version,language,timezone,viewport_width,viewport_height,screen_width,screen_height,utm_source,utm_medium,utm_campaign,utm_term,utm_content,referrer_host,device,browser,os) SELECT $1::uuid,c.raw_event_id,c.site_id,c.context_schema_version,c.parser_version,c.language,c.timezone,c.viewport_width,c.viewport_height,c.screen_width,c.screen_height,c.utm_source,c.utm_medium,c.utm_campaign,c.utm_term,c.utm_content,c.referrer_host,c.device,c.browser,c.os FROM normalized_event_context c JOIN raw_events r ON r.id=c.raw_event_id WHERE c.generation_id=$2::uuid AND ($3::timestamptz IS NULL OR r.received_at < $3)"
        }
        DisabledFactTable::VisitorEvents => {
            "INSERT INTO visitor_event_facts (generation_id,raw_event_id,site_id,visitor_id,occurred_at,day) SELECT $1::uuid,v.raw_event_id,v.site_id,v.visitor_id,v.occurred_at,v.day FROM visitor_event_facts v JOIN raw_events r ON r.id=v.raw_event_id WHERE v.generation_id=$2::uuid AND ($3::timestamptz IS NULL OR r.received_at < $3)"
        }
        DisabledFactTable::Sessions => {
            "INSERT INTO sessions (generation_id,session_id,site_id,visitor_id,started_at,ended_at,page_views) SELECT $1::uuid,s.session_id,s.site_id,s.visitor_id,s.started_at,s.ended_at,s.page_views FROM sessions s WHERE s.generation_id=$2::uuid AND ($3::timestamptz IS NULL OR EXISTS (SELECT 1 FROM session_events se JOIN raw_events r ON r.id=se.raw_event_id WHERE se.generation_id=s.generation_id AND se.session_id=s.session_id AND r.received_at < $3))"
        }
        DisabledFactTable::SessionEvents => {
            "INSERT INTO session_events (generation_id,raw_event_id,site_id,visitor_id,session_id,occurred_at,day) SELECT $1::uuid,se.raw_event_id,se.site_id,se.visitor_id,se.session_id,se.occurred_at,se.day FROM session_events se JOIN raw_events r ON r.id=se.raw_event_id WHERE se.generation_id=$2::uuid AND ($3::timestamptz IS NULL OR r.received_at < $3)"
        }
        DisabledFactTable::DimensionEvents => {
            "INSERT INTO dimension_event_facts (generation_id,raw_event_id,site_id,visitor_id,session_id,dimension,value,occurred_at,day) SELECT $1::uuid,d.raw_event_id,d.site_id,d.visitor_id,d.session_id,d.dimension,d.value,d.occurred_at,d.day FROM dimension_event_facts d JOIN raw_events r ON r.id=d.raw_event_id WHERE d.generation_id=$2::uuid AND ($3::timestamptz IS NULL OR r.received_at < $3)"
        }
    };
    sqlx::query(statement)
        .bind(new_generation)
        .bind(previous_generation)
        .bind(activation_cutoff)
        .execute(&mut *connection)
        .await?;
    Ok(())
}
