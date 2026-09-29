use std::{collections::HashSet, fs, path::PathBuf};

use collector::{
    protocol::{AnalyticsEvent, EventBatch},
    validation::Validator,
};
use jsonschema::Draft;
use regex::Regex;
use serde::Deserialize;
use serde_json::{Value, json};

#[path = "../../../generated/typify/policy.rs"]
mod generated;

const POLICY_SCHEMA: &str = include_str!(
    "../../../../../protocol/contracts/configuration/current/environment-policy.schema.json"
);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CurrentStoredPolicy {
    schema_version: u32,
    site_id: String,
    environment: String,
    version: i64,
    updated_at: String,
    enabled: bool,
    allowed_origins: Vec<String>,
    ingest_keys: Vec<CurrentStoredKey>,
    rate_limit_per_minute: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CurrentStoredKey {
    key_id: String,
    sha256_digest: String,
    created_at: String,
}

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../");
    let event_validator = Validator::new().expect("embedded Collector event schemas compile");
    let schema: Value = serde_json::from_str(POLICY_SCHEMA).unwrap();
    let policy_validator = jsonschema::options()
        .with_draft(Draft::Draft202012)
        .build(&schema)
        .unwrap();

    for (sample, base) in [
        ("events", root.join("protocol/events/fixtures")),
        (
            "environment-policy",
            root.join("protocol/contracts/configuration/current/fixtures/environment-policy"),
        ),
    ] {
        for validity in ["valid", "invalid"] {
            let directory = base.join(validity);
            let mut paths = fs::read_dir(&directory)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
                .collect::<Vec<_>>();
            paths.sort();
            for path in paths {
                let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                let filename = path.file_name().unwrap().to_string_lossy();
                let key = format!("{sample}/{validity}/{filename}");
                let (static_ok, collector_ok, typify_serde, serialized) = if sample == "events" {
                    let is_batch = value.get("event_id").is_none() && value.get("type").is_none();
                    let static_ok = if is_batch {
                        static_batch(&value)
                    } else {
                        static_event(&value)
                    };
                    let collector_result = if is_batch {
                        event_validator.validate(&value).map(|_| ())
                    } else {
                        event_validator.validate_event(&value).map(|_| ())
                    };
                    let serialized = if static_ok {
                        if is_batch {
                            serde_json::from_value::<EventBatch>(value.clone())
                                .ok()
                                .and_then(|model| serde_json::to_value(model).ok())
                        } else {
                            serde_json::from_value::<AnalyticsEvent>(value.clone())
                                .ok()
                                .and_then(|model| serde_json::to_value(model).ok())
                        }
                    } else {
                        None
                    };
                    (static_ok, collector_result.is_ok(), Value::Null, serialized)
                } else {
                    let typify_serde = typify_policy(&value);
                    let static_ok = static_policy(&value);
                    let collector_ok = current_policy(&policy_validator, &value);
                    let serialized = if static_ok {
                        serde_json::from_value::<generated::SiteEnvironmentIngestPolicy>(
                            value.clone(),
                        )
                        .ok()
                        .and_then(|model| serde_json::to_value(model).ok())
                    } else {
                        None
                    };
                    (static_ok, collector_ok, json!(typify_serde), serialized)
                };
                println!(
                    "{}",
                    json!({"key":key,"static":static_ok,"collector":collector_ok,"typify_serde":typify_serde,"serialized":serialized})
                );
            }
        }
    }
}

fn static_batch(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let Some(events) = object.get("events").and_then(Value::as_array) else {
        return false;
    };
    if object.get("schema_version") != Some(&json!(1)) || !(1..=100).contains(&events.len()) {
        return false;
    }
    events.iter().all(static_event)
        && events
            .windows(2)
            .all(|pair| pair[0]["site_id"] == pair[1]["site_id"])
}

