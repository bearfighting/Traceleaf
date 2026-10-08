use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};

use crate::application::site::{self, Site};

pub(crate) const SELECT_SITE: &str = "SELECT s.site_id,s.display_name,s.website_url,s.lifecycle_status,s.version,s.created_at,s.updated_at, c.document #>> '{capabilities,page_views,enabled}' = 'true', EXISTS (SELECT 1 FROM site_environment_policies p WHERE p.site_id=s.site_id AND p.document->>'enabled'='true' AND jsonb_array_length(p.document->'allowed_origins')>0 AND jsonb_array_length(p.document->'ingest_keys')>0) AND NOT EXISTS (SELECT 1 FROM site_environment_policies p WHERE p.site_id=s.site_id AND p.document->>'enabled'='true' AND (COALESCE(jsonb_array_length(p.document->'allowed_origins'),0)=0 OR COALESCE(jsonb_array_length(p.document->'ingest_keys'),0)=0)) FROM site_registry s LEFT JOIN site_capability_configurations c USING(site_id)";

pub(crate) async fn list_site_rows(
    pool: &PgPool,
    after: Option<String>,
    limit: i64,
) -> Result<Vec<site::DbSite>, sqlx::Error> {
    let sql = format!(
        "{SELECT_SITE} WHERE ($1::text IS NULL OR s.site_id > $1) ORDER BY s.site_id LIMIT $2"
    );
    sqlx::query_as::<_, site::DbSite>(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(after)
        .bind(limit)
        .fetch_all(pool)
        .await
}

pub(crate) async fn read_managed_site(
    pool: &PgPool,
    id: &str,
) -> Result<Option<Site>, sqlx::Error> {
    let sql = format!("{SELECT_SITE} WHERE s.site_id=$1");
    sqlx::query_as::<_, site::DbSite>(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(id)
        .fetch_optional(pool)
        .await
        .map(|row| row.map(site::from_database_row))
}

pub(crate) async fn read_managed_site_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    id: &str,
) -> Result<Site, sqlx::Error> {
    let sql = format!("{SELECT_SITE} WHERE s.site_id=$1");
    sqlx::query_as::<_, site::DbSite>(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(id)
        .fetch_optional(&mut **transaction)
        .await?
        .map(site::from_database_row)
        .ok_or(sqlx::Error::RowNotFound)
}

#[derive(Debug)]
pub(crate) enum SiteMutationError {
    Database(sqlx::Error),
    NotFound,
    VersionConflict,
}

pub(crate) async fn update_site_metadata(
    pool: &PgPool,
    site_id: &str,
    expected_version: i64,
    display_name: Option<String>,
    website_url: Option<String>,
    changed_fields: &[&str],
) -> Result<Site, SiteMutationError> {
    let mut transaction = pool.begin().await.map_err(SiteMutationError::Database)?;
    let sql = format!("{SELECT_SITE} WHERE s.site_id=$1 FOR UPDATE OF s");
    let row = sqlx::query_as::<_, site::DbSite>(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(site_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(SiteMutationError::Database)?
        .ok_or(SiteMutationError::NotFound)?;
    let current = site::from_database_row(row);
    if current.version != expected_version {
        return Err(SiteMutationError::VersionConflict);
    }
    if !changed_fields.is_empty() {
        sqlx::query("UPDATE site_registry SET display_name=$2,website_url=$3,version=version+1,updated_at=NOW() WHERE site_id=$1")
            .bind(site_id)
            .bind(display_name)
            .bind(website_url)
            .execute(&mut *transaction)
            .await
            .map_err(SiteMutationError::Database)?;
        insert_site_audit(
            &mut transaction,
            site_id,
            current.version + 1,
            "metadata_updated",
            changed_fields,
        )
        .await
        .map_err(SiteMutationError::Database)?;
    }
    let updated = read_managed_site_in_transaction(&mut transaction, site_id)
        .await
        .map_err(SiteMutationError::Database)?;
    transaction
        .commit()
        .await
        .map_err(SiteMutationError::Database)?;
    Ok(updated)
}

pub(crate) async fn update_site_lifecycle(
    pool: &PgPool,
    site_id: &str,
    expected_version: i64,
    target_status: &str,
) -> Result<Site, SiteMutationError> {
    let mut transaction = pool.begin().await.map_err(SiteMutationError::Database)?;
    let sql = format!("{SELECT_SITE} WHERE s.site_id=$1 FOR UPDATE OF s");
    let row = sqlx::query_as::<_, site::DbSite>(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(site_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(SiteMutationError::Database)?
        .ok_or(SiteMutationError::NotFound)?;
    let current = site::from_database_row(row);
    if current.version != expected_version {
        return Err(SiteMutationError::VersionConflict);
    }
    if current.lifecycle_status != target_status {
        sqlx::query("UPDATE site_registry SET lifecycle_status=$2,version=version+1,updated_at=NOW() WHERE site_id=$1")
            .bind(site_id)
            .bind(target_status)
            .execute(&mut *transaction)
            .await
            .map_err(SiteMutationError::Database)?;
        insert_site_audit(
            &mut transaction,
            site_id,
            current.version + 1,
            if target_status == "archived" {
                "archived"
            } else {
                "restored"
            },
            &["lifecycle_status"],
        )
        .await
        .map_err(SiteMutationError::Database)?;
    }
    let updated = read_managed_site_in_transaction(&mut transaction, site_id)
        .await
        .map_err(SiteMutationError::Database)?;
    transaction
        .commit()
        .await
        .map_err(SiteMutationError::Database)?;
    Ok(updated)
}

async fn insert_site_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    site_id: &str,
    version: i64,
    operation: &str,
    changed_fields: &[&str],
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO site_management_audit(site_id,actor_kind,site_version,operation,changed_fields,created_at) VALUES($1,'deployment_admin',$2,$3,$4,NOW())")
        .bind(site_id)
        .bind(version)
        .bind(operation)
        .bind(changed_fields)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

#[derive(Debug)]
pub(crate) enum CreateSiteStoreError {
    Database(sqlx::Error),
}

#[derive(Debug)]
pub(crate) enum CreateSiteOutcome {
    Created {
        site: Site,
    },
    Existing {
        site_id: String,
        request_digest: String,
    },
}

pub(crate) struct CreateSiteRecords<'a> {
    pub(crate) site_id: &'a str,
    pub(crate) display_name: &'a str,
    pub(crate) website_url: &'a str,
    pub(crate) environment: &'a str,
    pub(crate) idempotency_key: &'a str,
    pub(crate) request_digest: &'a str,
    pub(crate) key_id: &'a str,
    pub(crate) key_digest: &'a str,
    pub(crate) capabilities: &'a Value,
    pub(crate) allowed_origins: &'a Value,
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Micros, true)
}

fn map_database(error: sqlx::Error) -> CreateSiteStoreError {
    CreateSiteStoreError::Database(error)
}

pub(crate) async fn create_site(
    pool: &PgPool,
    records: CreateSiteRecords<'_>,
) -> Result<CreateSiteOutcome, CreateSiteStoreError> {
    let mut transaction = pool.begin().await.map_err(map_database)?;
    let now = sqlx::query_scalar::<_, DateTime<Utc>>("SELECT NOW()")
        .fetch_one(&mut *transaction)
        .await
        .map_err(map_database)?;
    let now_text = timestamp(now);

    sqlx::query(
        "INSERT INTO site_registry(site_id,display_name,website_url,lifecycle_status,created_at,updated_at,version)
         VALUES($1,$2,$3,'active',$4,$4,1)",
    )
    .bind(records.site_id)
    .bind(records.display_name)
    .bind(records.website_url)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .map_err(map_database)?;

    let capability_document = json!({
        "schema_version": 1,
        "site_id": records.site_id,
        "version": 1,
        "updated_at": now_text,
        "capabilities": records.capabilities,
        "consent_policy": "required",
        "privacy_constraints": ["no_ip_persistence", "no_fingerprinting", "consent_required"],
    });
    sqlx::query(
        "INSERT INTO site_capability_configurations(site_id,version,updated_at,document)
         VALUES($1,1,$2,$3)",
    )
    .bind(records.site_id)
    .bind(now)
    .bind(capability_document)
    .execute(&mut *transaction)
    .await
    .map_err(map_database)?;

    for (capability_id, capability) in records.capabilities.as_object().into_iter().flatten() {
        if capability["enabled"] == true {
            sqlx::query(
                "INSERT INTO site_capability_activation_windows(site_id,capability_id,enabled_since)
                 VALUES($1,$2,$3)",
            )
            .bind(records.site_id)
            .bind(capability_id)
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(map_database)?;
        }
    }

    let policy_document = json!({
        "schema_version": 1,
        "site_id": records.site_id,
        "environment": records.environment,
        "version": 1,
        "updated_at": now_text,
        "enabled": true,
        "allowed_origins": records.allowed_origins,
        "ingest_keys": [{
            "key_id": records.key_id,
            "sha256_digest": records.key_digest,
            "created_at": now_text,
        }],
        "rate_limit_per_minute": 600,
    });
    sqlx::query(
        "INSERT INTO site_environment_policies(site_id,environment,version,updated_at,document)
         VALUES($1,$2,1,$3,$4)",
    )
    .bind(records.site_id)
    .bind(records.environment)
    .bind(now)
    .bind(policy_document)
    .execute(&mut *transaction)
    .await
    .map_err(map_database)?;

    sqlx::query(
        "INSERT INTO site_management_audit(site_id,actor_kind,site_version,operation,changed_fields,created_at)
         VALUES($1,'deployment_admin',1,'created',ARRAY['display_name','website_url','lifecycle_status'], $2)",
    )
    .bind(records.site_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .map_err(map_database)?;

    let association = sqlx::query(
        "INSERT INTO site_creation_requests(idempotency_key,request_digest,site_id)
         VALUES($1,$2,$3) ON CONFLICT (idempotency_key) DO NOTHING",
    )
    .bind(records.idempotency_key)
    .bind(records.request_digest)
    .bind(records.site_id)
    .execute(&mut *transaction)
    .await
    .map_err(map_database)?;

    if association.rows_affected() == 0 {
        transaction.rollback().await.map_err(map_database)?;
        let existing = sqlx::query_as::<_, (String, String)>(
            "SELECT site_id,request_digest FROM site_creation_requests WHERE idempotency_key=$1",
        )
        .bind(records.idempotency_key)
        .fetch_one(pool)
        .await
        .map_err(map_database)?;
        return Ok(CreateSiteOutcome::Existing {
            site_id: existing.0,
            request_digest: existing.1.trim_end().to_owned(),
        });
    }

    // Prepare the creation response while the transaction is still open. If
    // this read fails, the insertions roll back and the caller can safely
    // retry without losing the one-time plaintext key.
    let site = read_managed_site_in_transaction(&mut transaction, records.site_id)
        .await
        .map_err(map_database)?;

    transaction.commit().await.map_err(map_database)?;
    Ok(CreateSiteOutcome::Created { site })
}
