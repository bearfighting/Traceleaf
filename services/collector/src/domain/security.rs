use std::sync::{Arc, RwLock};

use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use thiserror::Error;

use crate::domain::config::{SiteConfig, SiteRegistry, normalize_origin};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AccessError {
    #[error("site is not allowed")]
    SiteNotAllowed,
    #[error("origin is not allowed")]
    OriginNotAllowed,
    #[error("ingest key is invalid")]
    InvalidIngestKey { origin: String },
}

#[derive(Clone)]
pub struct SecurityPolicy {
    registry: Arc<RwLock<Arc<SiteRegistry>>>,
}

pub struct AuthorizedSite {
    pub site: SiteConfig,
    pub origin: String,
}

impl SecurityPolicy {
    pub fn new(registry: SiteRegistry) -> Self {
        Self {
            registry: Arc::new(RwLock::new(Arc::new(registry))),
        }
    }

    pub fn replace_registry(&self, registry: SiteRegistry) {
        *self
            .registry
            .write()
            .expect("policy snapshot lock poisoned") = Arc::new(registry);
    }

    pub fn snapshot(&self) -> Arc<SiteRegistry> {
        Arc::clone(&self.registry.read().expect("policy snapshot lock poisoned"))
    }

    pub fn authorize(
        &self,
        site_id: &str,
        request_origin: Option<&str>,
        ingest_key: Option<&str>,
    ) -> Result<AuthorizedSite, AccessError> {
        let registry = self.snapshot();
        let sites = registry.sites(site_id).ok_or(AccessError::SiteNotAllowed)?;

        if !sites.iter().any(|site| site.enabled) {
            log_rejected(site_id, "disabled site");
            return Err(AccessError::SiteNotAllowed);
        }

        let Some(request_origin) = request_origin else {
            log_rejected(site_id, "missing origin");
            return Err(AccessError::OriginNotAllowed);
        };
        let origin = normalize_origin(request_origin).map_err(|_| {
            log_rejected(site_id, "invalid origin");
            AccessError::OriginNotAllowed
        })?;

        let origin_sites: Vec<&SiteConfig> = sites
            .iter()
            .filter(|site| site.enabled && registry.site_allows_origin(site, &origin))
            .collect();

        if origin_sites.is_empty() {
            log_rejected(site_id, "origin is not allowed");
            return Err(AccessError::OriginNotAllowed);
        }

        let Some(ingest_key) = ingest_key else {
            log_rejected(site_id, "missing ingest key");
            return Err(AccessError::InvalidIngestKey { origin });
        };
        let key_digest: [u8; 32] = Sha256::digest(ingest_key.as_bytes()).into();
        let matched = origin_sites.iter().fold(0_u8, |matched_sites, site| {
            let site_match = site
                .ingest_key_digests
                .iter()
                .fold(0_u8, |matched_keys, digest| {
                    matched_keys | digest.ct_eq(&key_digest).unwrap_u8()
                });
            matched_sites | site_match
        });

        if matched == 1 {
            let site = origin_sites
                .into_iter()
                .find(|site| {
                    site.ingest_key_digests.iter().fold(0_u8, |found, digest| {
                        found | digest.ct_eq(&key_digest).unwrap_u8()
                    }) == 1
                })
                .expect("a matching origin site must have the matching digest");
            Ok(AuthorizedSite {
                site: site.clone(),
                origin,
            })
        } else {
            log_rejected(site_id, "invalid ingest key");
            Err(AccessError::InvalidIngestKey { origin })
        }
    }

    pub fn preflight_origin_allowed(&self, request_origin: &str) -> Option<String> {
        let origin = normalize_origin(request_origin).ok()?;
        self.snapshot()
            .origin_allowed_anywhere(&origin)
            .then_some(origin)
    }
}

pub use SecurityPolicy as KeyPolicy;

fn log_rejected(site_id: &str, reason: &str) {
    tracing::warn!(site_id, reason, "security policy rejected request");
}

#[cfg(test)]
mod tests {
    use super::{AccessError, KeyPolicy};
    use crate::domain::config::{SiteConfig, SiteRegistry};

    fn policy() -> KeyPolicy {
        let mut development =
            SiteConfig::new("site_example", "development", true, "development-key");
        development.allowed_origins = vec!["http://localhost:3000".into()];
        let mut production = SiteConfig::new("site_example", "production", true, "production-key");
        production.allowed_origins = vec!["https://example.com".into()];

        KeyPolicy::new(
            SiteRegistry::from_sites(vec![
                development,
                production,
                SiteConfig::new("site_disabled", "production", false, "disabled-key"),
            ])
            .expect("test registry should be valid"),
        )
    }

    #[test]
    fn selects_environment_by_matching_origin_and_key() {
        let policy = policy();
        let site = policy
            .authorize(
                "site_example",
                Some("https://example.com/"),
                Some("production-key"),
            )
            .expect("origin and key should be accepted");
        assert_eq!(site.site.environment, "production");
        assert_eq!(site.origin, "https://example.com");
    }

    #[test]
    fn rejects_missing_or_invalid_key_after_origin_match() {
        assert!(matches!(
            policy().authorize("site_example", Some("https://example.com"), None),
            Err(AccessError::InvalidIngestKey { .. })
        ));
        assert!(matches!(
            policy().authorize(
                "site_example",
                Some("https://example.com"),
                Some("wrong-key")
            ),
            Err(AccessError::InvalidIngestKey { .. })
        ));
    }

    #[test]
    fn rejects_unknown_disabled_and_disallowed_origins() {
        assert!(matches!(
            policy().authorize(
                "site_unknown",
                Some("https://example.com"),
                Some("production-key")
            ),
            Err(AccessError::SiteNotAllowed)
        ));
        assert!(matches!(
            policy().authorize(
                "site_disabled",
                Some("https://example.com"),
                Some("disabled-key")
            ),
            Err(AccessError::SiteNotAllowed)
        ));
        assert!(matches!(
            policy().authorize(
                "site_example",
                Some("https://evil.example"),
                Some("production-key")
            ),
            Err(AccessError::OriginNotAllowed)
        ));
        assert!(matches!(
            policy().authorize("site_example", None, Some("production-key")),
            Err(AccessError::OriginNotAllowed)
        ));
    }

    #[test]
    fn key_cannot_cross_environment_origin() {
        assert!(matches!(
            policy().authorize(
                "site_example",
                Some("https://example.com"),
                Some("development-key")
            ),
            Err(AccessError::InvalidIngestKey { .. })
        ));
    }

    #[test]
    fn preflight_accepts_any_enabled_allowlisted_origin() {
        assert_eq!(
            policy().preflight_origin_allowed("https://EXAMPLE.com/"),
            Some("https://example.com".into())
        );
        assert_eq!(
            policy().preflight_origin_allowed("https://evil.example"),
            None
        );
    }
}
