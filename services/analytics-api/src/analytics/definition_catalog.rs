use chrono::{DateTime, Utc};

#[derive(Debug)]
pub(crate) struct DefinitionRevision {
    pub(crate) revision: i64,
    pub(crate) definition_version: String,
    pub(crate) effective_at: Option<DateTime<Utc>>,
}

impl DefinitionRevision {
    pub(crate) fn is_valid(&self) -> bool {
        self.revision > 0
            && configuration_runtime::is_valid_definition_version(&self.definition_version)
    }
}
