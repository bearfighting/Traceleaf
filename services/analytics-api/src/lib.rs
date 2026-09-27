mod auth;
mod capability_runtime;
mod config_store;
mod configuration;
mod errors;
mod handlers;
mod models;
mod queries;
mod routes;
mod state;
mod validation;

pub use auth::AdminTokens;
pub use state::{AppState, state, state_with_admin_tokens, state_with_definition_version};

use sqlx::postgres::PgPoolOptions;

pub fn connect(database_url: &str) -> Result<AppState, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy(database_url)?;
    Ok(state(pool))
}

pub fn connect_with_definition_version(
    database_url: &str,
    definition_version: String,
) -> Result<AppState, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy(database_url)?;
    Ok(state_with_definition_version(pool, definition_version))
}

pub fn router(state: AppState) -> axum::Router {
    routes::router(state)
}

pub fn parse_date_range_for_test(from: &str, to: &str) -> Result<(), &'static str> {
    validation::parse_range(from, to)
        .map(|_| ())
        .map_err(|error| match error {
            errors::RequestError::InvalidDateRange(_) => "invalid_date_range",
            errors::RequestError::DateRangeTooLarge => "date_range_too_large",
            errors::RequestError::InvalidLimit => "invalid_limit",
            errors::RequestError::InvalidDimension => "invalid_dimension",
            errors::RequestError::InvalidEventName => "invalid_event_name",
            errors::RequestError::InvalidDefinitionVersion => "invalid_definition_version",
        })
}

pub fn parse_limit_for_test(value: Option<&str>) -> Result<i64, &'static str> {
    validation::parse_limit(value).map_err(|_| "invalid_limit")
}
