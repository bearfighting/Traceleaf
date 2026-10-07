//! Persisted analytics definition revisions.

mod revisions;

pub(crate) use revisions::{
    insert_initial_definition_revision, load_definition_revision,
    load_definition_revision_for_version, site_has_definition_revisions,
};
