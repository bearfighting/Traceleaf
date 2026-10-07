//! Web vital fact writes and rebuilds.

use sqlx::PgConnection;

pub(crate) async fn has_linked_page_view(
    connection: &mut PgConnection,
    site_id: &str,
    page_view_event_id: &str,
    occurred_at_millis: i64,
    path: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM raw_events WHERE site_id=$1 AND event_id=$2 AND event_type='page_view' AND occurred_at=to_timestamp($3::double precision/1000) AND path=$4)")
        .bind(site_id)
        .bind(page_view_event_id)
        .bind(occurred_at_millis)
        .bind(path)
        .fetch_one(&mut *connection)
        .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn upsert_web_vital_fact(
    connection: &mut PgConnection,
    raw_event_id: i64,
    site_id: &str,
    page_view_event_id: &str,
    page_view_at_millis: i64,
    path: &str,
    metric: &str,
    value: f64,
    rating: &str,
    navigation_type: &str,
    report_sequence: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO web_vital_facts(raw_event_id,site_id,page_view_event_id,page_view_occurred_at,path,metric,value,rating,navigation_type,report_sequence) VALUES($1,$2,$3,to_timestamp($4::double precision/1000),$5,$6,$7,$8,$9,$10) ON CONFLICT(site_id,page_view_event_id,metric) DO UPDATE SET raw_event_id=EXCLUDED.raw_event_id,page_view_occurred_at=EXCLUDED.page_view_occurred_at,path=EXCLUDED.path,value=EXCLUDED.value,rating=EXCLUDED.rating,navigation_type=EXCLUDED.navigation_type,report_sequence=EXCLUDED.report_sequence WHERE EXCLUDED.report_sequence > web_vital_facts.report_sequence OR (EXCLUDED.report_sequence = web_vital_facts.report_sequence AND EXCLUDED.raw_event_id < web_vital_facts.raw_event_id)")
        .bind(raw_event_id)
        .bind(site_id)
        .bind(page_view_event_id)
        .bind(page_view_at_millis)
        .bind(path)
        .bind(metric)
        .bind(value)
        .bind(rating)
        .bind(navigation_type)
        .bind(report_sequence)
        .execute(&mut *connection)
        .await?;
    Ok(())
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
