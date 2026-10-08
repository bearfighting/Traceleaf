#[cfg(test)]
pub(crate) fn validate_schema(
    validator: &jsonschema::Validator,
    value: &Value,
    path: &'static str,
) -> Result<(), ConfigurationApiError> {
    if let Some(error) = validator.iter_errors(value).next() {
        return Err(ConfigurationApiError::Validation(vec![
            ConfigurationValidationDetail {
                path: format!("{path}{}", error.instance_path()),
                code: "schema_validation",
                message: "Value does not match the configuration schema.",
            },
        ]));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn validate_capability_dependencies(
    value: &Value,
    registry: &configuration_runtime::CapabilityRegistry,
) -> Result<(), ConfigurationApiError> {
    let capabilities = &value["capabilities"];
    if capabilities["page_views"]["enabled"] != true {
        return Err(ConfigurationApiError::validation(
            "/capabilities/page_views/enabled",
            "required_capability",
            "Page Views must remain enabled.",
        ));
    }
    for capability in registry.ids() {
        let id = capability.as_str();
        if capabilities[id]["enabled"] != true {
            continue;
        }
        if !registry.is_implemented(capability) {
            return Err(ConfigurationApiError::validation(
                format!("/capabilities/{id}/enabled"),
                "unsupported_capability",
                "A planned capability cannot be enabled.",
            ));
        }
        for dependency in registry.dependencies(capability) {
            if capabilities[dependency.as_str()]["enabled"] != true {
                return Err(ConfigurationApiError::validation(
                    format!("/capabilities/{}/{}/enabled", id, dependency.as_str()),
                    "missing_dependency",
                    "An enabled capability requires this dependency.",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn validate_policy_origins(origins: &[String]) -> Result<Value, ConfigurationApiError> {
    let mut canonical_origins = Vec::with_capacity(origins.len());
    let mut identities = std::collections::HashSet::new();
    for (index, origin) in origins.iter().enumerate() {
        let parsed = Url::parse(origin).map_err(|_| {
            ConfigurationApiError::validation(
                format!("/allowed_origins/{index}"),
                "invalid_origin",
                "Origin must be an HTTP or HTTPS origin without credentials, path, query, or fragment.",
            )
        })?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || !matches!(parsed.path(), "" | "/")
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || parsed.host().is_none()
        {
            return Err(ConfigurationApiError::validation(
                format!("/allowed_origins/{index}"),
                "invalid_origin",
                "Origin must be an HTTP or HTTPS origin without credentials, path, query, or fragment.",
            ));
        }
        let identity = parsed.origin().ascii_serialization();
        if !identities.insert(identity) {
            return Err(ConfigurationApiError::validation(
                format!("/allowed_origins/{index}"),
                "duplicate_origin",
                "Origins must be unique after URL normalization.",
            ));
        }
        canonical_origins.push(Value::String(origin.clone()));
    }
    Ok(Value::Array(canonical_origins))
}
#[cfg(test)]
use super::*;
