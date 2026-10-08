use maxminddb::{Reader, geoip2};
use std::{net::IpAddr, path::Path, sync::Arc};
use thiserror::Error;

use crate::domain::geo::{GEO_PARSER_VERSION, GeoEnrichment, valid_country_code};

const MAXMIND_PROVIDER: &str = "maxmind";
const DBIP_PROVIDER: &str = "db-ip";

#[derive(Debug, Error)]
pub enum GeoError {
    #[error("failed to open GeoIP country database: {0}")]
    Open(#[from] maxminddb::MaxMindDbError),
    #[error("GeoIP database type is unsupported; expected GeoLite2-Country or DBIP-City-Lite")]
    UnsupportedDatabase,
}

#[derive(Clone)]
pub struct GeoLookup {
    reader: Arc<Reader<Vec<u8>>>,
    provider: &'static str,
    dataset_version: String,
}

impl GeoLookup {
    pub fn open(path: &Path) -> Result<Self, GeoError> {
        let reader = Reader::open_readfile(path)?;
        let (database_type, build_epoch) = {
            let metadata = reader.metadata();
            (metadata.database_type.clone(), metadata.build_epoch)
        };
        let provider = provider_for_database_type(&database_type)?;
        Ok(Self {
            reader: Arc::new(reader),
            provider,
            dataset_version: format!("{database_type}-{build_epoch}"),
        })
    }

    pub fn lookup(&self, ip: Option<IpAddr>) -> GeoEnrichment {
        let country_code = ip
            .and_then(|ip| self.reader.lookup(ip).ok())
            .and_then(|lookup| lookup.decode::<geoip2::Country>().ok().flatten())
            .and_then(|country| country.country.iso_code.map(str::to_owned))
            .filter(|code| valid_country_code(code))
            .unwrap_or_else(|| "unknown".to_owned());

        GeoEnrichment {
            country_code,
            provider: self.provider.to_owned(),
            dataset_version: self.dataset_version.clone(),
            parser_version: GEO_PARSER_VERSION.to_owned(),
        }
    }
}

impl crate::application::geo_lookup::GeoResolver for GeoLookup {
    fn lookup(&self, ip: Option<IpAddr>) -> GeoEnrichment {
        GeoLookup::lookup(self, ip)
    }
}

fn provider_for_database_type(database_type: &str) -> Result<&'static str, GeoError> {
    if database_type.starts_with("GeoLite2-Country") {
        Ok(MAXMIND_PROVIDER)
    } else if database_type == "DBIP-City-Lite" {
        Ok(DBIP_PROVIDER)
    } else {
        Err(GeoError::UnsupportedDatabase)
    }
}

#[cfg(test)]
mod tests {
    use std::{net::IpAddr, path::Path};

    use super::{GeoError, provider_for_database_type, valid_country_code};

    fn ip(value: &str) -> IpAddr {
        value.parse().unwrap()
    }

    #[test]
    fn missing_dataset_fails_initialization() {
        let path =
            std::env::temp_dir().join(format!("missing-geo-country-{}.mmdb", std::process::id()));
        assert!(super::GeoLookup::open(&path).is_err());
    }

    #[test]
    fn resolves_synthetic_country_and_unknown_with_release_metadata() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/geo/GeoLite2-Country-Test.mmdb");
        let lookup = super::GeoLookup::open(&path).unwrap();
        let country = lookup.lookup(Some(ip("2.125.160.217")));
        assert_eq!(country.country_code, "GB");
        assert_eq!(country.provider, "maxmind");
        assert_eq!(country.dataset_version, "GeoLite2-Country-1770245369");
        assert_eq!(country.parser_version, "1");
        assert_eq!(lookup.lookup(Some(ip("192.0.2.1"))).country_code, "unknown");
        assert_eq!(lookup.lookup(None).country_code, "unknown");
    }

    #[test]
    #[ignore = "requires the operator-supplied DB-IP City Lite MMDB at ./data/GeoLite2-Country.mmdb"]
    fn operator_dbip_city_lite_mmdb_smoke() {
        let path = std::env::var_os("GEOIP_DATABASE_PATH")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/GeoLite2-Country.mmdb")
            });
        let lookup = super::GeoLookup::open(&path).unwrap();
        let country = lookup.lookup(Some(ip("8.8.8.8")));
        assert_eq!(country.provider, "db-ip");
        assert!(country.dataset_version.starts_with("DBIP-City-Lite-"));
        assert_eq!(country.country_code, "US");
        assert_eq!(lookup.lookup(Some(ip("192.0.2.1"))).country_code, "unknown");
    }

    #[test]
    fn rejects_corrupt_dataset_at_initialization() {
        let path =
            std::env::temp_dir().join(format!("corrupt-geo-country-{}.mmdb", std::process::id()));
        std::fs::write(&path, b"not an MMDB file").unwrap();
        assert!(super::GeoLookup::open(&path).is_err());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn detects_supported_mmdb_providers_from_database_type() {
        assert_eq!(
            provider_for_database_type("GeoLite2-Country").unwrap(),
            "maxmind"
        );
        assert_eq!(
            provider_for_database_type("GeoLite2-Country-Test").unwrap(),
            "maxmind"
        );
        assert_eq!(
            provider_for_database_type("DBIP-City-Lite").unwrap(),
            "db-ip"
        );
        assert!(matches!(
            provider_for_database_type("DBIP-City"),
            Err(GeoError::UnsupportedDatabase)
        ));
    }

    #[test]
    fn validates_iso_alpha_two_country_codes() {
        assert!(valid_country_code("CA"));
        assert!(!valid_country_code("USA"));
        assert!(!valid_country_code("ca"));
    }
}
