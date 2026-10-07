//! PostgreSQL statements that replace derived facts from their source tables.

use sqlx::PgConnection;

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

pub(crate) async fn rebuild_geo_country_facts(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<u64, sqlx::Error> {
    sqlx::query("DELETE FROM geo_country_facts WHERE site_id=$1")
        .bind(site_id)
        .execute(&mut *connection)
        .await?;
    let result = sqlx::query(
        "INSERT INTO geo_country_facts(raw_event_id,site_id,country_code,occurred_at)
         SELECT m.raw_event_id,m.site_id,m.country_code,r.occurred_at
         FROM geo_event_metadata m JOIN raw_events r ON r.id=m.raw_event_id
         WHERE m.site_id=$1 AND r.event_type='page_view' AND r.processed_at IS NOT NULL
         ON CONFLICT(raw_event_id) DO UPDATE SET country_code=EXCLUDED.country_code,occurred_at=EXCLUDED.occurred_at",
    )
    .bind(site_id)
    .execute(&mut *connection)
    .await?;
    Ok(result.rows_affected())
}

pub(crate) async fn rebuild_web_vital_facts(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<u64, sqlx::Error> {
    sqlx::query("DELETE FROM web_vital_facts WHERE site_id=$1")
        .bind(site_id)
        .execute(&mut *connection)
        .await?;
    let result = sqlx::query("INSERT INTO web_vital_facts(raw_event_id,site_id,page_view_event_id,page_view_occurred_at,path,metric,value,rating,navigation_type,report_sequence) SELECT DISTINCT ON (w.site_id,w.payload->>'page_view_event_id',w.payload->>'metric') w.id,w.site_id,w.payload->>'page_view_event_id',to_timestamp((w.payload->>'page_view_occurred_at')::double precision/1000),w.payload->>'path',w.payload->>'metric',(w.payload->>'value')::double precision,w.payload->>'rating',w.payload->>'navigation_type',(w.payload->>'report_sequence')::bigint FROM raw_events w JOIN raw_events p ON p.site_id=w.site_id AND p.event_id=w.payload->>'page_view_event_id' AND p.event_type='page_view' AND p.path=w.payload->>'path' AND p.occurred_at=to_timestamp((w.payload->>'page_view_occurred_at')::double precision/1000) WHERE w.site_id=$1 AND w.event_type='web_vital' AND w.processed_at IS NOT NULL ORDER BY w.site_id,w.payload->>'page_view_event_id',w.payload->>'metric',(w.payload->>'report_sequence')::bigint DESC,w.id ASC ON CONFLICT(site_id,page_view_event_id,metric) DO UPDATE SET raw_event_id=EXCLUDED.raw_event_id,page_view_occurred_at=EXCLUDED.page_view_occurred_at,path=EXCLUDED.path,value=EXCLUDED.value,rating=EXCLUDED.rating,navigation_type=EXCLUDED.navigation_type,report_sequence=EXCLUDED.report_sequence WHERE EXCLUDED.report_sequence>web_vital_facts.report_sequence OR (EXCLUDED.report_sequence=web_vital_facts.report_sequence AND EXCLUDED.raw_event_id<web_vital_facts.raw_event_id)")
        .bind(site_id)
        .execute(&mut *connection)
        .await?;
    Ok(result.rows_affected())
}
