use std::{collections::HashSet, fs, path::Path};

use serde::Deserialize;
use serde_json::{Map, Value};

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct AnalyticsDefinitions {
    pub version: String,
    #[serde(default)]
    pub sites: Vec<SiteDefinitions>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SiteDefinitions {
    pub site_id: String,
    #[serde(default)]
    pub conversions: Vec<ConversionDefinition>,
    #[serde(default)]
    pub funnels: Vec<FunnelDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConversionDefinition {
    #[serde(default = "default_active")]
    pub active: bool,
    pub id: String,
    pub name: String,
    pub event_name: String,
    #[serde(default)]
    pub properties: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FunnelDefinition {
    #[serde(default = "default_active")]
    pub active: bool,
    pub id: String,
    pub name: String,
    pub steps: Vec<FunnelStepDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FunnelStepDefinition {
    pub event_name: String,
    #[serde(default)]
    pub properties: Map<String, Value>,
}

fn default_active() -> bool {
    true
}

impl AnalyticsDefinitions {
    pub fn load(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let definitions: Self = serde_json::from_str(&fs::read_to_string(path)?)?;
        definitions.validate()?;
        Ok(definitions)
    }

    pub fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            !self.version.trim().is_empty() && self.version.chars().count() <= 64,
            "definitions version must be at most 64 characters and contain a non-whitespace character"
        );
        let mut site_ids = HashSet::new();
        for site in &self.sites {
            anyhow::ensure!(
                site.site_id.len() <= 64
                    && site
                        .site_id
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_alphanumeric)
                    && site
                        .site_id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte)),
                "site_id is invalid: {}",
                site.site_id
            );
            anyhow::ensure!(
                site_ids.insert(&site.site_id),
                "duplicate site_id: {}",
                site.site_id
            );
            let mut ids = HashSet::new();
            for definition in &site.conversions {
                validate_id(&definition.id)?;
                anyhow::ensure!(
                    ids.insert(&definition.id),
                    "duplicate definition id: {}",
                    definition.id
                );
                validate_display_name(&definition.name)?;
                validate_event_name(&definition.event_name)?;
                validate_properties(&definition.properties)?;
            }
            for definition in &site.funnels {
                validate_id(&definition.id)?;
                anyhow::ensure!(
                    ids.insert(&definition.id),
                    "duplicate definition id: {}",
                    definition.id
                );
                validate_display_name(&definition.name)?;
                anyhow::ensure!(
                    definition.steps.len() >= 2,
                    "funnel {} requires at least two steps",
                    definition.id
                );
                for step in &definition.steps {
                    validate_event_name(&step.event_name)?;
                    validate_properties(&step.properties)?;
                }
            }
        }
        Ok(())
    }

    pub fn for_site(&self, site_id: &str) -> Option<&SiteDefinitions> {
        self.sites.iter().find(|site| site.site_id == site_id)
    }
}

pub fn matches(
    event_name: &str,
    properties: &Value,
    expected_name: &str,
    expected: &Map<String, Value>,
) -> bool {
    event_name == expected_name
        && expected
            .iter()
            .all(|(key, value)| properties.get(key) == Some(value))
}

fn validate_id(value: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        !value.is_empty()
            && value.len() <= 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte)),
        "definition id is invalid: {value}"
    );
    Ok(())
}

fn validate_display_name(value: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        !value.trim().is_empty() && value.chars().count() <= 128,
        "definition display name is invalid"
    );
    Ok(())
}

fn validate_event_name(value: &str) -> anyhow::Result<()> {
    let mut bytes = value.bytes();
    anyhow::ensure!(
        bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
            && bytes.all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
            && value.len() <= 64,
        "event name is invalid: {value}"
    );
    Ok(())
}

