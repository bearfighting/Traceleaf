use clap::{Args, Parser, Subcommand};

use crate::{
    application::{event_sink::SinkError, runtime_policy::RuntimePolicyManager},
    domain::{config::ConfigError, validation::ValidationError},
    domain::{config::SiteRegistry, security::KeyPolicy, validation::Validator},
    key::KeyGenerationError,
    storage::{
        geo::GeoLookup, runtime_policy::PostgresRuntimePolicyRepository, sink::PostgresSink,
    },
    transport::http,
};
use std::{
    net::{IpAddr, SocketAddr},
    path::Path,
};
use thiserror::Error;
use tracing::info;

pub async fn run() -> Result<(), CliError> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Serve(args) => serve(args).await,
        Commands::Key {
            command: KeyCommands::Generate(args),
        } => generate_key(args).await,
    }
}

async fn generate_key(_args: KeyGenerateArgs) -> Result<(), CliError> {
    let key = crate::key::generate()?;
    println!("{key}");
    Ok(())
}

async fn serve(args: ServeArgs) -> Result<(), CliError> {
    let host: IpAddr = args.host.parse()?;
    let address = SocketAddr::from((host, args.port));
    let validator = Validator::new().map_err(CliError::ValidationSetup)?;
    let database_url = std::env::var("DATABASE_URL").map_err(|_| CliError::MissingDatabaseUrl)?;
    let sink = PostgresSink::connect(&database_url).await?;
    let policy = KeyPolicy::new(SiteRegistry::from_runtime_sites(Vec::new())?);
    let policy_validator =
        crate::application::runtime_policy::stored_policy_validator().map_err(|error| {
            CliError::RuntimeConfiguration(format!(
                "invalid embedded environment policy schema: {error}"
            ))
        })?;
    let runtime = RuntimePolicyManager::with_repository(
        std::sync::Arc::new(PostgresRuntimePolicyRepository::new(sink.pool())),
        policy.clone(),
        policy_validator,
    )
    .map_err(|error| CliError::RuntimeConfiguration(error.to_string()))?;
    let geo_path = std::env::var("GEOIP_DATABASE_PATH").map_err(|_| CliError::GeoConfiguration("GEOIP_DATABASE_PATH must point to a supported local GeoLite2 Country or DB-IP City Lite MMDB".to_owned()))?;
    let geo = GeoLookup::open(Path::new(&geo_path))
        .map_err(|error| CliError::GeoConfiguration(error.to_string()))?;
    let trusted_proxies = std::env::var("GEOIP_TRUSTED_PROXIES")
        .unwrap_or_default()
        .split(',')
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().parse::<ipnet::IpNet>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            CliError::GeoConfiguration(format!("invalid GEOIP_TRUSTED_PROXIES: {error}"))
        })?;
    let capabilities = configuration_runtime::CapabilityRuntime::new(sink.pool(), "collector")
        .map_err(CliError::RuntimeConfiguration)?;
    let app = http::router_with_capabilities(
        validator,
        sink.clone(),
        policy,
        crate::application::rate_limit::RateLimiter::new(),
        Some(std::sync::Arc::new(geo)),
        trusted_proxies,
        Some(capabilities.clone()),
    );
    let listener = tokio::net::TcpListener::bind(address).await?;
    runtime.spawn();
    capabilities.spawn();
    info!(service = "collector", version = env!("CARGO_PKG_VERSION"), host = %args.host, port = args.port, "collector started");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .map_err(CliError::Serve)
}

#[derive(Debug, Error)]
pub enum CliError {
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error("invalid bind address: {0}")]
    Address(#[from] std::net::AddrParseError),
    #[error("failed to bind collector: {0}")]
    Bind(#[from] std::io::Error),
    #[error("collector server failed: {0}")]
    Serve(std::io::Error),
    #[error("failed to initialize event schema validator: {0}")]
    ValidationSetup(ValidationError),
    #[error("DATABASE_URL must be configured")]
    MissingDatabaseUrl,
    #[error("failed to initialize Collector configuration runtime: {0}")]
    RuntimeConfiguration(String),
    #[error("GeoIP configuration error: {0}")]
    GeoConfiguration(String),
    #[error(transparent)]
    Storage(#[from] SinkError),
    #[error("failed to generate ingest key: {0}")]
    KeyGeneration(#[from] KeyGenerationError),
}

#[derive(Debug, Parser)]
#[command(name = "collector", version, about = "Web Analytics event collector")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    Serve(ServeArgs),
    Key {
        #[command(subcommand)]
        command: KeyCommands,
    },
}

#[derive(Debug, Subcommand)]
pub enum KeyCommands {
    Generate(KeyGenerateArgs),
}

#[derive(Debug, Args)]
pub struct KeyGenerateArgs {
    #[arg(long)]
    pub site: String,

    #[arg(long)]
    pub environment: String,
}

#[derive(Debug, Args)]
pub struct ServeArgs {
    #[arg(long, default_value = "0.0.0.0")]
    pub host: String,

    #[arg(long, default_value_t = 4001)]
    pub port: u16,
}

#[cfg(test)]
mod tests {
    use super::{Cli, Commands};
    use clap::Parser;

    #[test]
    fn serve_uses_default_host_and_port() {
        let cli = Cli::try_parse_from(["collector", "serve"]).expect("CLI should parse");

        let Commands::Serve(args) = cli.command else {
            panic!("expected serve command");
        };
        assert_eq!(args.host, "0.0.0.0");
        assert_eq!(args.port, 4001);
    }

    #[test]
    fn serve_arguments_override_defaults() {
        let cli = Cli::try_parse_from([
            "collector",
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            "4100",
        ])
        .expect("CLI should parse");

        let Commands::Serve(args) = cli.command else {
            panic!("expected serve command");
        };
        assert_eq!(args.host, "127.0.0.1");
        assert_eq!(args.port, 4100);
    }

    #[test]
    fn serve_rejects_removed_config_argument() {
        assert!(Cli::try_parse_from(["collector", "serve", "--config", "config.toml"]).is_err());
    }

    #[test]
    fn key_generate_requires_site_and_environment() {
        assert!(Cli::try_parse_from(["collector", "key", "generate"]).is_err());
        assert!(
            Cli::try_parse_from(["collector", "key", "generate", "--site", "site_example"])
                .is_err()
        );
    }
}
