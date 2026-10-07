use super::*;

pub(super) fn map_store_error(error: StoreError) -> ConfigurationApiError {
    match error {
        StoreError::NotFound => ConfigurationApiError::NotFound,
        StoreError::Conflict | StoreError::AlreadyExists => ConfigurationApiError::Conflict,
        StoreError::DefinitionRemoval => ConfigurationApiError::validation(
            "/definitions",
            "definition_id_immutable",
            "Definitions must be soft-deactivated instead of removed.",
        ),
        StoreError::OriginConflict => ConfigurationApiError::validation(
            "/allowed_origins",
            "origin_already_assigned",
            "An Origin is already assigned to another environment for this site.",
        ),
        StoreError::Database(error) => {
            let _ = error;
            tracing::error!("configuration persistence unavailable");
            ConfigurationApiError::Unavailable
        }
    }
}
