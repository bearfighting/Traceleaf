use woothee::parser::Parser;

pub const WOOTHEE_VERSION: &str = "woothee-0.13.0";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedUserAgent {
    pub device: String,
    pub browser: String,
    pub os: String,
}

pub trait UserAgentParser {
    fn version(&self) -> &'static str;
    fn parse(&self, user_agent: &str) -> ParsedUserAgent;
}

#[derive(Default)]
pub struct WootheeParser {
    parser: Parser,
}

impl WootheeParser {
    pub fn new() -> Self {
        Self {
            parser: Parser::new(),
        }
    }
}

impl UserAgentParser for WootheeParser {
    fn version(&self) -> &'static str {
        WOOTHEE_VERSION
    }

    fn parse(&self, user_agent: &str) -> ParsedUserAgent {
        let Some(result) = self.parser.parse(user_agent) else {
            return ParsedUserAgent::unknown();
        };

        let device = match result.category {
            "pc" => "desktop",
            "smartphone" | "mobilephone" => "mobile",
            "tablet" => "tablet",
            _ => "unknown",
        };
        let browser = family_with_major(result.name, result.version);
        let os = family_with_major(result.os, result.os_version.as_ref());

        ParsedUserAgent {
            device: device.to_owned(),
            browser,
            os,
        }
    }
}

impl ParsedUserAgent {
    fn unknown() -> Self {
        Self {
            device: "unknown".to_owned(),
            browser: "unknown".to_owned(),
            os: "unknown".to_owned(),
        }
    }
}

fn family_with_major(family: &str, version: &str) -> String {
    if family.is_empty() || family == "UNKNOWN" || family == "unknown" || family == "-" {
        return "unknown".to_owned();
    }
    let major = version.split('.').next().unwrap_or_default();
    if major.chars().all(|character| character.is_ascii_digit()) && !major.is_empty() {
        format!("{family}:{major}")
    } else {
        family.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::{UserAgentParser, WOOTHEE_VERSION, WootheeParser};

    #[test]
    fn parses_common_browser_categories_without_exposing_raw_user_agent() {
        let parser = WootheeParser::new();
        let result = parser.parse(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        );

        assert_eq!(parser.version(), WOOTHEE_VERSION);
        assert_eq!(result.device, "desktop");
        assert_eq!(result.browser, "Chrome:120");
        assert!(result.os.starts_with("Windows"));
    }

    #[test]
    fn maps_unknown_and_crawler_values_to_unknown_device() {
        let parser = WootheeParser::new();
        let result = parser.parse("Mozilla/5.0 (compatible; ExampleBot/1.0)");
        assert_eq!(result.device, "unknown");
    }
}
