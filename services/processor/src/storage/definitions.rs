//! PostgreSQL persistence for analytics definition revisions.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, Postgres, Transaction};

pub(crate) async fn site_has_definition_revisions(
    connection: &mut PgConnection,
    site_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM site_definition_revisions WHERE site_id=$1)",
    )
    .bind(site_id)
    .fetch_one(&mut *connection)
    .await
}

pub(crate) async fn insert_initial_definition_revision(
    connection: &mut PgConnection,
    site_id: &str,
    version: &str,
    document: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO site_definition_revisions(site_id,revision,definition_version,effective_at,created_at,document) VALUES($1,1,$2,NULL,NOW(),$3)")
        .bind(site_id)
        .bind(version)
        .bind(document)
        .execute(&mut *connection)
        .await?;
    sqlx::query("INSERT INTO configuration_audit(actor_kind,resource,version,operation,changed_fields,created_at,expires_at) VALUES('deployment_admin',$1,1,'created',ARRAY['definitions.conversions','definitions.funnels'],NOW(),NOW()+INTERVAL '1 year')")
        .bind(serde_json::json!({"kind":"conversion_funnel_definitions","site_id":site_id}))
        .execute(&mut *connection)
        .await?;
    Ok(())
}

pub(crate) async fn load_definition_revision(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    received_at: DateTime<Utc>,
) -> Result<Option<(i64, String, Value)>, sqlx::Error> {
    sqlx::query_as::<_, (i64, String, Value)>("SELECT revision, definition_version, document FROM site_definition_revisions WHERE site_id=$1 AND (effective_at IS NULL OR effective_at <= $2) ORDER BY effective_at DESC NULLS LAST, revision DESC LIMIT 1")
        .bind(site_id)
        .bind(received_at)
        .fetch_optional(&mut **transaction)
        .await
}
