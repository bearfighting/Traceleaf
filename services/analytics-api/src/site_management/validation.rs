use jsonschema::{Draft, Validator};
use serde_json::Value;

const CAPABILITY_SCHEMA: &str = include_str!(
    "../../../../protocol/contracts/configuration/current/capability-update.schema.json"
);
const STORED_CAPABILITY_SCHEMA: &str =
    include_str!("../../../../protocol/contracts/configuration/current/capabilities.schema.json");
const STORED_POLICY_SCHEMA: &str = include_str!(
    "../../../../protocol/contracts/configuration/current/environment-policy.schema.json"
);
const POLICY_UPDATE_SCHEMA: &str = include_str!(
    "../../../../protocol/contracts/configuration/current/environment-policy-update.schema.json"
);
const DEFINITION_SET_UPDATE_SCHEMA: &str = include_str!(
    "../../../../protocol/contracts/configuration/current/conversion-funnel-definition-set-update.schema.json"
);

#[derive(Clone)]
pub(crate) struct ConfigurationValidators {
    pub(crate) capabilities: Validator,
    pub(crate) stored_capabilities: Validator,
    pub(crate) stored_policy: Validator,
    pub(crate) environment_policy: Validator,
    pub(crate) definition_set: Validator,
}

impl ConfigurationValidators {
    pub(crate) fn new() -> Result<Self, String> {
        Self::from_schema_texts(
            CAPABILITY_SCHEMA,
            POLICY_UPDATE_SCHEMA,
            DEFINITION_SET_UPDATE_SCHEMA,
        )
    }

    fn from_schema_texts(
        capabilities: &str,
        environment_policy: &str,
        definition_set: &str,
    ) -> Result<Self, String> {
        Ok(Self {
            capabilities: compile(capabilities)?,
            stored_capabilities: compile_stored(STORED_CAPABILITY_SCHEMA)?,
            stored_policy: compile_stored(STORED_POLICY_SCHEMA)?,
            environment_policy: compile(environment_policy)?,
            definition_set: compile(definition_set)?,
        })
    }
}

fn compile(schema_text: &str) -> Result<Validator, String> {
    let schema: Value = serde_json::from_str(schema_text).map_err(|error| error.to_string())?;
    jsonschema::options()
        .with_draft(Draft::Draft202012)
        .build(&schema)
        .map_err(|error| error.to_string())
}

fn compile_stored(schema_text: &str) -> Result<Validator, String> {
    let schema: Value = serde_json::from_str(schema_text).map_err(|error| error.to_string())?;
    jsonschema::options()
        .with_draft(Draft::Draft202012)
        .should_validate_formats(true)
        .build(&schema)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::ConfigurationValidators;

    #[test]
    fn stored_configuration_validators_reject_invalid_date_time_after_preflight() {
        let validators = ConfigurationValidators::new().unwrap();
        let policy: serde_json::Value = serde_json::from_str(include_str!("../../../../protocol/contracts/configuration/current/fixtures/environment-policy/invalid/invalid-updated-at-date-time.json")).unwrap();
        let capability: serde_json::Value = serde_json::from_str(include_str!("../../../../protocol/contracts/configuration/current/fixtures/capabilities/invalid/invalid-updated-at-date-time.json")).unwrap();
        assert!(
            validators
                .stored_policy
                .iter_errors(&policy)
                .next()
                .is_some()
        );
        let invalid_key_created_at: serde_json::Value = serde_json::from_str(include_str!("../../../../protocol/contracts/configuration/current/fixtures/environment-policy/invalid/invalid-key-created-at-date-time.json")).unwrap();
        assert!(
            validators
                .stored_policy
                .iter_errors(&invalid_key_created_at)
                .next()
                .is_some()
        );
        assert!(
            validators
                .stored_capabilities
                .iter_errors(&capability)
                .next()
                .is_some()
        );
    }

    #[test]
    fn schema_initialization_failure_is_returned_to_the_startup_boundary() {
        assert!(ConfigurationValidators::from_schema_texts("not json", "{}", "{}").is_err());
        assert!(
            ConfigurationValidators::from_schema_texts(
                "{}",
                "{\"type\":\"not-a-schema-type\"}",
                "{}"
            )
            .is_err()
        );
    }
}
