use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EventBatch {
    pub schema_version: u8,
    pub events: Vec<AnalyticsEvent>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum AnalyticsEvent {
    PageView(PageViewEvent),
    Custom(CustomEvent),
    WebVital(WebVitalEvent),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PageViewEvent {
    pub schema_version: u8,
    pub event_id: String,
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub site_id: String,
    pub occurred_at: i64,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub referrer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visitor_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_schema_version: Option<i32>,
    #[serde(flatten)]
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CustomEvent {
    pub schema_version: u8,
    pub event_id: String,
    #[serde(rename = "type")]
    pub event_type: CustomEventType,
    pub site_id: String,
    pub occurred_at: i64,
    pub event_name: String,
    pub properties: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visitor_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WebVitalEvent {
    pub schema_version: u8,
    pub event_id: String,
    #[serde(rename = "type")]
    pub event_type: WebVitalEventType,
    pub site_id: String,
    pub occurred_at: i64,
    pub page_view_event_id: String,
    pub path: String,
    pub page_view_occurred_at: i64,
    pub metric: String,
    pub value: f64,
    pub rating: String,
    pub navigation_type: String,
    pub report_sequence: i64,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WebVitalEventType {
    WebVital,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    PageView,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomEventType {
    CustomEvent,
}

impl AnalyticsEvent {
    pub fn site_id(&self) -> &str {
        match self {
            Self::PageView(e) => &e.site_id,
            Self::Custom(e) => &e.site_id,
            Self::WebVital(e) => &e.site_id,
        }
    }
    pub fn event_id(&self) -> &str {
        match self {
            Self::PageView(e) => &e.event_id,
            Self::Custom(e) => &e.event_id,
            Self::WebVital(e) => &e.event_id,
        }
    }
    pub fn occurred_at(&self) -> i64 {
        match self {
            Self::PageView(e) => e.occurred_at,
            Self::Custom(e) => e.occurred_at,
            Self::WebVital(e) => e.occurred_at,
        }
    }
    pub fn schema_version(&self) -> u8 {
        match self {
            Self::PageView(e) => e.schema_version,
            Self::Custom(e) => e.schema_version,
            Self::WebVital(e) => e.schema_version,
        }
    }
    pub fn visitor_id(&self) -> Option<&str> {
        match self {
            Self::PageView(e) => e.visitor_id.as_deref(),
            Self::Custom(e) => e.visitor_id.as_deref(),
            Self::WebVital(_) => None,
        }
    }
    pub fn event_type_name(&self) -> &'static str {
        match self {
            Self::PageView(_) => "page_view",
            Self::Custom(_) => "custom_event",
            Self::WebVital(_) => "web_vital",
        }
    }
    pub fn path(&self) -> Option<&str> {
        match self {
            Self::PageView(e) => Some(&e.path),
            Self::Custom(_) => None,
            Self::WebVital(e) => Some(&e.path),
        }
    }
    pub fn url(&self) -> Option<&str> {
        match self {
            Self::PageView(e) => e.url.as_deref(),
            Self::Custom(_) | Self::WebVital(_) => None,
        }
    }
    pub fn title(&self) -> Option<&str> {
        match self {
            Self::PageView(e) => e.title.as_deref(),
            Self::Custom(_) | Self::WebVital(_) => None,
        }
    }
    pub fn referrer(&self) -> Option<&str> {
        match self {
            Self::PageView(e) => e.referrer.as_deref(),
            Self::Custom(_) | Self::WebVital(_) => None,
        }
    }
    pub fn context_schema_version(&self) -> Option<i32> {
        match self {
            Self::PageView(e) => e.context_schema_version,
            Self::Custom(_) | Self::WebVital(_) => None,
        }
    }
    pub fn is_page_view(&self) -> bool {
        matches!(self, Self::PageView(_))
    }
}

impl CustomEvent {
    pub fn validate_properties(&self) -> Result<(), String> {
        validate_properties(&self.properties)
    }
}

fn validate_properties(value: &Value) -> Result<(), String> {
    use std::collections::HashSet;
    const PROHIBITED: &[&str] = &[
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
    if !value.is_object() {
        return Err("properties must be an object".into());
    }
    fn visit(
        value: &Value,
        depth: usize,
        keys: &mut usize,
        seen: &mut HashSet<usize>,
    ) -> Result<(), String> {
        match value {
            Value::Null | Value::Bool(_) => Ok(()),
            Value::Number(n) => {
                if n.as_f64().is_some_and(f64::is_finite) {
                    Ok(())
                } else {
                    Err("numbers must be finite".into())
                }
            }
            Value::String(s) => {
                if s.len() <= 256 {
                    Ok(())
                } else {
                    Err("strings must be at most 256 UTF-8 bytes".into())
                }
            }
            Value::Array(items) => {
                if depth > 4 {
                    return Err("properties nesting exceeds 4 levels".into());
                }
                if items.len() > 20 {
                    return Err("arrays may contain at most 20 items".into());
                }
                for item in items {
                    visit(item, depth + 1, keys, seen)?;
                }
                Ok(())
            }
            Value::Object(map) => {
                if depth > 4 {
                    return Err("properties nesting exceeds 4 levels".into());
                }
                let address = value as *const Value as usize;
                if !seen.insert(address) {
                    return Err("properties must not be cyclic".into());
                }
                for (key, child) in map {
                    *keys += 1;
                    if *keys > 32 {
                        return Err("properties may contain at most 32 keys".into());
                    }
                    if key.is_empty()
                        || key.len() > 64
                        || !key.is_ascii()
                        || !key.as_bytes()[0].is_ascii_alphabetic()
                        || !key
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
                    {
                        return Err("property keys must use the allowed ASCII format".into());
                    }
                    let normalized: String = key
                        .to_ascii_lowercase()
                        .chars()
                        .filter(|c| !"_.-".contains(*c))
                        .collect();
                    if PROHIBITED.contains(&normalized.as_str()) {
                        return Err("properties contain a prohibited key".into());
                    }
                    visit(child, depth + 1, keys, seen)?;
                }
                seen.remove(&address);
                Ok(())
            }
        }
    }
    visit(value, 0, &mut 0, &mut HashSet::new())?;
    if serde_json::to_vec(value)
        .map_err(|_| "properties must be JSON values")?
        .len()
        > 8192
    {
        return Err("properties must be at most 8 KiB".into());
    }
    Ok(())
}
