//! Per-site transaction coordination.

use sqlx::PgConnection;

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
