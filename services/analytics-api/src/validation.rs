use chrono::NaiveDate;
use url::form_urlencoded;

use crate::{errors::RequestError, models::DateRange};

const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 100;
const MAX_RANGE_SPAN_DAYS: i64 = 365;
pub(crate) const DIMENSIONS: [&str; 11] = [
    "language",
    "timezone",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "referrer_host",
    "device",
    "browser",
    "os",
];

pub(crate) fn parse_range(from: &str, to: &str) -> Result<DateRange, RequestError> {
    let from_date = parse_date(from)?;
    let to_date = parse_date(to)?;
    if from_date > to_date {
        return Err(RequestError::InvalidDateRange(
            "from must be before or equal to to",
        ));
    }
    if to_date.signed_duration_since(from_date).num_days() > MAX_RANGE_SPAN_DAYS {
        return Err(RequestError::DateRangeTooLarge);
    }
    Ok(DateRange {
        from: from_date,
        to: to_date,
    })
}

fn parse_date(value: &str) -> Result<NaiveDate, RequestError> {
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| RequestError::InvalidDateRange("from and to must use YYYY-MM-DD"))?;
    if date.format("%Y-%m-%d").to_string() != value {
        return Err(RequestError::InvalidDateRange(
            "from and to must use YYYY-MM-DD",
        ));
    }
    Ok(date)
}

pub(crate) fn parse_limit(value: Option<&str>) -> Result<i64, RequestError> {
    let limit = value.map_or(Ok(DEFAULT_LIMIT), |value| {
        value.parse::<i64>().map_err(|_| RequestError::InvalidLimit)
    })?;
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(RequestError::InvalidLimit);
    }
    Ok(limit)
}

pub(crate) fn parse_limit_query(query: Option<&str>) -> Result<i64, RequestError> {
    let mut limit = None;
    for (key, value) in form_urlencoded::parse(query.unwrap_or_default().as_bytes()) {
        if key == "limit" {
            if limit.is_some() {
                return Err(RequestError::InvalidLimit);
            }
            limit = Some(value.into_owned());
        }
    }
    parse_limit(limit.as_deref())
}

pub(crate) fn parse_events_query(
    query: Option<&str>,
) -> Result<(i64, Option<String>), RequestError> {
    let mut limit = None;
    let mut event_name = None;
    for (key, value) in form_urlencoded::parse(query.unwrap_or_default().as_bytes()) {
        match key.as_ref() {
            "limit" => {
                if limit.is_some() {
                    return Err(RequestError::InvalidLimit);
                }
                limit = Some(value.into_owned());
            }
            "event_name" => {
                if event_name.is_some() {
                    return Err(RequestError::InvalidEventName);
                }
                event_name = Some(value.into_owned());
            }
            _ => {}
        }
    }
    let limit = parse_limit(limit.as_deref())?;
    if event_name
        .as_deref()
        .is_some_and(|name| !valid_event_name(name))
    {
        return Err(RequestError::InvalidEventName);
    }
    Ok((limit, event_name))
}

fn valid_event_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes.next().is_some_and(|b| b.is_ascii_alphabetic())
        && bytes.all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
        && name.len() <= 64
}

pub(crate) fn validate_dimension(value: &str) -> Result<(), RequestError> {
    DIMENSIONS
        .contains(&value)
        .then_some(())
        .ok_or(RequestError::InvalidDimension)
}

pub(crate) fn parse_web_vitals_query(
    query: Option<&str>,
) -> Result<(i64, Option<String>), RequestError> {
    let mut limit = None;
    let mut path = None;
    for (k, v) in form_urlencoded::parse(query.unwrap_or_default().as_bytes()) {
        match k.as_ref() {
            "limit" => {
                if limit.is_some() {
                    return Err(RequestError::InvalidLimit);
                }
                limit = Some(v.into_owned())
            }
            "path" => {
                if path.is_some() {
                    return Err(RequestError::InvalidEventName);
                }
                path = Some(v.into_owned())
            }
            _ => {}
        }
    }
    let limit = parse_limit(limit.as_deref())?;
    if path
        .as_deref()
        .is_some_and(|x| !x.starts_with('/') || x.len() > 2048)
    {
        return Err(RequestError::InvalidEventName);
    }
    Ok((limit, path))
}

