use serde::Serialize;

pub const GEO_PARSER_VERSION: &str = "1";

#[derive(Debug, Clone, Serialize)]
pub struct GeoEnrichment {
    pub country_code: String,
    pub provider: String,
    pub dataset_version: String,
    pub parser_version: String,
}

pub fn valid_country_code(code: &str) -> bool {
    code.len() == 2 && code.bytes().all(|byte| byte.is_ascii_uppercase())
}
