use jsonschema::{Draft, Retrieve, Uri};
use serde_json::Value;
use thiserror::Error;

use crate::domain::protocol::{AnalyticsEvent, CustomEvent, PageViewEvent, WebVitalEvent};

#[derive(Debug, Clone)]
pub struct ValidatedBatch {
    pub schema_version: u8,
    pub events: Vec<ValidatedEvent>,
}

#[derive(Debug, Clone)]
pub struct ValidatedEvent {
    pub event: AnalyticsEvent,
    pub payload: Value,
}

const EVENT_BATCH_SCHEMA: &str =
    include_str!("../../../../protocol/events/schemas/event-batch.schema.json");
const PAGE_VIEW_SCHEMA: &str =
    include_str!("../../../../protocol/events/schemas/page-view-event.schema.json");
const CUSTOM_EVENT_SCHEMA: &str =
    include_str!("../../../../protocol/events/schemas/custom-event.schema.json");
const WEB_VITAL_SCHEMA: &str =
    include_str!("../../../../protocol/events/schemas/web-vital-event.schema.json");
const CONTEXT_SCHEMA: &str =
    include_str!("../../../../protocol/contexts/browser-context.schema.json");

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("failed to parse embedded event batch schema: {0}")]
    BatchSchema(serde_json::Error),
    #[error("failed to parse embedded page view schema: {0}")]
    PageViewSchema(serde_json::Error),
    #[error("failed to compile event schemas: {0}")]
    Compile(String),
}

#[derive(Debug)]
pub struct Validator {
    batch: jsonschema::Validator,
    page_view: jsonschema::Validator,
    custom_event: jsonschema::Validator,
    web_vital: jsonschema::Validator,
}

impl Validator {
    pub fn new() -> Result<Self, ValidationError> {
        let batch_schema: Value =
            serde_json::from_str(EVENT_BATCH_SCHEMA).map_err(ValidationError::BatchSchema)?;
        let page_view_schema: Value =
            serde_json::from_str(PAGE_VIEW_SCHEMA).map_err(ValidationError::PageViewSchema)?;
        let custom_event_schema: Value =
            serde_json::from_str(CUSTOM_EVENT_SCHEMA).map_err(ValidationError::PageViewSchema)?;
        let web_vital_schema: Value =
            serde_json::from_str(WEB_VITAL_SCHEMA).map_err(ValidationError::PageViewSchema)?;
        let context_schema: Value =
            serde_json::from_str(CONTEXT_SCHEMA).map_err(ValidationError::PageViewSchema)?;

        let batch = jsonschema::options()
            .with_draft(Draft::Draft202012)
            .should_validate_formats(true)
            .with_retriever(EmbeddedResolver {
                page_view_schema: page_view_schema.clone(),
                custom_event_schema: custom_event_schema.clone(),
                web_vital_schema: web_vital_schema.clone(),
                context_schema: context_schema.clone(),
            })
            .build(&batch_schema)
            .map_err(|error| ValidationError::Compile(error.to_string()))?;
        let page_view = jsonschema::options()
            .with_draft(Draft::Draft202012)
            .should_validate_formats(true)
            .with_retriever(EmbeddedResolver {
                page_view_schema: page_view_schema.clone(),
                custom_event_schema: custom_event_schema.clone(),
                web_vital_schema: web_vital_schema.clone(),
                context_schema: context_schema.clone(),
            })
            .build(&page_view_schema)
            .map_err(|error| ValidationError::Compile(error.to_string()))?;
        let web_vital = jsonschema::options()
            .with_draft(Draft::Draft202012)
            .should_validate_formats(true)
            .with_retriever(EmbeddedResolver {
                page_view_schema: page_view_schema.clone(),
                custom_event_schema: custom_event_schema.clone(),
                web_vital_schema: web_vital_schema.clone(),
                context_schema: context_schema.clone(),
            })
            .build(&web_vital_schema)
            .map_err(|error| ValidationError::Compile(error.to_string()))?;
        let custom_event = jsonschema::options()
            .with_draft(Draft::Draft202012)
            .should_validate_formats(true)
            .with_retriever(EmbeddedResolver {
                page_view_schema: page_view_schema.clone(),
                custom_event_schema: custom_event_schema.clone(),
                web_vital_schema: web_vital_schema.clone(),
                context_schema: context_schema.clone(),
            })
            .build(&custom_event_schema)
            .map_err(|error| ValidationError::Compile(error.to_string()))?;

        Ok(Self {
            batch,
            page_view,
            custom_event,
            web_vital,
        })
    }

