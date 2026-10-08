use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Site {
    pub(crate) site_id: String,
    pub(crate) display_name: Option<String>,
    pub(crate) website_url: Option<String>,
    pub(crate) lifecycle_status: String,
    pub(crate) setup_status: String,
    pub(crate) missing_requirements: Vec<String>,
    pub(crate) version: i64,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

pub(crate) type DbSite = (
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

pub(crate) fn from_database_row(row: DbSite) -> Site {
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
