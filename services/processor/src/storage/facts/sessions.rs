//! Active session lookup used when associating event facts.

use chrono::{DateTime, Utc};
use sqlx::PgConnection;

pub(crate) async fn find_active_session(
    connection: &mut PgConnection,
    site_id: &str,
    visitor_id: &str,
    occurred_at: DateTime<Utc>,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>("SELECT se.session_id::text FROM session_events se JOIN analytics_generations g ON g.generation_id=se.generation_id AND g.site_id=se.site_id AND g.status='active' WHERE se.site_id=$1 AND se.visitor_id=$2::uuid AND se.occurred_at <= $3 AND se.occurred_at > $3 - INTERVAL '30 minutes' AND (se.occurred_at AT TIME ZONE 'UTC')::date=($3 AT TIME ZONE 'UTC')::date ORDER BY se.occurred_at DESC LIMIT 1")
        .bind(site_id)
        .bind(visitor_id)
        .bind(occurred_at)
        .fetch_optional(&mut *connection)
        .await
}
