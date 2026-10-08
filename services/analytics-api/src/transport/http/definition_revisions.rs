use crate::analytics::state::AnalyticsState;
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug)]
pub(crate) enum DefinitionRevisionsError {
    InvalidSiteId,
    Unavailable,
}

impl IntoResponse for DefinitionRevisionsError {
    fn into_response(self) -> Response {
        match self {
            Self::InvalidSiteId => (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"error":{"code":"configuration_validation_failed","message":"Configuration failed validation.","details":[{"path":"/site_id","code":"invalid_identity","message":"Site ID must contain between 1 and 64 bytes."}]}}))).into_response(),
            Self::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error":{"code":"configuration_unavailable","message":"Configuration persistence is unavailable."}}))).into_response(),
        }
    }
}

pub(crate) async fn get_definition_revisions(
    State(state): State<AnalyticsState>,
    Path(site_id): Path<String>,
) -> Result<Response, DefinitionRevisionsError> {
    if site_id.is_empty() || site_id.len() > 64 {
        return Err(DefinitionRevisionsError::InvalidSiteId);
    }
    let revisions = state
        .reads
        .definition_revisions(&site_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "definition revision query failed");
            DefinitionRevisionsError::Unavailable
        })?;
    if revisions.iter().any(|revision| !revision.is_valid()) {
        return Err(DefinitionRevisionsError::Unavailable);
    }
    let current_definition_version = revisions
        .first()
        .map(|revision| revision.definition_version.clone());
    let values = revisions
        .into_iter()
        .map(|revision| {
            json!({
                "revision": revision.revision,
                "definition_version": revision.definition_version,
                "effective_at": revision.effective_at.map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Micros, true)),
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({
        "site_id": site_id,
        "current_definition_version": current_definition_version,
        "revisions": values,
    }))
    .into_response())
}
