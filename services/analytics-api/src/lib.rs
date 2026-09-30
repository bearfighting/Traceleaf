pub(crate) mod analytics;
pub(crate) mod routes;
pub(crate) mod site_management;
pub(crate) mod state;

pub use site_management::auth::AdminTokens;
pub use state::{AppState, state, state_with_admin_tokens, state_with_definition_version};

use sqlx::postgres::PgPoolOptions;

pub fn connect(database_url: &str) -> anyhow::Result<AppState> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy(database_url)?;
    state(pool).map_err(anyhow::Error::msg)
}

pub fn connect_with_definition_version(
    database_url: &str,
    definition_version: String,
) -> anyhow::Result<AppState> {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy(database_url)?;
    state_with_definition_version(pool, definition_version).map_err(anyhow::Error::msg)
}

pub fn router(state: AppState) -> axum::Router {
    routes::router(state)
}

pub fn parse_date_range_for_test(from: &str, to: &str) -> Result<(), &'static str> {
    analytics::validation::parse_range(from, to)
        .map(|_| ())
        .map_err(|error| match error {
            analytics::errors::RequestError::InvalidDateRange(_) => "invalid_date_range",
            analytics::errors::RequestError::DateRangeTooLarge => "date_range_too_large",
            analytics::errors::RequestError::InvalidLimit => "invalid_limit",
            analytics::errors::RequestError::InvalidDimension => "invalid_dimension",
            analytics::errors::RequestError::InvalidEventName => "invalid_event_name",
            analytics::errors::RequestError::InvalidDefinitionVersion => {
                "invalid_definition_version"
            }
        })
}

pub fn parse_limit_for_test(value: Option<&str>) -> Result<i64, &'static str> {
    analytics::validation::parse_limit(value).map_err(|_| "invalid_limit")
}
