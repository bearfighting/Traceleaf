use std::env;

use anyhow::Context;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use subtle::ConstantTimeEq;

#[derive(Clone)]
pub struct AdminTokens(Vec<[u8; 32]>);

impl AdminTokens {
    pub fn from_environment() -> anyhow::Result<Option<Self>> {
        let Some(raw) = env::var_os("CONFIG_ADMIN_TOKENS") else {
            return Ok(None);
        };
        let raw = raw
            .into_string()
            .map_err(|_| anyhow::anyhow!("CONFIG_ADMIN_TOKENS must be valid UTF-8"))?;
        Self::parse_optional(Some(&raw))
    }

    fn parse_optional(raw: Option<&str>) -> anyhow::Result<Option<Self>> {
        match raw {
            None | Some("") => Ok(None),
            Some(raw) => Self::parse(raw).map(Some),
        }
    }

    pub fn parse(raw: &str) -> anyhow::Result<Self> {
        let values: Vec<String> =
            serde_json::from_str(raw).context("CONFIG_ADMIN_TOKENS must be a JSON array")?;
        anyhow::ensure!(
            (1..=2).contains(&values.len()),
            "CONFIG_ADMIN_TOKENS must contain one or two tokens"
        );
        let mut tokens = Vec::with_capacity(values.len());
        for value in values {
            let bytes = URL_SAFE_NO_PAD
                .decode(&value)
                .context("CONFIG_ADMIN_TOKENS entries must be unpadded Base64URL")?;
            anyhow::ensure!(
                bytes.len() == 32,
                "CONFIG_ADMIN_TOKENS entries must decode to 32 bytes"
            );
            anyhow::ensure!(
                URL_SAFE_NO_PAD.encode(&bytes) == value,
                "CONFIG_ADMIN_TOKENS entries must use canonical Base64URL"
            );
            let token: [u8; 32] = bytes.try_into().expect("length checked");
            anyhow::ensure!(
                !tokens.contains(&token),
                "CONFIG_ADMIN_TOKENS entries must be unique"
            );
            tokens.push(token);
        }
        Ok(Self(tokens))
    }

    pub(crate) fn accepts(&self, candidate: &str) -> bool {
        let decoded = URL_SAFE_NO_PAD.decode(candidate);
        let (candidate_bytes, well_formed) = match decoded {
            Ok(bytes) if bytes.len() == 32 && URL_SAFE_NO_PAD.encode(&bytes) == candidate => {
                (bytes.try_into().expect("length checked"), true)
            }
            _ => ([0_u8; 32], false),
        };
        let matched = self.0.iter().fold(0_u8, |matched, token| {
            matched | token.ct_eq(&candidate_bytes).unwrap_u8()
        });
        well_formed && matched == 1
    }
}

#[cfg(test)]
mod tests {
    use super::AdminTokens;
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

    fn token(byte: u8) -> String {
        URL_SAFE_NO_PAD.encode([byte; 32])
    }

    #[test]
    fn missing_or_empty_configuration_disables_admin_routes() {
        assert!(AdminTokens::parse_optional(None).unwrap().is_none());
        assert!(AdminTokens::parse_optional(Some("")).unwrap().is_none());
        assert!(AdminTokens::parse_optional(Some(" ")).is_err());
    }

    #[test]
    fn parses_one_or_two_unique_32_byte_tokens() {
        assert!(AdminTokens::parse(&format!("[\"{}\"]", token(1))).is_ok());
        assert!(AdminTokens::parse(&format!("[\"{}\",\"{}\"]", token(1), token(2))).is_ok());
        assert!(AdminTokens::parse(&format!("[\"{}\",\"{}\"]", token(1), token(1))).is_err());
        assert!(AdminTokens::parse("[]").is_err());
        assert!(AdminTokens::parse("not-json").is_err());
        assert!(AdminTokens::parse("[\"short\"]").is_err());
    }

    #[test]
    fn matches_only_canonical_token_values() {
        let configured = AdminTokens::parse(&format!("[\"{}\"]", token(7))).unwrap();
        assert!(configured.accepts(&token(7)));
        assert!(!configured.accepts(&token(8)));
        assert!(!configured.accepts("invalid"));
    }
}
