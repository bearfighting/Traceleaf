use std::net::SocketAddr;

use analytics_api::{AdminTokens, connect, router, state_with_admin_tokens};
use anyhow::Context;
use clap::Parser;
use tracing::info;

#[derive(Debug, Parser)]
#[command(name = "analytics-api", version, about = "Query Page View aggregates")]
struct Cli {
    #[arg(long, env = "ANALYTICS_API_HOST", default_value = "0.0.0.0")]
    host: String,
    #[arg(long, env = "ANALYTICS_API_PORT", default_value_t = 4002)]
    port: u16,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let cli = Cli::parse();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be configured")?;
    let admin_tokens = AdminTokens::from_environment()?;
    let state = state_with_admin_tokens(
        connect(&database_url).context("failed to configure PostgreSQL pool")?,
        admin_tokens,
    );
    let listener =
        tokio::net::TcpListener::bind(SocketAddr::new(cli.host.parse()?, cli.port)).await?;
    info!(service = "analytics-api", host = %cli.host, port = cli.port, "analytics API started");
    axum::serve(listener, router(state)).await?;
    Ok(())
}
