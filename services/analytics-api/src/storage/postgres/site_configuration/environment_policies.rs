use super::*;

pub(crate) async fn get_ingest_policy(
    pool: &PgPool,
    site_id: &str,
    environment: &str,
) -> Result<Option<ConfigurationRow>, StoreError> {
    sqlx::query_as::<_, (i64, Value)>(
        "SELECT version, document FROM site_environment_policies WHERE site_id = $1 AND environment = $2",
    )
    .bind(site_id)
    .bind(environment)
    .fetch_optional(pool)
    .await
    .map(|row| row.map(|(version, document)| ConfigurationRow { version, document }))
    .map_err(map_database_error)
}

pub(super) fn ingest_policy_document(
    site_id: &str,
    environment: &str,
    enabled: bool,
    allowed_origins: Value,
    rate_limit_per_minute: i64,
    now: DateTime<Utc>,
) -> Value {
    json!({
        "schema_version": 1,
        "site_id": site_id,
        "environment": environment,
        "version": 1,
        "updated_at": now.to_rfc3339_opts(SecondsFormat::Micros, true),
        "enabled": enabled,
        "allowed_origins": allowed_origins,
        "ingest_keys": [],
        "rate_limit_per_minute": rate_limit_per_minute,
    })
}

pub(crate) async fn create_ingest_policy(
    pool: &PgPool,
    site_id: &str,
    environment: &str,
    enabled: bool,
    allowed_origins: Value,
    rate_limit_per_minute: i64,
) -> Result<ConfigurationRow, StoreError> {
    let mut transaction = pool.begin().await.map_err(map_database_error)?;
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
    let now = sqlx::query_scalar::<_, DateTime<Utc>>("SELECT NOW()")
        .fetch_one(&mut *transaction)
        .await
        .map_err(map_database_error)?;
    let document = ingest_policy_document(
        site_id,
        environment,
        enabled,
        allowed_origins,
        rate_limit_per_minute,
        now,
    );
    sqlx::query(
        "INSERT INTO site_environment_policies (site_id, environment, version, updated_at, document)
         VALUES ($1, $2, 1, $3, $4)",
    )
    .bind(site_id)
    .bind(environment)
    .bind(now)
    .bind(document.clone())
    .execute(&mut *transaction)
    .await
    .map_err(map_database_error)?;
    write_audit(
        &mut transaction,
        json!({"kind":"environment_policy", "site_id":site_id, "environment":environment}),
        1,
        "created",
        vec![
            "environment.enabled".to_owned(),
            "environment.allowed_origins".to_owned(),
            "environment.rate_limit_per_minute".to_owned(),
        ],
    )
    .await?;
    transaction.commit().await.map_err(map_database_error)?;
    Ok(ConfigurationRow {
        version: 1,
        document,
    })
}

pub(crate) async fn update_ingest_policy(
    pool: &PgPool,
    site_id: &str,
    environment: &str,
    expected_version: i64,
    enabled: bool,
    allowed_origins: Value,
    rate_limit_per_minute: i64,
) -> Result<ConfigurationRow, StoreError> {
    let mut transaction = pool.begin().await.map_err(map_database_error)?;
    let row = sqlx::query_as::<_, (i64, Value)>(
        "SELECT version, document FROM site_environment_policies WHERE site_id = $1 AND environment = $2 FOR UPDATE",
    )
    .bind(site_id)
    .bind(environment)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_database_error)?
    .ok_or(StoreError::NotFound)?;
    let (version, mut document) = row;
    if version != expected_version {
        return Err(StoreError::Conflict);
    }
    let old_enabled = document["enabled"].as_bool();
    let old_origins = document["allowed_origins"].clone();
    let old_rate_limit = document["rate_limit_per_minute"].as_i64();
    let mut changed_fields = Vec::new();
    if old_enabled != Some(enabled) {
        changed_fields.push("environment.enabled".to_owned());
    }
    if old_origins != allowed_origins {
        changed_fields.push("environment.allowed_origins".to_owned());
    }
    if old_rate_limit != Some(rate_limit_per_minute) {
        changed_fields.push("environment.rate_limit_per_minute".to_owned());
    }
    let (next_version, updated_at) = next_version_and_time(&mut transaction, version).await?;
    document["enabled"] = json!(enabled);
    document["allowed_origins"] = allowed_origins;
    document["rate_limit_per_minute"] = json!(rate_limit_per_minute);
    set_version_and_time(&mut document, next_version, updated_at);
    sqlx::query(
        "UPDATE site_environment_policies SET version = $3, updated_at = $4, document = $5 WHERE site_id = $1 AND environment = $2",
    )
    .bind(site_id)
    .bind(environment)
    .bind(next_version)
    .bind(updated_at)
    .bind(document.clone())
    .execute(&mut *transaction)
    .await
    .map_err(map_database_error)?;
    write_audit(
        &mut transaction,
        json!({"kind":"environment_policy", "site_id":site_id, "environment":environment}),
        next_version,
        "updated",
        changed_fields,
    )
    .await?;
    transaction.commit().await.map_err(map_database_error)?;
    Ok(ConfigurationRow {
        version: next_version,
        document,
    })
}

