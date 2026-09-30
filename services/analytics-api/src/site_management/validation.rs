use jsonschema::{Draft, Validator};
use serde_json::Value;

const CAPABILITY_SCHEMA: &str = include_str!(
    "../../../../protocol/contracts/configuration/current/capability-update.schema.json"
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

#[cfg(test)]
mod tests {
    use super::ConfigurationValidators;

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