pub(crate) fn parse_definition_query(
    query: Option<&str>,
) -> Result<(i64, Option<String>, Option<String>), RequestError> {
    let mut limit = None;
    let mut definition_id = None;
    let mut definition_version = None;
    for (key, value) in form_urlencoded::parse(query.unwrap_or_default().as_bytes()) {
        match key.as_ref() {
            "limit" => {
                if limit.is_some() {
                    return Err(RequestError::InvalidLimit);
                }
                limit = Some(value.into_owned());
            }
            "definition_id" => {
                if definition_id.is_some() {
                    return Err(RequestError::InvalidEventName);
                }
                definition_id = Some(value.into_owned());
            }
            "definition_version" => {
                if definition_version.is_some() {
                    return Err(RequestError::InvalidDefinitionVersion);
                }
                definition_version = Some(value.into_owned());
            }
            _ => {}
        }
    }
    let limit = parse_limit(limit.as_deref())?;
    if definition_version.as_deref().is_some_and(|v| {
        v.is_empty() || v.len() > 64 || v.trim() != v || v.chars().any(char::is_whitespace)
    }) {
        return Err(RequestError::InvalidDefinitionVersion);
    }
    if definition_id.as_deref().is_some_and(|id| {
        id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
    }) {
        return Err(RequestError::InvalidEventName);
    }
    Ok((limit, definition_id, definition_version))
}

#[cfg(test)]
mod tests {
    use super::{
        parse_definition_query, parse_events_query, parse_limit_query, parse_range,
        parse_web_vitals_query,
    };

    #[test]
    fn validates_inclusive_366_day_range() {
        assert!(parse_range("2026-01-01", "2027-01-01").is_ok());
        assert!(parse_range("2026-01-01", "2027-01-02").is_err());
    }

    #[test]
    fn rejects_invalid_date_ranges() {
        assert!(parse_range("2026-02-30", "2026-03-01").is_err());
        assert!(parse_range("2026-03-02", "2026-03-01").is_err());
        assert!(parse_range("2026-1-01", "2026-01-02").is_err());
    }

    #[test]
    fn validates_custom_event_filter_and_limit() {
        assert_eq!(parse_events_query(None).unwrap(), (20, None));
        assert_eq!(
            parse_events_query(Some("event_name=checkout_started&limit=1")).unwrap(),
            (1, Some("checkout_started".to_owned()))
        );
        assert!(parse_events_query(Some("event_name=1invalid")).is_err());
        assert!(parse_events_query(Some("event_name=bad%20name")).is_err());
        assert!(parse_events_query(Some("event_name=a&event_name=b")).is_err());
        assert!(parse_events_query(Some("limit=101")).is_err());
    }

    #[test]
    fn validates_definition_filter_and_limit() {
        assert_eq!(parse_definition_query(None).unwrap(), (20, None, None));
        assert_eq!(
            parse_definition_query(Some("definition_id=checkout&limit=100")).unwrap(),
            (100, Some("checkout".to_owned()), None)
        );
        assert!(parse_definition_query(Some("definition_id=bad%20id")).is_err());
        assert!(parse_definition_query(Some("definition_id=a&definition_id=b")).is_err());
        assert_eq!(
            parse_definition_query(Some("definition_version=r2-abc123")).unwrap(),
            (20, None, Some("r2-abc123".to_owned()))
        );
        assert!(parse_definition_query(Some("definition_version=bad%20version")).is_err());
        assert!(parse_definition_query(Some("definition_version=a&definition_version=b")).is_err());
        assert!(parse_definition_query(Some("limit=101")).is_err());
    }

    #[test]
    fn validates_web_vitals_filters_and_limit() {
        assert_eq!(parse_web_vitals_query(None).unwrap(), (20, None));
        assert_eq!(
            parse_web_vitals_query(Some("path=%2Fpricing&limit=100")).unwrap(),
            (100, Some("/pricing".into()))
        );
        assert!(parse_web_vitals_query(Some("path=pricing")).is_err());
        assert!(parse_web_vitals_query(Some("limit=101")).is_err());
        assert!(parse_web_vitals_query(Some("path=%2Fa&path=%2Fb")).is_err());
    }

    #[test]
    fn validates_limit() {
        assert_eq!(parse_limit_query(None).unwrap(), 20);
        assert_eq!(parse_limit_query(Some("limit=100")).unwrap(), 100);
        assert!(parse_limit_query(Some("limit=0")).is_err());
        assert!(parse_limit_query(Some("limit=101")).is_err());
        assert!(parse_limit_query(Some("limit=nope")).is_err());
        assert!(parse_limit_query(Some("limit=1&limit=2")).is_err());
    }
}
