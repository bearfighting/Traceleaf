use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};

use crate::{ProcessorError, processor::Processor, queries};

impl Processor {
    pub async fn import_definitions_if_empty(
        &self,
        definitions: &serde_json::Value,
    ) -> Result<u64, ProcessorError> {
        let validated: crate::definitions::AnalyticsDefinitions =
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
            queries::lock_site(&mut *tx, site_id).await?;
            let exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM site_definition_revisions WHERE site_id=$1)",
            )
            .bind(site_id)
            .fetch_one(&mut *tx)
            .await?;
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
            sqlx::query("INSERT INTO site_definition_revisions(site_id,revision,definition_version,effective_at,created_at,document) VALUES($1,1,$2,NULL,NOW(),$3)").bind(site_id).bind(version).bind(document).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO configuration_audit(actor_kind,resource,version,operation,changed_fields,created_at,expires_at) VALUES('deployment_admin',$1,1,'created',ARRAY['definitions.conversions','definitions.funnels'],NOW(),NOW()+INTERVAL '1 year')")
                .bind(serde_json::json!({"kind":"conversion_funnel_definitions","site_id":site_id}))
                .execute(&mut *tx).await?;
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
) -> Result<crate::definitions::AnalyticsDefinitions, ProcessorError> {
    let stored = sqlx::query_as::<_, (i64, String, serde_json::Value)>("SELECT revision, definition_version, document FROM site_definition_revisions WHERE site_id=$1 AND (effective_at IS NULL OR effective_at <= $2) ORDER BY effective_at DESC NULLS LAST, revision DESC LIMIT 1")
        .bind(site_id).bind(received_at).fetch_optional(&mut **transaction).await?;
    let Some((row_revision, row_version, document)) = stored else {
        return Ok(crate::definitions::AnalyticsDefinitions {
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
    let definitions: crate::definitions::AnalyticsDefinitions = serde_json::from_value(
        serde_json::json!({"version":revision.definition_version,"sites":[site]}),
    )
    .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
    definitions
        .validate()
        .map_err(|error| ProcessorError::InvalidDefinitions(error.to_string()))?;
    Ok(definitions)
}
