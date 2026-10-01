use axum::{
    Json,
    extract::{Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header::ETAG},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};
use unicode_normalization::UnicodeNormalization;

use super::{
    auth::AdminAuth,
    errors::{ConfigurationApiError, ConfigurationValidationDetail},
    state::SiteManagementState,
};

#[derive(Clone, Debug, Serialize)]
struct Site {
    site_id: String,
    display_name: Option<String>,
    website_url: Option<String>,
    lifecycle_status: String,
    setup_status: String,
    missing_requirements: Vec<String>,
    version: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub(crate) struct Page {
    limit: Option<String>,
    cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MetadataPatch {
    display_name: Option<String>,
    website_url: Option<String>,
}

type DbSite = (
    String,
    Option<String>,
    Option<String>,
    String,
    i64,
    DateTime<Utc>,
    DateTime<Utc>,
    Option<bool>,
    Option<bool>,
);

const SELECT_SITE: &str = "SELECT s.site_id,s.display_name,s.website_url,s.lifecycle_status,s.version,s.created_at,s.updated_at, c.document #>> '{capabilities,page_views,enabled}' = 'true', EXISTS (SELECT 1 FROM site_environment_policies p WHERE p.site_id=s.site_id AND p.document->>'enabled'='true' AND jsonb_array_length(p.document->'allowed_origins')>0 AND jsonb_array_length(p.document->'ingest_keys')>0) AND NOT EXISTS (SELECT 1 FROM site_environment_policies p WHERE p.site_id=s.site_id AND p.document->>'enabled'='true' AND (COALESCE(jsonb_array_length(p.document->'allowed_origins'),0)=0 OR COALESCE(jsonb_array_length(p.document->'ingest_keys'),0)=0)) FROM site_registry s LEFT JOIN site_capability_configurations c USING(site_id)";

fn normalize_display_name(value: &str) -> String {
    value.trim().nfc().collect()
}

fn site(row: DbSite) -> Site {
    let (
        site_id,
        display_name,
        website_url,
        lifecycle_status,
        version,
        created_at,
        updated_at,
        page_views,
        ingestion,
    ) = row;
    let mut missing_requirements = Vec::new();
    if display_name.is_none() {
        missing_requirements.push("display_name".into());
    }
    if website_url.is_none() {
        missing_requirements.push("website_url".into());
    }
    if page_views != Some(true) {
        missing_requirements.push("page_views".into());
    }
    if ingestion != Some(true) {
        missing_requirements.push("environment_ingest_configuration".into());
    }
    let setup_status = if missing_requirements.is_empty() {
        "ready"
    } else {
        "needs_attention"
    }
    .into();
    Site {
        site_id,
        display_name,
        website_url,
        lifecycle_status,
        setup_status,
        missing_requirements,
        version,
        created_at,
        updated_at,
    }
}

fn response(status: StatusCode, body: Value, version: Option<i64>) -> Response {
    let mut out = (status, Json(body)).into_response();
    if let Some(version) = version {
        out.headers_mut().insert(
            ETAG,
            HeaderValue::from_str(&format!("\"{version}\"")).unwrap(),
        );
    }
    out
}

fn db_error(error: sqlx::Error) -> ConfigurationApiError {
    tracing::error!(%error, "site management database operation failed");
    ConfigurationApiError::Unavailable
}

pub(crate) async fn list_sites(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Query(page): Query<Page>,
) -> Result<Response, ConfigurationApiError> {
    let limit = match page.limit {
        None => 50,
        Some(value) => value
            .parse::<i64>()
            .ok()
            .filter(|n| (1..=100).contains(n))
            .ok_or_else(|| validation("/limit"))?,
    };
    let after = match page.cursor {
        None => None,
        Some(value) => {
            let decoded = URL_SAFE_NO_PAD
                .decode(&value)
                .ok()
                .filter(|bytes| URL_SAFE_NO_PAD.encode(bytes) == value);
            let text = decoded
                .and_then(|bytes| String::from_utf8(bytes).ok())
                .filter(|text| !text.is_empty());
            Some(text.ok_or_else(|| validation("/cursor"))?)
        }
    };
    let sql = format!(
        "{SELECT_SITE} WHERE ($1::text IS NULL OR s.site_id > $1) ORDER BY s.site_id LIMIT $2"
    );
    let rows = sqlx::query_as::<_, DbSite>(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(after)
        .bind(limit + 1)
        .fetch_all(&state.pool)
        .await
        .map_err(db_error)?;
    let has_more = rows.len() > limit as usize;
    let items = rows
        .into_iter()
        .take(limit as usize)
        .map(site)
        .collect::<Vec<_>>();
    let next_cursor = if has_more {
        items
            .last()
            .map(|s| URL_SAFE_NO_PAD.encode(s.site_id.as_bytes()))
    } else {
        None
    };
    Ok(response(
        StatusCode::OK,
        json!({"items":items,"next_cursor":next_cursor}),
        None,
    ))
}

pub(crate) async fn get_site(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
) -> Result<Response, ConfigurationApiError> {
    let sql = format!("{SELECT_SITE} WHERE s.site_id=$1");
    let row = sqlx::query_as::<_, DbSite>(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(site_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(db_error)?
        .ok_or(ConfigurationApiError::NotFound)?;
    let value = site(row);
    Ok(response(
        StatusCode::OK,
        json!({"site":value}),
        Some(value.version),
    ))
}

pub(crate) async fn patch_site(
    _auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
    body: Result<Json<MetadataPatch>, JsonRejection>,
) -> Result<Response, ConfigurationApiError> {
    let expected = parse_if_match(&headers)?;
    let Json(patch) = body.map_err(|_| validation(""))?;
    if patch.display_name.is_none() && patch.website_url.is_none() {
        return Err(validation(""));
    }
    if let Some(name) = &patch.display_name {
        let normalized = normalize_display_name(name);
        if normalized.is_empty() || normalized.chars().count() > 120 {
            return Err(validation("/display_name"));
        }
    }
    if let Some(url) = &patch.website_url {
        let parsed = url::Url::parse(url).ok().filter(|u| {
            matches!(u.scheme(), "http" | "https")
                && u.host().is_some()
                && u.username().is_empty()
                && u.password().is_none()
        });
        if parsed.is_none() || url.len() > 2048 {
            return Err(validation("/website_url"));
        }
    }
    let mut tx = state.pool.begin().await.map_err(db_error)?;
    let row = sqlx::query_as::<_, DbSite>(sqlx::AssertSqlSafe(format!(
        "{SELECT_SITE} WHERE s.site_id=$1 FOR UPDATE OF s"
    )))
    .bind(&site_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?
    .ok_or(ConfigurationApiError::NotFound)?;
    let current = site(row);
    if expected != current.version {
        return Err(ConfigurationApiError::SiteVersionConflict);
    }
    let name = patch
        .display_name
        .map(|v| normalize_display_name(&v))
        .or(current.display_name.clone());
    let website = patch
        .website_url
        .map(|v| {
            let mut parsed = url::Url::parse(&v).expect("validated URL");
            parsed.set_fragment(None);
            parsed.to_string()
        })
        .or(current.website_url.clone());
    let mut changed = Vec::new();
    if name != current.display_name {
        changed.push("display_name");
    }
    if website != current.website_url {
        changed.push("website_url");
    }
    if !changed.is_empty() {
        sqlx::query("UPDATE site_registry SET display_name=$2, website_url=$3, version=version+1, updated_at=NOW() WHERE site_id=$1").bind(&site_id).bind(name).bind(website).execute(&mut *tx).await.map_err(db_error)?;
        audit(
            &mut tx,
            &site_id,
            current.version + 1,
            "metadata_updated",
            &changed,
        )
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    fetch_response(&state.pool, &site_id).await
}

pub(crate) async fn archive_site(
    auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    lifecycle(auth, state, site_id, headers, "archived").await
}
pub(crate) async fn restore_site(
    auth: AdminAuth,
    State(state): State<SiteManagementState>,
    Path(site_id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ConfigurationApiError> {
    lifecycle(auth, state, site_id, headers, "active").await
}

async fn lifecycle(
    _auth: AdminAuth,
    state: SiteManagementState,
    site_id: String,
    headers: HeaderMap,
    target: &str,
) -> Result<Response, ConfigurationApiError> {
    let expected = parse_if_match(&headers)?;
    let mut tx = state.pool.begin().await.map_err(db_error)?;
    let row = sqlx::query_as::<_, DbSite>(sqlx::AssertSqlSafe(format!(
        "{SELECT_SITE} WHERE s.site_id=$1 FOR UPDATE OF s"
    )))
    .bind(&site_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?
    .ok_or(ConfigurationApiError::NotFound)?;
    let current = site(row);
    if current.version != expected {
        return Err(ConfigurationApiError::SiteVersionConflict);
    }
    if current.lifecycle_status != target {
        sqlx::query("UPDATE site_registry SET lifecycle_status=$2,version=version+1,updated_at=NOW() WHERE site_id=$1").bind(&site_id).bind(target).execute(&mut *tx).await.map_err(db_error)?;
        audit(
            &mut tx,
            &site_id,
            current.version + 1,
            if target == "archived" {
                "archived"
            } else {
                "restored"
            },
            &["lifecycle_status"],
        )
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    fetch_response(&state.pool, &site_id).await
}

async fn fetch_response(pool: &PgPool, id: &str) -> Result<Response, ConfigurationApiError> {
    let sql = format!("{SELECT_SITE} WHERE s.site_id=$1");
    let value = site(
        sqlx::query_as::<_, DbSite>(sqlx::AssertSqlSafe(sql.as_str()))
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(db_error)?
            .ok_or(ConfigurationApiError::NotFound)?,
    );
    Ok(response(
        StatusCode::OK,
        json!({"site":value}),
        Some(value.version),
    ))
}

async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    site_id: &str,
    version: i64,
    operation: &str,
    changed: &[&str],
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO site_management_audit(site_id,actor_kind,site_version,operation,changed_fields,created_at) VALUES($1,'deployment_admin',$2,$3,$4,NOW())").bind(site_id).bind(version).bind(operation).bind(changed).execute(&mut **tx).await?;
    Ok(())
}

fn parse_if_match(headers: &HeaderMap) -> Result<i64, ConfigurationApiError> {
    let version_text = headers
        .get("if-match")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix('"')?.strip_suffix('"'))
        .filter(|value| {
            !value.is_empty()
                && !value.starts_with('0')
                && value.bytes().all(|byte| byte.is_ascii_digit())
        })
        .ok_or(ConfigurationApiError::PreconditionRequired)?;
    let value = version_text
        .parse::<i64>()
        .ok()
        .filter(|version| *version > 0)
        .ok_or(ConfigurationApiError::PreconditionRequired)?;
    Ok(value)
}

fn validation(path: &str) -> ConfigurationApiError {
    ConfigurationApiError::Validation(vec![ConfigurationValidationDetail {
        path: path.to_owned(),
        code: "invalid_value",
        message: "Value does not satisfy the Site Management contract.",
    }])
}

#[cfg(test)]
mod tests {
    use super::normalize_display_name;

    #[test]
    fn display_name_length_uses_trimmed_nfc_unicode_characters() {
        let composed = normalize_display_name("  e\u{301}  ");
        assert_eq!(composed, "é");
        assert_eq!(composed.chars().count(), 1);

        let long = normalize_display_name(&"界".repeat(121));
        assert_eq!(long.chars().count(), 121);
        assert!(long.chars().count() > 120);

        let multibyte_but_within_limit = normalize_display_name(&"界".repeat(120));
        assert_eq!(multibyte_but_within_limit.len(), 360);
        assert_eq!(multibyte_but_within_limit.chars().count(), 120);
    }
}
