use std::path::{Path, PathBuf};
use thiserror::Error;

use crate::domain::config::{CollectorConfig, ConfigError};

#[derive(Debug, Error)]
pub enum ConfigLoadError {
    #[error("failed to read config '{path}': {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to parse config '{path}': {source}")]
    Parse {
        path: PathBuf,
        source: toml::de::Error,
    },
    #[error(transparent)]
    Validation(#[from] ConfigError),
}

pub fn load_from_path(path: &Path) -> Result<CollectorConfig, ConfigLoadError> {
    let contents = std::fs::read_to_string(path).map_err(|source| ConfigLoadError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    let config =
        toml::from_str::<CollectorConfig>(&contents).map_err(|source| ConfigLoadError::Parse {
            path: path.to_path_buf(),
            source,
        })?;

    config.validate()?;
    config.registry()?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::{ConfigLoadError, load_from_path};

    static NEXT_FILE: AtomicUsize = AtomicUsize::new(0);

    fn write_config(contents: &str) -> PathBuf {
        let file_number = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "web-analytics-collector-config-{}-{file_number}.toml",
            std::process::id()
        ));
        std::fs::write(&path, contents).expect("test config should be writable");
        path
    }

    #[test]
    fn loads_multiple_sites_and_environments() {
        let path = write_config(
            r#"
                [[sites]]
                site_id = "site_example"
                environment = "development"
                enabled = true
                allowed_origins = ["http://localhost:3000"]
                ingest_keys = ["development-key"]

                [[sites]]
                site_id = "site_example"
                environment = "production"
                enabled = true
                allowed_origins = ["https://www.example.com"]
                ingest_keys = ["production-key"]
            "#,
        );
        let config = load_from_path(&path).expect("config should load");
        assert_eq!(config.sites.len(), 2);
        assert_eq!(config.sites[1].environment, "production");
        std::fs::remove_file(path).expect("test config should be removed");
    }

    #[test]
    fn rejects_missing_file() {
        let path = std::env::temp_dir().join(format!(
            "web-analytics-missing-config-{}-{}.toml",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        assert!(matches!(
            load_from_path(&path),
            Err(ConfigLoadError::Read { .. })
        ));
    }

    #[test]
    fn rejects_invalid_toml() {
        let path = write_config("[[sites]\n");
        assert!(matches!(
            load_from_path(&path),
            Err(ConfigLoadError::Parse { .. })
        ));
        std::fs::remove_file(path).expect("test config should be removed");
    }

    #[test]
    fn rejects_missing_required_field() {
        let path = write_config("[[sites]]\nsite_id = 'site_example'\n");
        assert!(matches!(
            load_from_path(&path),
            Err(ConfigLoadError::Parse { .. })
        ));
        std::fs::remove_file(path).expect("test config should be removed");
    }

    #[test]
    fn rejects_wrong_field_type() {
        let path = write_config(
            "[[sites]]\nsite_id = 'site_example'\nenvironment = 'production'\nenabled = 'yes'\nallowed_origins = []\ningest_keys = []\n",
        );
        assert!(matches!(
            load_from_path(&path),
            Err(ConfigLoadError::Parse { .. })
        ));
        std::fs::remove_file(path).expect("test config should be removed");
    }

    #[test]
    fn rejects_semantically_invalid_config() {
        let path = write_config(
            "[[sites]]\nsite_id = 'site_example'\nenvironment = 'production'\nenabled = true\nallowed_origins = ['*']\ningest_keys = ['key']\n",
        );
        assert!(matches!(
            load_from_path(&path),
            Err(ConfigLoadError::Validation(_))
        ));
        std::fs::remove_file(path).expect("test config should be removed");
    }
}
