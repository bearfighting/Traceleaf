use anyhow::{Context, Result};
use sqlx::{migrate::Migrator, postgres::PgPoolOptions};
use std::borrow::Cow;

pub async fn run_from_environment() -> Result<()> {
    let database_url = std::env::var("DATABASE_URL")
        .context("DATABASE_URL must be configured for database migrations")?;
    run(&database_url).await
}

pub async fn run(database_url: &str) -> Result<()> {
    let migrator = sqlx::migrate!("../../db/migrations");
    run_with_migrator(database_url, &migrator).await
}

pub async fn run_until(database_url: &str, target_version: i64) -> Result<()> {
    let full_migrator = sqlx::migrate!("../../db/migrations");
    anyhow::ensure!(
        full_migrator.version_exists(target_version),
        "target migration version does not match any known migration"
    );
    let migrations: Vec<_> = full_migrator
        .iter()
        .filter(|migration| migration.version <= target_version)
        .cloned()
        .collect();
    let migrator = Migrator {
        migrations: Cow::Owned(migrations),
        ignore_missing: false,
        locking: true,
        no_tx: false,
        table_name: Cow::Borrowed("_sqlx_migrations"),
        create_schemas: Cow::Borrowed(&[]),
    };
    run_with_migrator(database_url, &migrator).await
}

async fn run_with_migrator(database_url: &str, migrator: &Migrator) -> Result<()> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await
        .context("failed to connect to PostgreSQL for database migrations")?;

    migrator
        .run(&pool)
        .await
        .context("database migrations failed")?;

    pool.close().await;
    Ok(())
}

pub async fn purge_expired_configuration_audit(database_url: &str) -> Result<u64> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await
        .context("failed to connect to PostgreSQL for configuration audit retention")?;

    let result = sqlx::query("DELETE FROM configuration_audit WHERE expires_at <= NOW()")
        .execute(&pool)
        .await
        .context("failed to purge expired configuration audit records")?;

    pool.close().await;
    Ok(result.rows_affected())
}