fn validate_properties(properties: &Map<String, Value>) -> anyhow::Result<()> {
    const FORBIDDEN: [&str; 21] = [
        "email",
        "emailaddress",
        "useremail",
        "phone",
        "phonenumber",
        "name",
        "firstname",
        "lastname",
        "fullname",
        "address",
        "homeaddress",
        "streetaddress",
        "ip",
        "ipaddress",
        "useragent",
        "cookie",
        "password",
        "passwd",
        "token",
        "userid",
        "useridentifier",
    ];
    anyhow::ensure!(
        properties.len() <= 32,
        "definition property match may contain at most 32 keys"
    );
    for (key, value) in properties {
        let normalized: String = key
            .to_ascii_lowercase()
            .chars()
            .filter(|character| !matches!(character, '_' | '.' | '-'))
            .collect();
        anyhow::ensure!(
            key.len() <= 64
                && key.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
                && key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte)),
            "property match key is invalid: {key}"
        );
        anyhow::ensure!(
            !FORBIDDEN.contains(&normalized.as_str()),
            "property match {key} is prohibited"
        );
        anyhow::ensure!(
            value.is_string() || value.is_boolean() || value.is_number() || value.is_null(),
            "property match {key} must be a JSON scalar"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{AnalyticsDefinitions, matches};
    use serde_json::json;

    #[test]
    fn validates_definitions_and_uses_type_sensitive_scalar_matching() {
        let definitions: AnalyticsDefinitions = serde_json::from_value(json!({"version":"2026-09-23.1","sites":[{"site_id":"site_a","conversions":[{"id":"purchase","name":"Purchase","event_name":"purchase","properties":{"currency":"CAD","confirmed":true}}],"funnels":[{"id":"checkout","name":"Checkout","steps":[{"event_name":"cart"},{"event_name":"purchase"}]}]}]})).unwrap();
        definitions.validate().unwrap();
        let expected = serde_json::from_value(json!({"currency":"CAD","confirmed":true})).unwrap();
        assert!(matches(
            "purchase",
            &json!({"currency":"CAD","confirmed":true,"amount":20}),
            "purchase",
            &expected
        ));
        assert!(!matches(
            "purchase",
            &json!({"currency":"cad","confirmed":true}),
            "purchase",
            &expected
        ));
        assert!(!matches(
            "purchase",
            &json!({"currency":"CAD","confirmed":1}),
            "purchase",
            &expected
        ));
    }

    #[test]
    fn validates_version_site_id_and_display_name_like_the_schema() {
        let valid = json!({
            "version": "v1",
            "sites": [{
                "site_id": "site_1",
                "conversions": [{
                    "id": "purchase",
                    "name": "购买完成",
                    "event_name": "purchase"
                }]
            }]
        });
        let definitions: AnalyticsDefinitions = serde_json::from_value(valid.clone()).unwrap();
        definitions.validate().unwrap();

        let mut invalid = valid.clone();
        invalid["version"] = serde_json::Value::String("v".repeat(65));
        assert!(
            serde_json::from_value::<AnalyticsDefinitions>(invalid)
                .unwrap()
                .validate()
                .is_err()
        );

        for site_id in ["_site", "site.name", "site/1", "x".repeat(65).as_str()] {
            let mut invalid = valid.clone();
            invalid["sites"][0]["site_id"] = serde_json::Value::String(site_id.to_owned());
            assert!(
                serde_json::from_value::<AnalyticsDefinitions>(invalid)
                    .unwrap()
                    .validate()
                    .is_err()
            );
        }

        let mut invalid = valid;
        invalid["sites"][0]["conversions"][0]["name"] = serde_json::Value::String("   ".to_owned());
        assert!(
            serde_json::from_value::<AnalyticsDefinitions>(invalid)
                .unwrap()
                .validate()
                .is_err()
        );
    }

    #[test]
    fn rejects_non_scalar_matches_and_short_funnels() {
        let definitions: AnalyticsDefinitions = serde_json::from_value(json!({"version":"1","sites":[{"site_id":"site_a","conversions":[{"id":"bad","name":"Bad","event_name":"buy","properties":{"item":{"id":1}}}]}]})).unwrap();
        assert!(definitions.validate().is_err());
        let definitions: AnalyticsDefinitions = serde_json::from_value(json!({"version":"1","sites":[{"site_id":"site_a","conversions":[{"id":"private","name":"Private","event_name":"buy","properties":{"e_mail":"person@example.test"}}]}]})).unwrap();
        assert!(definitions.validate().is_err());
        let definitions: AnalyticsDefinitions = serde_json::from_value(json!({"version":"1","sites":[{"site_id":"site_a","funnels":[{"id":"bad","name":"Bad","steps":[{"event_name":"one"}]}]}]})).unwrap();
        assert!(definitions.validate().is_err());
    }
}
