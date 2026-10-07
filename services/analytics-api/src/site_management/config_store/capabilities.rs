use super::*;

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

pub(crate) async fn create_capabilities(
    pool: &PgPool,
    site_id: &str,
    capabilities: Value,
) -> Result<ConfigurationRow, StoreError> {
    let mut transaction = pool.begin().await.map_err(map_database_error)?;
    let site_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM site_registry WHERE site_id = $1)",
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
    let updated_at = now.to_rfc3339_opts(SecondsFormat::Micros, true);
    let document = json!({
        "schema_version": 1,
        "site_id": site_id,
        "version": 1,
        "updated_at": updated_at,
        "capabilities": capabilities,
        "consent_policy": "required",
        "privacy_constraints": ["no_ip_persistence", "no_fingerprinting", "consent_required"],
    });
    sqlx::query(
        "INSERT INTO site_capability_configurations (site_id, version, updated_at, document)
         VALUES ($1, 1, $2, $3)",
    )
    .bind(site_id)
    .bind(now)
    .bind(document.clone())
    .execute(&mut *transaction)
    .await
    .map_err(map_database_error)?;

    if let Some(values) = capabilities.as_object() {
        for (capability_id, value) in values {
            if value["enabled"] == true {
                sqlx::query(
                    "INSERT INTO site_capability_activation_windows (site_id, capability_id, enabled_since)
                     VALUES ($1, $2, '0001-01-01T00:00:00Z'::timestamptz)",
                )
                .bind(site_id)
                .bind(capability_id)
                .execute(&mut *transaction)
                .await
                .map_err(map_database_error)?;
            }
        }
    }

    write_audit(
        &mut transaction,
        json!({"kind":"site_capabilities", "site_id":site_id}),
        1,
        "created",
        vec!["capabilities".to_owned()],
    )
    .await?;
    transaction.commit().await.map_err(map_database_error)?;
    Ok(ConfigurationRow {
        version: 1,
        document,
    })
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
