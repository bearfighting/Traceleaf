//! Geo country fact writes and rebuilds.

use sqlx::PgConnection;

pub(crate) async fn insert_geo_country_fact(
    connection: &mut PgConnection,
    raw_event_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO geo_country_facts(raw_event_id,site_id,country_code,occurred_at)
         SELECT m.raw_event_id,m.site_id,m.country_code,r.occurred_at
         FROM geo_event_metadata m JOIN raw_events r ON r.id=m.raw_event_id
         WHERE m.raw_event_id=$1 AND r.event_type='page_view'
         ON CONFLICT(raw_event_id) DO UPDATE SET country_code=EXCLUDED.country_code,occurred_at=EXCLUDED.occurred_at",
    )
    .bind(raw_event_id)
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
