//! Page view aggregate writes.

use chrono::NaiveDate;
use sqlx::PgConnection;

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