    pub fn validate(&self, value: &Value) -> Result<ValidatedBatch, Vec<String>> {
        if self.batch.validate(value).is_err() {
            return Err(self
                .batch
                .iter_errors(value)
                .map(|error| error.to_string())
                .collect());
        }

        let events = value
            .get("events")
            .and_then(Value::as_array)
            .ok_or_else(|| vec!["events must be an array".to_owned()])?;
        let mut validated_events = Vec::with_capacity(events.len());
        let mut batch_site: Option<String> = None;
        for payload in events {
            let event = self.validate_event(payload)?;
            if batch_site
                .as_deref()
                .is_some_and(|site| site != event.site_id())
            {
                return Err(vec!["a batch may contain events for only one site".into()]);
            }
            batch_site = Some(event.site_id().to_owned());
            validated_events.push(ValidatedEvent {
                event,
                payload: payload.clone(),
            });
        }

        Ok(ValidatedBatch {
            schema_version: 1,
            events: validated_events,
        })
    }

    #[allow(dead_code)]
    pub fn validate_event(&self, value: &Value) -> Result<AnalyticsEvent, Vec<String>> {
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        let schema = match event_type {
            "page_view" => &self.page_view,
            "custom_event" => &self.custom_event,
            "web_vital" => &self.web_vital,
            _ => return Err(vec!["unknown event type".into()]),
        };
        if schema.validate(value).is_err() {
            return Err(schema
                .iter_errors(value)
                .map(|error| error.to_string())
                .collect());
        }
        if event_type == "page_view" {
            serde_json::from_value::<PageViewEvent>(value.clone())
                .map(AnalyticsEvent::PageView)
                .map_err(|e| vec![e.to_string()])
        } else if event_type == "web_vital" {
            let event = serde_json::from_value::<WebVitalEvent>(value.clone())
                .map_err(|e| vec![e.to_string()])?;
            let thresholds = match event.metric.as_str() {
                "LCP" => (2500., 4000., 600000.),
                "INP" => (200., 500., 600000.),
                "CLS" => (0.1, 0.25, 100.),
                "FCP" => (1800., 3000., 600000.),
                "TTFB" => (800., 1800., 600000.),
                _ => return Err(vec!["invalid metric".into()]),
            };
            if !event.value.is_finite() || event.value < 0. || event.value > thresholds.2 {
                return Err(vec!["metric value outside supported range".into()]);
            }
            let rating = if event.value <= thresholds.0 {
                "good"
            } else if event.value <= thresholds.1 {
                "needs_improvement"
            } else {
                "poor"
            };
            if event.rating != rating {
                return Err(vec!["rating does not match metric value".into()]);
            }
            if event.page_view_occurred_at > event.occurred_at {
                return Err(vec![
                    "Page View time must not follow the Web Vital report".into(),
                ]);
            }
            Ok(AnalyticsEvent::WebVital(event))
        } else {
            let event = serde_json::from_value::<CustomEvent>(value.clone())
                .map_err(|e| vec![e.to_string()])?;
            event.validate_properties().map_err(|e| vec![e])?;
            Ok(AnalyticsEvent::Custom(event))
        }
    }
}

struct EmbeddedResolver {
    page_view_schema: Value,
    custom_event_schema: Value,
    web_vital_schema: Value,
    context_schema: Value,
}

