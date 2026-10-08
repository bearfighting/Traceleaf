use super::*;

pub(super) fn response_with_etag(status: StatusCode, version: i64, body: Value) -> Response {
    let mut response = (status, Json(body)).into_response();
    let etag = HeaderValue::from_str(&format!("\"{version}\""))
        .expect("positive integer versions form valid ETags");
    response.headers_mut().insert(ETAG, etag);
    response
}
pub(super) fn parse_if_match(headers: &HeaderMap) -> Result<i64, ConfigurationApiError> {
    let Some(value) = headers
        .get("if-match")
        .and_then(|value| value.to_str().ok())
    else {
        return Err(ConfigurationApiError::PreconditionRequired);
    };
    let Some(version_text) = value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
    else {
        return Err(ConfigurationApiError::PreconditionRequired);
    };
    if version_text.is_empty()
        || version_text.starts_with('0')
        || !version_text.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ConfigurationApiError::PreconditionRequired);
    }
    version_text
        .parse::<i64>()
        .ok()
        .filter(|version| *version > 0)
        .ok_or(ConfigurationApiError::PreconditionRequired)
}

pub(super) fn require_if_none_match(headers: &HeaderMap) -> Result<(), ConfigurationApiError> {
    if headers
        .get("if-none-match")
        .and_then(|value| value.to_str().ok())
        == Some("*")
    {
        Ok(())
    } else {
        Err(ConfigurationApiError::PreconditionRequired)
    }
}
