use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};

use crate::{
    Processor, ProcessorError,
    storage::{definitions as definition_storage, queries},
};

impl Processor {
    pub async fn import_definitions_if_empty(
        &self,
        definitions: &serde_json::Value,
    ) -> Result<u64, ProcessorError> {
        let validated: crate::domain::definitions::AnalyticsDefinitions =
            serde_json::from_value(definitions.clone())
                .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
        validated
            .validate()
            .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
        let version = definitions
            .get("version")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| ProcessorError::InvalidDefinitions("missing version".to_owned()))?;
        let mut imported = 0;
        for site in definitions
            .get("sites")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
        {
            let site_id = site
                .get("site_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| ProcessorError::InvalidDefinitions("missing site_id".to_owned()))?;
            let mut tx = self.pool.begin().await?;
            queries::lock_site(&mut tx, site_id).await?;
            let exists =
                definition_storage::site_has_definition_revisions(&mut tx, site_id).await?;
            if exists {
                tx.rollback().await?;
                continue;
            }
            let mut conversions = site
                .get("conversions")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default();
            for conversion in &mut conversions {
                if conversion.get("active").is_none() {
                    conversion["active"] = serde_json::Value::Bool(true);
                }
            }
            let mut funnels = site
                .get("funnels")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default();
            for funnel in &mut funnels {
                if funnel.get("active").is_none() {
                    funnel["active"] = serde_json::Value::Bool(true);
                }
            }
            let document = serde_json::json!({"schema_version":1,"site_id":site_id,"revision":1,"definition_version":version,"updated_at":Utc::now(),"effective_at":null,"conversions":conversions,"funnels":funnels});
            definition_storage::insert_initial_definition_revision(
                &mut tx, site_id, version, document,
            )
            .await?;
            tx.commit().await?;
            imported += 1;
        }
        Ok(imported)
    }
}

pub(super) async fn load_definition_revision(
    transaction: &mut Transaction<'_, Postgres>,
    site_id: &str,
    received_at: DateTime<Utc>,
) -> Result<crate::domain::definitions::AnalyticsDefinitions, ProcessorError> {
    let stored =
        definition_storage::load_definition_revision(transaction, site_id, received_at).await?;
    let Some((row_revision, row_version, document)) = stored else {
        return Ok(crate::domain::definitions::AnalyticsDefinitions {
            version: "none".to_owned(),
            sites: Vec::new(),
        });
    };
    let revision = configuration_runtime::DefinitionRevisionView::parse(
        &document,
        site_id,
        Some(row_revision),
        Some(&row_version),
    )
    .map_err(ProcessorError::InvalidDefinitions)?;
    let site = serde_json::json!({"site_id":site_id,"conversions":revision.conversions,"funnels":revision.funnels});
    let definitions: crate::domain::definitions::AnalyticsDefinitions = serde_json::from_value(
        serde_json::json!({"version":revision.definition_version,"sites":[site]}),
    )
    .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
    definitions
        .validate()
        .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
    Ok(definitions)
}
