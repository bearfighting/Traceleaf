use chrono::{DateTime, Utc};
use sqlx::PgPool;

use crate::analytics::definition_catalog::DefinitionRevision;

pub(crate) async fn list_revisions(
    pool: &PgPool,
    site_id: &str,
) -> Result<Vec<DefinitionRevision>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (i64, String, Option<DateTime<Utc>>)>(
        "SELECT revision, definition_version, effective_at FROM site_definition_revisions WHERE site_id = $1 ORDER BY revision DESC",
    )
    .bind(site_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(revision, definition_version, effective_at)| DefinitionRevision {
                revision,
                definition_version,
                effective_at,
            },
        )
        .collect())
}

pub(crate) async fn resolve_version(
    pool: &PgPool,
    site_id: &str,
    requested: Option<&str>,
    fallback: &str,
) -> Result<Option<String>, sqlx::Error> {
    if let Some(version) = requested {
        return sqlx::query_scalar::<_, String>(
            "SELECT definition_version FROM site_definition_revisions WHERE site_id=$1 AND definition_version=$2",
        )
        .bind(site_id)
        .bind(version)
        .fetch_optional(pool)
        .await;
    }
    Ok(Some(
        sqlx::query_scalar::<_, String>(
            "SELECT definition_version FROM site_definition_revisions WHERE site_id=$1 ORDER BY revision DESC LIMIT 1",
        )
        .bind(site_id)
        .fetch_optional(pool)
        .await?
        .unwrap_or_else(|| fallback.to_owned()),
    ))
}

pub(crate) async fn registry_site_without_capabilities(
    pool: &PgPool,
    site_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS (
            SELECT 1
              FROM site_registry AS site
             WHERE site.site_id = $1
               AND NOT EXISTS (
                    SELECT 1
                      FROM site_capability_configurations AS capabilities
                     WHERE capabilities.site_id = site.site_id
               )
        )",
    )
    .bind(site_id)
    .fetch_one(pool)
    .await
}
