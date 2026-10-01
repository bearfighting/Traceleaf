use super::{configuration, sites, state::SiteManagementState};
use axum::{
    Router,
    routing::{delete, get, post},
};

pub(crate) fn router(state: SiteManagementState) -> Router {
    Router::new()
        .route("/v1/admin/sites", get(sites::list_sites))
        .route(
            "/v1/admin/sites/{site_id}",
            get(sites::get_site).patch(sites::patch_site),
        )
        .route(
            "/v1/admin/sites/{site_id}/archive",
            post(sites::archive_site),
        )
        .route(
            "/v1/admin/sites/{site_id}/restore",
            post(sites::restore_site),
        )
        .route(
            "/v1/admin/sites/{site_id}/conversion-funnel-definitions",
            get(configuration::get_definition_set)
                .post(configuration::create_definition_set)
                .put(configuration::put_definition_set),
        )
        .route(
            "/v1/admin/sites/{site_id}/capabilities",
            get(configuration::get_capabilities).put(configuration::put_capabilities),
        )
        .route(
            "/v1/admin/sites/{site_id}/environments/{environment}/ingest-policy",
            get(configuration::get_ingest_policy)
                .post(configuration::create_ingest_policy)
                .put(configuration::put_ingest_policy),
        )
        .route(
            "/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys",
            post(configuration::create_ingest_key),
        )
        .route(
            "/v1/admin/sites/{site_id}/environments/{environment}/ingest-keys/{key_id}",
            delete(configuration::revoke_ingest_key),
        )
        .with_state(state)
}