pub(crate) async fn create_ingest_key(
    pool: &PgPool,
    site_id: &str,
    environment: &str,
    expected_version: i64,
    key_id: &str,
    digest: &str,
    created_at: DateTime<Utc>,
) -> Result<ConfigurationRow, StoreError> {
    let mut transaction = pool.begin().await.map_err(map_database_error)?;
    let row = sqlx::query_as::<_, (i64, Value)>(
        "SELECT version, document FROM site_environment_policies WHERE site_id = $1 AND environment = $2 FOR UPDATE",
    )
    .bind(site_id)
    .bind(environment)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_database_error)?
    .ok_or(StoreError::NotFound)?;
    let (version, mut document) = row;
    if version != expected_version {
        return Err(StoreError::Conflict);
    }
    if !append_ingest_key(&mut document, key_id, digest, created_at) {
        return Err(StoreError::Conflict);
    }
    let (next_version, updated_at) = next_version_and_time(&mut transaction, version).await?;
    set_version_and_time(&mut document, next_version, updated_at);
    sqlx::query(
        "UPDATE site_environment_policies SET version = $3, updated_at = $4, document = $5 WHERE site_id = $1 AND environment = $2",
    )
    .bind(site_id)
    .bind(environment)
    .bind(next_version)
    .bind(updated_at)
    .bind(document.clone())
    .execute(&mut *transaction)
    .await
    .map_err(map_database_error)?;
    write_audit(
        &mut transaction,
        json!({"kind":"ingest_key", "site_id":site_id, "environment":environment, "key_id":key_id}),
        next_version,
        "created",
        vec!["environment.ingest_keys".to_owned()],
    )
    .await?;
    transaction.commit().await.map_err(map_database_error)?;
    Ok(ConfigurationRow {
        version: next_version,
        document,
    })
}

pub(crate) async fn revoke_ingest_key(
    pool: &PgPool,
    site_id: &str,
    environment: &str,
    expected_version: i64,
    key_id: &str,
) -> Result<ConfigurationRow, StoreError> {
    let mut transaction = pool.begin().await.map_err(map_database_error)?;
    let row = sqlx::query_as::<_, (i64, Value)>(
        "SELECT version, document FROM site_environment_policies WHERE site_id = $1 AND environment = $2 FOR UPDATE",
    )
    .bind(site_id)
    .bind(environment)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_database_error)?
    .ok_or(StoreError::NotFound)?;
    let (version, mut document) = row;
    if version != expected_version {
        return Err(StoreError::Conflict);
    }
    let old_keys = document["ingest_keys"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let keys = old_keys
        .iter()
        .filter(|key| key["key_id"].as_str() != Some(key_id))
        .cloned()
        .collect::<Vec<_>>();
    if keys.len() == old_keys.len() {
        return Err(StoreError::NotFound);
    }
    let (next_version, updated_at) = next_version_and_time(&mut transaction, version).await?;
    document["ingest_keys"] = json!(keys);
    set_version_and_time(&mut document, next_version, updated_at);
    sqlx::query(
        "UPDATE site_environment_policies SET version = $3, updated_at = $4, document = $5 WHERE site_id = $1 AND environment = $2",
    )
    .bind(site_id)
    .bind(environment)
    .bind(next_version)
    .bind(updated_at)
    .bind(document.clone())
    .execute(&mut *transaction)
    .await
    .map_err(map_database_error)?;
    write_audit(
        &mut transaction,
        json!({"kind":"ingest_key", "site_id":site_id, "environment":environment, "key_id":key_id}),
        next_version,
        "revoked",
        vec!["environment.ingest_keys".to_owned()],
    )
    .await?;
    transaction.commit().await.map_err(map_database_error)?;
    Ok(ConfigurationRow {
        version: next_version,
        document,
    })
}
