use super::*;

pub(crate) async fn get_current_definition_set(
    pool: &PgPool,
    site_id: &str,
) -> Result<Option<ConfigurationRow>, StoreError> {
    sqlx::query_as::<_, (i64, Value)>(
        "SELECT revision, document FROM site_definition_revisions WHERE site_id = $1 ORDER BY revision DESC LIMIT 1",
    )
    .bind(site_id)
    .fetch_optional(pool)
    .await
    .map(|row| row.map(|(version, document)| ConfigurationRow { version, document }))
    .map_err(map_database_error)
}

pub(crate) async fn create_definition_set(
    pool: &PgPool,
    site_id: &str,
    definition_version: Option<&str>,
    definitions: Value,
    effective_at: Option<DateTime<Utc>>,
) -> Result<ConfigurationRow, StoreError> {
    let mut transaction = pool.begin().await.map_err(map_database_error)?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('definition-revision:' || $1, 0))")
        .bind(site_id)
        .execute(&mut *transaction)
        .await
        .map_err(map_database_error)?;
    let site_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM site_capability_configurations WHERE site_id = $1)",
    )
    .bind(site_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(map_database_error)?;
    if !site_exists {
        return Err(StoreError::NotFound);
    }
    let existing = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM site_definition_revisions WHERE site_id = $1)",
    )
    .bind(site_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(map_database_error)?;
    if existing {
        return Err(StoreError::AlreadyExists);
    }
    let now = sqlx::query_scalar::<_, DateTime<Utc>>("SELECT clock_timestamp()")
        .fetch_one(&mut *transaction)
        .await
        .map_err(map_database_error)?;
    let definition_version = match definition_version {
        Some(version) => version.to_owned(),
        None => sqlx::query_scalar::<_, String>("SELECT 'r1-' || gen_random_uuid()::text")
            .fetch_one(&mut *transaction)
            .await
            .map_err(map_database_error)?,
    };
    let effective_at = effective_at.or(Some(now));
    let document = definition_document(
        site_id,
        1,
        &definition_version,
        now,
        effective_at,
        definitions,
    );
    insert_definition_revision(
        &mut transaction,
        site_id,
        1,
        &definition_version,
        effective_at,
        now,
        document.clone(),
    )
    .await?;
    write_definition_audit(&mut transaction, site_id, 1, "created").await?;
    transaction.commit().await.map_err(map_database_error)?;
    Ok(ConfigurationRow {
        version: 1,
        document,
    })
}

pub(crate) async fn update_definition_set(
    pool: &PgPool,
    site_id: &str,
    expected_revision: i64,
    definitions: Value,
) -> Result<ConfigurationRow, StoreError> {
    let mut transaction = pool.begin().await.map_err(map_database_error)?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('definition-revision:' || $1, 0))")
        .bind(site_id)
        .execute(&mut *transaction)
        .await
        .map_err(map_database_error)?;
    let (current_revision, previous_document) = sqlx::query_as::<_, (i64, Value)>(
        "SELECT revision, document FROM site_definition_revisions WHERE site_id = $1 ORDER BY revision DESC LIMIT 1",
    )
    .bind(site_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_database_error)?
    .ok_or(StoreError::NotFound)?;
    if current_revision != expected_revision {
        return Err(StoreError::Conflict);
    }
    ensure_definitions_retain_ids(&previous_document, &definitions)?;
    let next_revision = current_revision
        .checked_add(1)
        .ok_or(StoreError::Conflict)?;
    let now = sqlx::query_scalar::<_, DateTime<Utc>>("SELECT clock_timestamp()")
        .fetch_one(&mut *transaction)
        .await
        .map_err(map_database_error)?;
    let definition_version =
        sqlx::query_scalar::<_, String>("SELECT 'r' || $1::text || '-' || gen_random_uuid()::text")
            .bind(next_revision)
            .fetch_one(&mut *transaction)
            .await
            .map_err(map_database_error)?;
    let document = definition_document(
        site_id,
        next_revision,
        &definition_version,
        now,
        Some(now),
        definitions,
    );
    insert_definition_revision(
        &mut transaction,
        site_id,
        next_revision,
        &definition_version,
        Some(now),
        now,
        document.clone(),
    )
    .await?;
    write_definition_audit(&mut transaction, site_id, next_revision, "updated").await?;
    transaction.commit().await.map_err(map_database_error)?;
    Ok(ConfigurationRow {
        version: next_revision,
        document,
    })
}

pub(super) fn definition_document(
    site_id: &str,
    revision: i64,
    definition_version: &str,
    updated_at: DateTime<Utc>,
    effective_at: Option<DateTime<Utc>>,
    definitions: Value,
) -> Value {
    json!({
        "schema_version": 1,
        "site_id": site_id,
        "revision": revision,
        "definition_version": definition_version,
        "updated_at": updated_at.to_rfc3339_opts(SecondsFormat::Micros, true),
        "effective_at": effective_at.map(|time| time.to_rfc3339_opts(SecondsFormat::Micros, true)),
        "conversions": definitions["conversions"],
        "funnels": definitions["funnels"],
    })
}

pub(super) async fn insert_definition_revision(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    revision: i64,
    definition_version: &str,
    effective_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    document: Value,
) -> Result<(), StoreError> {
    sqlx::query(
        "INSERT INTO site_definition_revisions(site_id, revision, definition_version, effective_at, created_at, document) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(site_id)
    .bind(revision)
    .bind(definition_version)
    .bind(effective_at)
    .bind(created_at)
    .bind(document)
    .execute(&mut **transaction)
    .await
    .map_err(map_database_error)?;
    Ok(())
}

pub(super) fn ensure_definitions_retain_ids(
    previous: &Value,
    next: &Value,
) -> Result<(), StoreError> {
    for category in ["conversions", "funnels"] {
        let previous_ids = previous[category]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| item["id"].as_str());
        let next_ids = next[category]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| item["id"].as_str())
            .collect::<std::collections::HashSet<_>>();
        if previous_ids.into_iter().any(|id| !next_ids.contains(id)) {
            return Err(StoreError::DefinitionRemoval);
        }
    }
    Ok(())
}

pub(super) async fn write_definition_audit(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    revision: i64,
    operation: &'static str,
) -> Result<(), StoreError> {
    sqlx::query(
        "INSERT INTO configuration_audit(actor_kind, resource, version, operation, changed_fields, created_at, expires_at) VALUES ('deployment_admin', $1, $2, $3, ARRAY['definitions.conversions', 'definitions.funnels'], NOW(), NOW() + INTERVAL '1 year')",
    )
    .bind(json!({"kind":"conversion_funnel_definitions", "site_id":site_id}))
    .bind(revision)
    .bind(operation)
    .execute(&mut **transaction)
    .await
    .map_err(map_database_error)?;
    Ok(())
}
