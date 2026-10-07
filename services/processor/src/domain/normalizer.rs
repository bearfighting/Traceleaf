use serde_json::Value;
use url::Url;

use crate::domain::parser::UserAgentParser;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedContext {
    pub context_schema_version: i32,
    pub language: String,
    pub timezone: String,
    pub viewport_width: Option<i32>,
    pub viewport_height: Option<i32>,
    pub screen_width: Option<i32>,
    pub screen_height: Option<i32>,
    pub utm_source: Option<String>,
    pub utm_medium: Option<String>,
    pub utm_campaign: Option<String>,
    pub utm_term: Option<String>,
    pub utm_content: Option<String>,
    pub referrer_host: String,
    pub device: String,
    pub browser: String,
    pub os: String,
}

pub fn normalize_context(
    context: Option<&Value>,
    user_agent: &str,
    parser: &impl UserAgentParser,
) -> NormalizedContext {
    let object = context.and_then(Value::as_object);
    let parsed = parser.parse(user_agent);
    NormalizedContext {
        context_schema_version: 1,
        language: string_or_unknown(object, "language"),
        timezone: string_or_unknown(object, "timezone"),
        viewport_width: dimension(object, "viewport_width"),
        viewport_height: dimension(object, "viewport_height"),
        screen_width: dimension(object, "screen_width"),
        screen_height: dimension(object, "screen_height"),
        utm_source: optional_string(object, "utm_source"),
        utm_medium: optional_string(object, "utm_medium"),
        utm_campaign: optional_string(object, "utm_campaign"),
        utm_term: optional_string(object, "utm_term"),
        utm_content: optional_string(object, "utm_content"),
        referrer_host: referrer_host(object),
        device: parsed.device,
        browser: parsed.browser,
        os: parsed.os,
    }
}

fn string_or_unknown(object: Option<&serde_json::Map<String, Value>>, key: &str) -> String {
    object
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| "unknown".to_owned())
}

fn optional_string(object: Option<&serde_json::Map<String, Value>>, key: &str) -> Option<String> {
    object
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

fn dimension(object: Option<&serde_json::Map<String, Value>>, key: &str) -> Option<i32> {
    let value = object.and_then(|entry| entry.get(key))?;
    let number = value.as_i64()?;
    (0..=100_000).contains(&number).then_some(number as i32)
}

fn referrer_host(object: Option<&serde_json::Map<String, Value>>) -> String {
    let Some(referrer) = object
        .and_then(|value| value.get("referrer"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    else {
        return "direct".to_owned();
    };

    Url::parse(referrer)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        .filter(|host| !host.is_empty())
        .unwrap_or_else(|| "direct".to_owned())
}

#[cfg(test)]
mod tests {
    use super::normalize_context;
    use crate::domain::parser::WootheeParser;
    use serde_json::json;

    #[test]
    fn normalizes_unknowns_and_discards_sensitive_fields() {
        let context = json!({
            "language": null,
            "timezone": "",
            "viewport_width": -1,
            "viewport_height": 900,
            "referrer": "https://Example.com/path",
            "utm_source": "",
            "ip": "192.0.2.1",
            "session_id": "client-session"
        });
        let normalized = normalize_context(
            Some(&context),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
            &WootheeParser::new(),
        );

        assert_eq!(normalized.language, "unknown");
        assert_eq!(normalized.timezone, "unknown");
        assert_eq!(normalized.viewport_width, None);
        assert_eq!(normalized.viewport_height, Some(900));
        assert_eq!(normalized.referrer_host, "example.com");
        assert_eq!(normalized.utm_source, None);
    }
}
