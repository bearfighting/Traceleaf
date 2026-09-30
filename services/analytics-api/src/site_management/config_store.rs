use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};

#[derive(Debug, Clone)]
pub(crate) struct ConfigurationRow {
    pub(crate) version: i64,
    pub(crate) document: Value,
}

#[derive(Debug)]
pub(crate) enum StoreError {
    NotFound,
    Conflict,
    AlreadyExists,
    DefinitionRemoval,
    OriginConflict,
    Database(sqlx::Error),
}

fn map_database_error(error: sqlx::Error) -> StoreError {
    if let Some(database) = error.as_database_error()
        && database.code().as_deref() == Some("23505")
    {
        match database.constraint() {
            Some("site_environment_origin_unique") => return StoreError::OriginConflict,
            Some("site_environment_policies_pkey") => return StoreError::AlreadyExists,
            _ => {}
        }
    }
    StoreError::Database(error)
}

async fn write_audit(
    transaction: &mut Transaction<'_, Postgres>,
    resource: Value,
    version: i64,
    operation: &'static str,
    changed_fields: Vec<String>,
) -> Result<(), StoreError> {
    sqlx::query(
        "INSERT INTO configuration_audit
            (actor_kind, resource, version, operation, changed_fields, created_at, expires_at)
         VALUES ('deployment_admin', $1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 year')",
    )
    .bind(resource)
    .bind(version)
    .bind(operation)
    .bind(changed_fields)
    .execute(&mut **transaction)
    .await
    .map_err(map_database_error)?;
    Ok(())
}

fn set_version_and_time(document: &mut Value, version: i64, updated_at: DateTime<Utc>) {
    document["version"] = json!(version);
    document["updated_at"] = json!(updated_at.to_rfc3339_opts(SecondsFormat::Micros, true));
}

fn replace_capabilities(
    document: &mut Value,
    capabilities: Value,
    version: i64,
    updated_at: DateTime<Utc>,
) {
    document["capabilities"] = capabilities;
    set_version_and_time(document, version, updated_at);
}

fn append_ingest_key(
    document: &mut Value,
    key_id: &str,
    digest: &str,
    created_at: DateTime<Utc>,
) -> bool {
    let mut keys = document["ingest_keys"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if keys
        .iter()
        .any(|key| key["key_id"].as_str() == Some(key_id))
    {
        return false;
    }
    keys.push(json!({
        "key_id": key_id,
        "sha256_digest": digest,
        "created_at": created_at.to_rfc3339_opts(SecondsFormat::Micros, true),
    }));
    document["ingest_keys"] = json!(keys);
    true
}

async fn next_version_and_time(
    transaction: &mut Transaction<'_, Postgres>,
    current: i64,
) -> Result<(i64, DateTime<Utc>), StoreError> {
    let version = current.checked_add(1).ok_or(StoreError::Conflict)?;
    let updated_at = sqlx::query_scalar::<_, DateTime<Utc>>("SELECT NOW()")
        .fetch_one(&mut **transaction)
        .await
        .map_err(map_database_error)?;
    Ok((version, updated_at))
}

pub(crate) async fn get_capabilities(
    pool: &PgPool,
    site_id: &str,
) -> Result<Option<ConfigurationRow>, StoreError> {
    sqlx::query_as::<_, (i64, Value)>(
        "SELECT version, document FROM site_capability_configurations WHERE site_id = $1",
    )
    .bind(site_id)
    .fetch_optional(pool)
    .await
    .map(|row| row.map(|(version, document)| ConfigurationRow { version, document }))
    .map_err(map_database_error)
}

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

pub(crate) async fn update_capabilities(
    pool: &PgPool,
    site_id: &str,
    expected_version: i64,
    capabilities: Value,
) -> Result<ConfigurationRow, StoreError> {
    let mut transaction = pool.begin().await.map_err(map_database_error)?;
    let row = sqlx::query_as::<_, (i64, Value)>(
        "SELECT version, document FROM site_capability_configurations WHERE site_id = $1 FOR UPDATE",
    )
    .bind(site_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(map_database_error)?
    .ok_or(StoreError::NotFound)?;
    let (version, mut document) = row;
    let previous_capabilities = document["capabilities"].clone();
    if version != expected_version {
        return Err(StoreError::Conflict);
    }
    let (next_version, updated_at) = next_version_and_time(&mut transaction, version).await?;
    replace_capabilities(&mut document, capabilities, next_version, updated_at);
    sqlx::query(
        "UPDATE site_capability_configurations SET version = $2, updated_at = $3, document = $4 WHERE site_id = $1",
    )
    .bind(site_id)
    .bind(next_version)
    .bind(updated_at)
    .bind(document.clone())
    .execute(&mut *transaction)
    .await
    .map_err(map_database_error)?;
    for capability_id in [
        "page_views",
        "browser_context",
        "anonymous_visitors",
        "sessions",
        "dimensions",
        "custom_events",
        "web_vitals",
        "conversions",
        "funnels",
        "geo",
    ] {
        let was_enabled = previous_capabilities[capability_id]["enabled"].as_bool() == Some(true);
        let is_enabled = document["capabilities"][capability_id]["enabled"].as_bool() == Some(true);
        if was_enabled && !is_enabled {
            sqlx::query("DELETE FROM site_capability_activation_windows WHERE site_id=$1 AND capability_id=$2")
                .bind(site_id).bind(capability_id).execute(&mut *transaction).await.map_err(map_database_error)?;
        } else if !was_enabled && is_enabled {
            sqlx::query("INSERT INTO site_capability_activation_windows(site_id,capability_id,enabled_since) VALUES($1,$2,$3) ON CONFLICT(site_id,capability_id) DO UPDATE SET enabled_since=EXCLUDED.enabled_since")
                .bind(site_id).bind(capability_id).bind(updated_at).execute(&mut *transaction).await.map_err(map_database_error)?;
        }
    }
    write_audit(
        &mut transaction,
        json!({"kind":"site_capabilities", "site_id":site_id}),
        next_version,
        "updated",
        vec!["capabilities".to_owned()],
    )
    .await?;
    transaction.commit().await.map_err(map_database_error)?;
    Ok(ConfigurationRow {
        version: next_version,
        document,
    })
}

fn ingest_policy_document(
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AppliedCollectorState {
    pub(crate) status: &'static str,
    pub(crate) applied_version: Option<i64>,
}

pub(crate) async fn collector_applied_state(
    pool: &PgPool,
    site_id: &str,
    environment: &str,
    stored_version: i64,
) -> Result<AppliedCollectorState, StoreError> {
    let active = sqlx::query_as::<_, (String, String, Option<i64>, Option<String>)>(
        "SELECT instances.instance_id, instances.refresh_status, state.applied_version, state.refresh_status FROM configuration_runtime_instances AS instances LEFT JOIN configuration_runtime_state AS state ON state.instance_id = instances.instance_id AND state.service = 'collector' AND state.site_id = $1 AND state.environment = $2 WHERE instances.service = 'collector' AND instances.last_seen_at >= NOW() - INTERVAL '15 seconds'",
    )
    .bind(site_id)
    .bind(environment)
    .fetch_all(pool)
    .await
    .map_err(map_database_error)?;

    if !active.is_empty() {
        let stale = active.iter().any(|(_, instance_status, _, policy_status)| {
            instance_status == "stale" || policy_status.as_deref() == Some("stale")
        });
        let missing_version = active
            .iter()
            .any(|(_, _, version, policy_status)| version.is_none() || policy_status.is_none());
        let applied_version = active
            .iter()
            .filter_map(|(_, _, version, _)| *version)
            .min();

        if stale {
            return Ok(AppliedCollectorState {
                status: "stale",
                applied_version: if missing_version {
                    None
                } else {
                    applied_version
                },
            });
        }
        if missing_version {
            return Ok(AppliedCollectorState {
                status: "pending",
                applied_version: None,
            });
        }
        let status = if applied_version.is_some_and(|version| version >= stored_version) {
            "current"
        } else {
            "pending"
        };
        return Ok(AppliedCollectorState {
            status,
            applied_version,
        });
    }

    let history = sqlx::query_as::<_, (Option<i64>,)>(
        "SELECT applied_version FROM configuration_runtime_state WHERE service = 'collector' AND site_id = $1 AND environment = $2",
    )
    .bind(site_id)
    .bind(environment)
    .fetch_all(pool)
    .await
    .map_err(map_database_error)?;
    if history.is_empty() {
        return Ok(AppliedCollectorState {
            status: "pending",
            applied_version: None,
        });
    }
    let missing_version = history.iter().any(|(version,)| version.is_none());
    let applied_version = history.iter().filter_map(|(version,)| *version).min();
    Ok(AppliedCollectorState {
        status: "stale",
        applied_version: if missing_version {
            None
        } else {
            applied_version
        },
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AppliedCapabilityState {
    pub(crate) status: &'static str,
    pub(crate) applied_version: Option<i64>,
}

pub(crate) async fn capability_applied_state(
    pool: &PgPool,
    service: &str,
    site_id: &str,
    stored_version: i64,
) -> Result<AppliedCapabilityState, StoreError> {
    let active = sqlx::query_as::<_, (String, String, Option<i64>, Option<String>)>(
        "SELECT instances.instance_id, instances.refresh_status, state.applied_version, state.refresh_status
         FROM configuration_capability_runtime_instances AS instances
         LEFT JOIN configuration_capability_runtime_state AS state
           ON state.service = instances.service AND state.instance_id = instances.instance_id AND state.site_id = $2
         WHERE instances.service = $1 AND instances.last_seen_at >= NOW() - INTERVAL '15 seconds'",
    ).bind(service).bind(site_id).fetch_all(pool).await.map_err(map_database_error)?;

    if !active.is_empty() {
        let stale = active.iter().any(|(_, instance_status, _, report_status)| {
            instance_status == "stale" || report_status.as_deref() == Some("stale")
        });
        let missing = active
            .iter()
            .any(|(_, _, version, report_status)| version.is_none() || report_status.is_none());
        let applied_version = active
            .iter()
            .filter_map(|(_, _, version, _)| *version)
            .min();
        if stale {
            return Ok(AppliedCapabilityState {
                status: "stale",
                applied_version: if missing { None } else { applied_version },
            });
        }
        if missing {
            return Ok(AppliedCapabilityState {
                status: "pending",
                applied_version: None,
            });
        }
        return Ok(AppliedCapabilityState {
            status: if applied_version.is_some_and(|version| version >= stored_version) {
                "current"
            } else {
                "pending"
            },
            applied_version,
        });
    }

    let history = sqlx::query_as::<_, (Option<i64>,)>(
        "SELECT applied_version FROM configuration_capability_runtime_state WHERE service = $1 AND site_id = $2",
    ).bind(service).bind(site_id).fetch_all(pool).await.map_err(map_database_error)?;
    if history.is_empty() {
        return Ok(AppliedCapabilityState {
            status: "pending",
            applied_version: None,
        });
    }
    let missing = history.iter().any(|(version,)| version.is_none());
    Ok(AppliedCapabilityState {
        status: "stale",
        applied_version: if missing {
            None
        } else {
            history.iter().filter_map(|(version,)| *version).min()
        },
    })
}

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

fn definition_document(
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

async fn insert_definition_revision(
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

fn ensure_definitions_retain_ids(previous: &Value, next: &Value) -> Result<(), StoreError> {
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

async fn write_definition_audit(
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

#[cfg(test)]
mod serialization_schema_tests {
    use chrono::{TimeZone, Utc};
    use serde_json::Value;

    fn schema(name: &str) -> jsonschema::Validator {
        let text = match name {
            "environment-policy.schema.json" => include_str!(
                "../../../../protocol/contracts/configuration/current/environment-policy.schema.json"
            ),
            "capabilities.schema.json" => include_str!(
                "../../../../protocol/contracts/configuration/current/capabilities.schema.json"
            ),
            "conversion-funnel-definition-set-update.schema.json" => include_str!(
                "../../../../protocol/contracts/configuration/current/conversion-funnel-definition-set-update.schema.json"
            ),
            _ => unreachable!(),
        };
        let document: Value = serde_json::from_str(text).unwrap();
        jsonschema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .build(&document)
            .unwrap()
    }

    #[test]
    fn policy_and_capability_write_documents_serialize_to_their_stored_schemas() {
        let at = Utc.with_ymd_and_hms(2026, 9, 30, 12, 0, 0).unwrap();
        let policy: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/environment-policy/valid/production.json"
        )).unwrap();
        let mut policy = super::ingest_policy_document(
            policy["site_id"].as_str().unwrap(),
            policy["environment"].as_str().unwrap(),
            policy["enabled"].as_bool().unwrap(),
            policy["allowed_origins"].clone(),
            policy["rate_limit_per_minute"].as_i64().unwrap(),
            at,
        );
        assert!(super::append_ingest_key(
            &mut policy,
            "ik_12345678",
            &"a".repeat(64),
            at,
        ));
        super::set_version_and_time(&mut policy, 3, at);
        let policy_round_trip: Value =
            serde_json::from_str(&serde_json::to_string(&policy).unwrap()).unwrap();
        assert!(
            schema("environment-policy.schema.json")
                .validate(&policy_round_trip)
                .is_ok()
        );

        let mut capabilities: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/capabilities/valid/legacy-enabled.json"
        )).unwrap();
        let update: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/capability-update/valid/all-enabled.json"
        )).unwrap();
        super::replace_capabilities(&mut capabilities, update["capabilities"].clone(), 2, at);
        let round_trip: Value =
            serde_json::from_str(&serde_json::to_string(&capabilities).unwrap()).unwrap();
        assert!(
            schema("capabilities.schema.json")
                .validate(&round_trip)
                .is_ok()
        );
    }

    #[test]
    fn definition_revision_serialization_preserves_validated_contract_and_server_metadata() {
        let update: Value = serde_json::from_str(include_str!(
            "../../../../protocol/contracts/configuration/current/fixtures/conversion-funnel-definition-set-update/valid/definitions.json"
        )).unwrap();
        let update_schema = schema("conversion-funnel-definition-set-update.schema.json");
        assert!(update_schema.validate(&update).is_ok());
        let at = Utc.with_ymd_and_hms(2026, 9, 30, 12, 0, 0).unwrap();
        let stored =
            super::definition_document("site_example", 4, "revision-4", at, Some(at), update);
        let round_trip: Value =
            serde_json::from_str(&serde_json::to_string(&stored).unwrap()).unwrap();
        assert_eq!(round_trip["schema_version"], 1);
        assert_eq!(round_trip["site_id"], "site_example");
        assert_eq!(round_trip["revision"], 4);
        assert_eq!(round_trip["updated_at"], "2026-09-30T12:00:00.000000Z");
        assert!(
            update_schema
                .validate(&serde_json::json!({
                    "conversions": round_trip["conversions"],
                    "funnels": round_trip["funnels"]
                }))
                .is_ok()
        );
    }
}