fn static_event(value: &Value) -> bool {
    let Some(obj) = value.as_object() else {
        return false;
    };
    let Some(event) = serde_json::from_value::<AnalyticsEvent>(value.clone()).ok() else {
        return false;
    };
    let type_name = obj.get("type").and_then(Value::as_str).unwrap_or("");
    let common = obj.get("schema_version") == Some(&json!(1))
        && string_pattern(obj, "event_id", r"^[0-9A-HJKMNP-TV-Z]{26}$")
        && string_pattern(obj, "site_id", r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        && int_at_least(obj, "occurred_at", 0);
    if !common {
        return false;
    }
    match type_name {
        "page_view" => {
            let path = obj.get("path").and_then(Value::as_str).unwrap_or("");
            let optional_strings = [("url", 4096usize), ("title", 512), ("referrer", 4096)];
            let strings_valid = optional_strings.iter().all(|(key, max)| {
                obj.get(*key).is_none_or(|v| {
                    v.as_str().is_some_and(|s| {
                        s.chars().count() <= *max
                            && if *key == "url" {
                                url::Url::parse(s).is_ok()
                            } else if *key == "referrer" {
                                uri_reference(s)
                            } else {
                                true
                            }
                    })
                })
            });
            let context_pair = obj.contains_key("context")
                == obj.contains_key("context_schema_version")
                && obj
                    .get("context_schema_version")
                    .is_none_or(|v| v == &json!(1));
            path.starts_with('/') && path.chars().count() <= 2048
                && strings_valid
                && obj.get("visitor_id").is_none_or(|v| v.as_str().is_some_and(|s| Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$").unwrap().is_match(s)))
                && context_pair && obj.get("context").is_none_or(static_context)
                && matches!(event, AnalyticsEvent::PageView(_))
        }
        "custom_event" => {
            let allowed = [
                "schema_version",
                "event_id",
                "type",
                "site_id",
                "occurred_at",
                "event_name",
                "properties",
                "visitor_id",
            ];
            let event_name = obj.get("event_name").and_then(Value::as_str).unwrap_or("");
            only_allowed(obj, &allowed)
                && Regex::new(r"^[A-Za-z][A-Za-z0-9_.-]{0,63}$")
                    .unwrap()
                    .is_match(event_name)
                && obj.get("visitor_id").is_none_or(|v| {
                    v.as_str().is_some_and(|s| {
                        Regex::new(
                        r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                    )
                    .unwrap()
                    .is_match(s)
                    })
                })
                && matches!(event, AnalyticsEvent::Custom(ref custom) if custom.validate_properties().is_ok())
        }
        "web_vital" => {
            let allowed = [
                "schema_version",
                "event_id",
                "type",
                "site_id",
                "occurred_at",
                "page_view_event_id",
                "path",
                "page_view_occurred_at",
                "metric",
                "value",
                "rating",
                "navigation_type",
                "report_sequence",
            ];
            if !only_allowed(obj, &allowed) || !matches!(event, AnalyticsEvent::WebVital(_)) {
                return false;
            }
            let metric = obj.get("metric").and_then(Value::as_str).unwrap_or("");
            let value = obj.get("value").and_then(Value::as_f64).unwrap_or(f64::NAN);
            let rating = obj.get("rating").and_then(Value::as_str).unwrap_or("");
            let (good, needs, max) = match metric {
                "LCP" => (2500.0, 4000.0, 600000.0),
                "INP" => (200.0, 500.0, 600000.0),
                "CLS" => (0.1, 0.25, 100.0),
                "FCP" => (1800.0, 3000.0, 600000.0),
                "TTFB" => (800.0, 1800.0, 600000.0),
                _ => return false,
            };
            let expected = if value <= good {
                "good"
            } else if value <= needs {
                "needs_improvement"
            } else {
                "poor"
            };
            string_pattern(obj, "page_view_event_id", r"^[0-9A-HJKMNP-TV-Z]{26}$")
                && obj
                    .get("path")
                    .and_then(Value::as_str)
                    .is_some_and(|s| s.starts_with('/') && s.chars().count() <= 2048)
                && int_at_least(obj, "page_view_occurred_at", 0)
                && value.is_finite()
                && value >= 0.0
                && value <= max
                && rating == expected
                && ["navigate", "reload", "back_forward", "prerender"].contains(
                    &obj.get("navigation_type")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                )
                && int_at_least(obj, "report_sequence", 1)
                && obj["page_view_occurred_at"].as_i64() <= obj["occurred_at"].as_i64()
        }
        _ => false,
    }
}

fn static_context(value: &Value) -> bool {
    let Some(obj) = value.as_object() else {
        return false;
    };
    let allowed = [
        "language",
        "timezone",
        "viewport_width",
        "viewport_height",
        "screen_width",
        "screen_height",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "referrer",
        "user_agent",
    ];
    let required = [
        "language",
        "timezone",
        "viewport_width",
        "viewport_height",
        "screen_width",
        "screen_height",
        "user_agent",
    ];
    only_allowed(obj, &allowed)
        && required.iter().all(|key| obj.contains_key(*key))
        && [
            ("language", 64usize),
            ("timezone", 64),
            ("utm_source", 256),
            ("utm_medium", 256),
            ("utm_campaign", 256),
            ("utm_term", 256),
            ("utm_content", 256),
            ("referrer", 4096),
            ("user_agent", 1024),
        ]
        .iter()
        .all(|(key, max)| {
            obj.get(*key)
                .is_none_or(|v| v.as_str().is_some_and(|s| s.chars().count() <= *max))
        })
        && [
            "viewport_width",
            "viewport_height",
            "screen_width",
            "screen_height",
        ]
        .iter()
        .all(|key| dimension(&obj[*key]))
}
fn dimension(value: &Value) -> bool {
    value == "unknown" || value.as_u64().is_some_and(|n| n <= 100000)
}
fn uri_reference(value: &str) -> bool {
    value.is_empty()
        || !value.chars().any(char::is_whitespace)
            && url::Url::parse(value)
                .or_else(|_| url::Url::parse(&format!("https://schema.invalid/{value}")))
                .is_ok()
}
fn only_allowed(value: &serde_json::Map<String, Value>, allowed: &[&str]) -> bool {
    value.keys().all(|key| allowed.contains(&key.as_str()))
}
fn string_pattern(obj: &serde_json::Map<String, Value>, key: &str, pattern: &str) -> bool {
    obj.get(key)
        .and_then(Value::as_str)
        .is_some_and(|value| Regex::new(pattern).unwrap().is_match(value))
}
fn int_at_least(obj: &serde_json::Map<String, Value>, key: &str, min: i64) -> bool {
    obj.get(key)
        .and_then(Value::as_i64)
        .is_some_and(|value| value >= min)
}

fn static_policy(value: &Value) -> bool {
    let Ok(policy) =
        serde_json::from_value::<generated::SiteEnvironmentIngestPolicy>(value.clone())
    else {
        return false;
    };
    if policy.schema_version != json!(1) || policy.allowed_origins.is_empty() {
        return false;
    }
    let unique = policy
        .allowed_origins
        .iter()
        .map(|origin| origin.to_string())
        .collect::<HashSet<_>>();
    unique.len() == policy.allowed_origins.len()
}

fn typify_policy(value: &Value) -> bool {
    serde_json::from_value::<generated::SiteEnvironmentIngestPolicy>(value.clone()).is_ok()
}

fn current_policy(validator: &jsonschema::Validator, value: &Value) -> bool {
    if validator.iter_errors(value).next().is_some() {
        return false;
    }
    let Ok(policy) = serde_json::from_value::<CurrentStoredPolicy>(value.clone()) else {
        return false;
    };
    if policy.schema_version != 1
        || policy.site_id != value["site_id"]
        || policy.environment != value["environment"]
        || value["version"].as_i64() != Some(policy.version)
        || policy.version < 1
        || policy.rate_limit_per_minute < 1
    {
        return false;
    }
    let _metadata = (&policy.updated_at, policy.enabled, &policy.allowed_origins);
    policy.ingest_keys.iter().all(|key| {
        let _metadata = (&key.key_id, &key.created_at);
        key.sha256_digest.len() == 64
            && key
                .sha256_digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
    })
}
