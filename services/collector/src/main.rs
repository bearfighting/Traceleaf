use std::{
    net::{IpAddr, SocketAddr},
    path::Path,
};

use clap::Parser;
use tracing::info;

use collector::cli::{Cli, Commands, KeyCommands, ServeArgs};
use collector::config::CollectorConfig;
use collector::config::SiteRegistry;
use collector::error::CollectorError;
use collector::rate_limit::RateLimiter;
use collector::runtime_policy::RuntimePolicyManager;
use collector::sink::PostgresSink;
use collector::validation::Validator;

#[tokio::main]
async fn main() {
    collector::logging::init();

    if let Err(error) = run().await {
        tracing::error!(error = %error, "collector stopped");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), CollectorError> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Serve(args) => serve(args).await,
        Commands::Key {
            command: KeyCommands::Generate(args),
        } => generate_key(args).await,
    }
}

async fn generate_key(_args: collector::cli::KeyGenerateArgs) -> Result<(), CollectorError> {
    let key = collector::key::generate()?;

    println!("{key}");
    Ok(())
}

async fn serve(args: ServeArgs) -> Result<(), CollectorError> {
    let config = CollectorConfig::load_from_path(&args.config)?;
    let registry = config.registry()?; // Validate the legacy fallback before starting the service.
    let site_count = config.sites.len();
    drop(config); // Release TOML plaintext Ingest Keys after digesting them into the registry.
    let host: IpAddr = args.host.parse()?;
    let address = SocketAddr::from((host, args.port));
    let validator = Validator::new().map_err(CollectorError::ValidationSetup)?;
    let database_url =
        std::env::var("DATABASE_URL").map_err(|_| CollectorError::MissingDatabaseUrl)?;
    let sink = PostgresSink::connect(&database_url).await?;
    let policy = collector::security::KeyPolicy::new(SiteRegistry::from_runtime_sites(Vec::new())?);
    let policy_validator =
        collector::runtime_policy::stored_policy_validator().map_err(|error| {
            CollectorError::RuntimeConfiguration(format!(
                "invalid embedded environment policy schema: {error}"
            ))
        })?;
    let runtime =
        RuntimePolicyManager::new(sink.pool(), registry, policy.clone(), policy_validator)
            .map_err(|error| CollectorError::RuntimeConfiguration(error.to_string()))?;
    let geo_path = std::env::var("GEOIP_DATABASE_PATH").map_err(|_| {
        CollectorError::GeoConfiguration(
            "GEOIP_DATABASE_PATH must point to a supported local GeoLite2 Country or DB-IP City Lite MMDB".to_owned(),
        )
    })?;
    let geo = collector::geo::GeoLookup::open(Path::new(&geo_path))?;
    let trusted_proxies = std::env::var("GEOIP_TRUSTED_PROXIES")
        .unwrap_or_default()
        .split(',')
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().parse::<ipnet::IpNet>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            CollectorError::GeoConfiguration(format!("invalid GEOIP_TRUSTED_PROXIES: {error}"))
        })?;
    let capabilities = configuration_runtime::CapabilityRuntime::new(sink.pool(), "collector")
        .map_err(CollectorError::RuntimeConfiguration)?;
    let app = collector::http::router_with_capabilities(
        validator,
        sink.clone(),
        policy,
        RateLimiter::new(),
        Some(geo),
        trusted_proxies,
        Some(capabilities.clone()),
    );

    let listener = tokio::net::TcpListener::bind(address).await?;
    runtime.spawn();
    capabilities.spawn();

    info!(
        service = "collector",
        version = env!("CARGO_PKG_VERSION"),
        host = %args.host,
        port = args.port,
        config_path = %args.config.display(),
        site_count,
        "collector started"
    );

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .map_err(CollectorError::Serve)
}