impl Retrieve for EmbeddedResolver {
    fn retrieve(
        &self,
        uri: &Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let schema = match uri.as_str() {
            "https://web-analytics-platform.dev/schemas/events/page-view-event.schema.json" => {
                &self.page_view_schema
            }
            "https://web-analytics-platform.dev/schemas/events/custom-event.schema.json" => {
                &self.custom_event_schema
            }
            "https://web-analytics-platform.dev/schemas/events/web-vital-event.schema.json" => {
                &self.web_vital_schema
            }
            "https://web-analytics-platform.dev/schemas/contexts/browser-context.schema.json" => {
                &self.context_schema
            }
            _ => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("embedded schema not found: {uri}"),
                )
                .into());
            }
        };
        Ok(schema.clone())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{CUSTOM_EVENT_SCHEMA, CustomEvent, Validator, WebVitalEvent};

    #[test]
    fn wire_round_trips_remain_schema_valid_and_preserve_page_view_extensions() {
        let validator = Validator::new().expect("embedded schemas should compile");
        let page_views = [
            serde_json::json!({
                "schema_version": 1, "event_id": "01J00000000000000000000001",
                "type": "page_view", "site_id": "site_example", "occurred_at": 1760000000000_i64,
                "path": "/"
            }),
            serde_json::json!({
                "schema_version": 1, "event_id": "01J00000000000000000000002",
                "type": "page_view", "site_id": "site_example", "occurred_at": 1760000000000_i64,
                "path": "/about", "context_schema_version": 1,
                "context": {"language": "en", "timezone": "America/Toronto", "viewport_width": 1280,
                    "viewport_height": 800, "screen_width": 1920, "screen_height": 1080, "user_agent": "test"},
                "route_pattern": "/about", "experiment": {"variant": "a"}
            }),
        ];
        for input in page_views {
            let decoded = validator.validate_event(&input).expect("valid page view");
            let encoded = serde_json::to_value(decoded).expect("page view serializes");
            assert!(validator.page_view.is_valid(&encoded), "{encoded}");
            assert_eq!(encoded["path"], input["path"]);
            if input.get("route_pattern").is_some() {
                assert_eq!(encoded["route_pattern"], input["route_pattern"]);
                assert_eq!(encoded["experiment"], input["experiment"]);
                assert!(encoded.get("url").is_none());
                assert!(encoded.get("title").is_none());
                assert!(encoded.get("referrer").is_none());
                assert!(encoded.get("visitor_id").is_none());
            }
        }
    }

    #[test]
    fn optional_custom_event_field_is_omitted_and_schema_valid() {
        let validator = Validator::new().expect("embedded schemas should compile");
        let input = serde_json::json!({
            "schema_version": 1, "event_id": "01J00000000000000000000003",
            "type": "custom_event", "site_id": "site_example", "occurred_at": 1760000000000_i64,
            "event_name": "signup", "properties": {}
        });
        let decoded = validator
            .validate_event(&input)
            .expect("valid custom event");
        let encoded = serde_json::to_value(decoded).expect("custom event serializes");
        let schema: serde_json::Value = serde_json::from_str(CUSTOM_EVENT_SCHEMA).unwrap();
        let schema_validator = jsonschema::validator_for(&schema).unwrap();
        assert!(schema_validator.is_valid(&encoded), "{encoded}");
        assert!(encoded.get("visitor_id").is_none());
    }

    #[test]
    fn schema_forbidden_null_is_rejected() {
        let validator = Validator::new().expect("embedded schemas should compile");
        let page_view = serde_json::json!({
            "schema_version": 1, "event_id": "01J00000000000000000000004",
            "type": "page_view", "site_id": "site_example", "occurred_at": 1760000000000_i64,
            "path": "/", "title": null
        });
        assert!(validator.validate_event(&page_view).is_err());
    }

    #[test]
    fn closed_event_wire_types_reject_unknown_fields() {
        let custom = serde_json::json!({
            "schema_version": 1, "event_id": "01J00000000000000000000005",
            "type": "custom_event", "site_id": "site_example", "occurred_at": 1760000000000_i64,
            "event_name": "signup", "properties": {}, "extra": true
        });
        assert!(serde_json::from_value::<CustomEvent>(custom).is_err());
        let vital = serde_json::json!({
            "schema_version": 1, "event_id": "01J00000000000000000000006",
            "type": "web_vital", "site_id": "site_example", "occurred_at": 1760000000000_i64,
            "page_view_event_id": "01J00000000000000000000001", "path": "/",
            "page_view_occurred_at": 1759999999000_i64, "metric": "LCP", "value": 1.0,
            "rating": "good", "navigation_type": "navigate", "report_sequence": 1, "extra": true
        });
        assert!(serde_json::from_value::<WebVitalEvent>(vital).is_err());
    }

    #[test]
    fn canonical_valid_fixtures_are_accepted() {
        let validator = Validator::new().expect("embedded schemas should compile");
        let directories = [fixture_directory("valid")];

        for directory in directories {
            for entry in fs::read_dir(directory).expect("valid fixture directory should exist") {
                let path = entry.expect("fixture entry should be readable").path();
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }

                let value: serde_json::Value = serde_json::from_str(
                    &fs::read_to_string(&path).expect("fixture should be readable"),
                )
                .expect("valid fixture should be JSON");
                let result = if value.get("event_id").is_some() {
                    validator.validate_event(&value).map(|_| ())
                } else {
                    validator.validate(&value).map(|_| ())
                };
                assert!(
                    result.is_ok(),
                    "valid fixture should pass: {}",
                    path.display()
                );
            }
        }
    }

    #[test]
    fn canonical_invalid_fixtures_are_rejected() {
        let validator = Validator::new().expect("embedded schemas should compile");
        let directories = [fixture_directory("invalid")];

        for directory in directories {
            for entry in fs::read_dir(directory).expect("invalid fixture directory should exist") {
                let path = entry.expect("fixture entry should be readable").path();
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }

                let value: serde_json::Value = serde_json::from_str(
                    &fs::read_to_string(&path).expect("fixture should be readable"),
                )
                .expect("invalid fixture should still be JSON");
                let result = if value.get("event_id").is_some() {
                    validator.validate_event(&value).map(|_| ())
                } else {
                    validator.validate(&value).map(|_| ())
                };
                assert!(
                    result.is_err(),
                    "invalid fixture should fail: {}",
                    path.display()
                );
            }
        }
    }

    fn fixture_directory(kind: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/events/fixtures")
            .join(kind)
    }
}
